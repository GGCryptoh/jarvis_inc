/**
 * Declarative Skill Executor — Generic execution from skill JSON config
 * ======================================================================
 * When a skill command has a `request` block in its JSON definition, this
 * executor handles it instead of a hardcoded handler. It builds the HTTP
 * request from the declarative config, executes it, extracts response fields,
 * runs post-processors, and formats the output.
 */

import type {
  FullSkillDefinition,
  SkillCommand,
  RequestConfig,
  ResponseConfig,
  MultiRequestConfig,
  CLICommandTemplate,
} from './skillResolver';
import type { SkillExecutionOptions, SkillExecutionResult } from './skillExecutor';
import { getVaultEntryByService, updateVaultEntry, logAudit } from './database';
import { uploadGeneratedImage, base64ToBlob } from './storageUpload';
import { logUsage } from './llmUsage';

// ---------------------------------------------------------------------------
// OAuth token resolution + auto-refresh
// ---------------------------------------------------------------------------

async function resolveOAuthToken(
  skill: FullSkillDefinition,
  vaultKeyValue: string,
): Promise<{ accessToken: string; error?: string }> {
  // 1. Parse vault entry as JSON
  let tokens: { access_token: string; refresh_token: string; expires_at: number };
  try {
    tokens = JSON.parse(vaultKeyValue);
  } catch {
    // Not JSON — treat as plain API key (backward compatible)
    return { accessToken: vaultKeyValue };
  }
  if (!tokens.access_token) return { accessToken: vaultKeyValue };

  // 2. Check expiry (refresh if within 5 minutes)
  const FIVE_MIN = 5 * 60 * 1000;
  if (tokens.expires_at && Date.now() > tokens.expires_at - FIVE_MIN) {
    // 3. Get client credentials from vault
    const providerName = skill.oauthConfig?.provider ?? 'Google';
    const clientEntry = await getVaultEntryByService(`${providerName} OAuth Client`);
    if (!clientEntry) {
      return { accessToken: '', error: 'No OAuth client credentials found in vault' };
    }
    const client = JSON.parse(clientEntry.key_value);

    // 4. Refresh token
    const tokenUrl = skill.oauthConfig?.token_url ?? 'https://oauth2.googleapis.com/token';
    const resp = await fetch('/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
        client_secret: client.client_secret,
        token_url: tokenUrl,
      }),
    });
    if (!resp.ok) {
      return { accessToken: '', error: `Token refresh failed: ${resp.status}` };
    }
    const refreshed = await resp.json();

    // 5. Update vault with new tokens
    const vaultService = skill.apiConfig?.vault_service;
    if (vaultService) {
      const entry = await getVaultEntryByService(vaultService);
      if (entry) {
        await updateVaultEntry(entry.id, {
          key_value: JSON.stringify({
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
            expires_at: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
          }),
        });
      }
    }
    return { accessToken: refreshed.access_token };
  }

  return { accessToken: tokens.access_token };
}

// ---------------------------------------------------------------------------
// Dot-path extractor
// ---------------------------------------------------------------------------

/**
 * Extract a value from a nested object using dot-path notation.
 * Supports: `foo.bar`, `foo[0].bar`, `foo[*].bar` (map over array).
 */
export function extractByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;

  const segments = path.replace(/\[(\d+|\*|\?)]/g, '.$1').split('.');
  let current: unknown = obj;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (current == null) return undefined;

    if (seg === '*') {
      // Map over array — apply remaining path to each element
      if (!Array.isArray(current)) return undefined;
      const rest = segments.slice(i + 1).join('.');
      return rest ? current.map(item => extractByPath(item, rest)) : current;
    }

    if (seg === '?') {
      // First match in array
      if (!Array.isArray(current)) return undefined;
      const rest = segments.slice(i + 1).join('.');
      if (!rest) return current[0];
      for (const item of current) {
        const val = extractByPath(item, rest);
        if (val !== undefined) return val;
      }
      return undefined;
    }

    if (Array.isArray(current)) {
      const idx = parseInt(seg, 10);
      if (!isNaN(idx)) {
        current = current[idx];
        continue;
      }
    }

    current = (current as Record<string, unknown>)[seg];
  }

  return current;
}

// ---------------------------------------------------------------------------
// Template interpolation
// ---------------------------------------------------------------------------

/**
 * Replace `{fieldName}` placeholders in a template string.
 * Arrays are joined with `, `. Objects are JSON-stringified.
 */
export function interpolateTemplate(
  template: string,
  fields: Record<string, unknown>,
): string {
  return template.replace(/\{(\w+)}/g, (_match, key: string) => {
    const val = fields[key];
    if (val === undefined || val === null) return '';
    if (Array.isArray(val)) return val.map(formatValue).join(', ');
    return formatValue(val);
  });
}

function formatValue(val: unknown): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object' && val !== null) return JSON.stringify(val);
  return String(val ?? '');
}

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

function interpolateString(str: string, vars: Record<string, unknown>): string {
  return str.replace(/\{(\w+)}/g, (_m, key: string) => {
    const val = vars[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
}

function buildRequest(
  skill: FullSkillDefinition,
  request: RequestConfig,
  params: Record<string, unknown>,
  apiKey: string | null,
): { url: string; init: RequestInit } {
  const apiCfg = skill.apiConfig ?? {};
  const baseUrl = (apiCfg.base_url ?? '').replace(/\/$/, '');

  // Build variable context: params + special tokens
  const vars: Record<string, unknown> = {
    ...params,
    api_model: apiCfg.api_model ?? '',
    api_key: apiKey ?? '',
  };

  // Interpolate path
  const rawPath = interpolateString(request.path, vars);
  let url: string;
  if (!rawPath) {
    url = baseUrl;
  } else if (baseUrl) {
    // Strip leading slash from path to avoid double slashes (baseUrl already has no trailing slash)
    url = `${baseUrl}/${rawPath.replace(/^\//, '')}`;
  } else {
    url = rawPath;
  }

  // Build query string
  const qp = new URLSearchParams();
  if (request.query) {
    for (const [k, v] of Object.entries(request.query)) {
      qp.set(k, interpolateString(v, vars));
    }
  }

  // auth_in_query: put API key in query string instead of header
  if (apiKey && apiCfg.auth_in_query) {
    qp.set(apiCfg.auth_in_query, apiKey);
  }

  const qs = qp.toString();
  if (qs) url += `?${qs}`;

  // Build headers
  const headers: Record<string, string> = {
    ...(apiCfg.headers ?? {}),
    ...(request.headers ?? {}),
  };

  // Add auth header if we have an API key (skip when using auth_in_query)
  if (apiKey && apiCfg.vault_service && apiCfg.vault_service !== 'none' && !apiCfg.auth_in_query) {
    const authHeader = apiCfg.auth_header ?? 'Authorization';
    const authPrefix = apiCfg.auth_prefix ?? 'Bearer';
    headers[authHeader] = authPrefix ? `${authPrefix} ${apiKey}` : apiKey;
  }

  // proxy: route through CORS proxy for browser-side fetches
  if (request.proxy) {
    // If the URL is relative (no domain) and this is a proxy request, it can't be fetched server-side.
    // Use the skill's fixed_service to resolve known hub URLs.
    if (url.startsWith('/') && !url.startsWith('//')) {
      const fixedService = skill.fixedService ?? '';
      if (fixedService === 'Jarvis Hub') {
        url = `https://jarvisinc.app${url}`;
      } else {
        throw new Error(`Cannot proxy relative URL "${url}" — skill is missing api_config.base_url. Re-sync skills to fix.`);
      }
    }
    const proxyUrl = `/api/fetch-proxy?url=${encodeURIComponent(url)}`;
    // Move accept header to X-Accept for proxy
    if (headers['Accept']) {
      headers['X-Accept'] = headers['Accept'];
      delete headers['Accept'];
    }
    url = proxyUrl;
  }

  // Build body for non-GET requests
  let body: string | undefined;
  if (request.method !== 'GET' && request.body !== undefined && request.body !== null) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    body = JSON.stringify(interpolateBody(request.body, vars));
  }

  return {
    url,
    init: {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
    },
  };
}

function interpolateBody(template: unknown, vars: Record<string, unknown>): unknown {
  if (typeof template === 'string') {
    return interpolateString(template, vars);
  }
  if (Array.isArray(template)) {
    return template.map(item => interpolateBody(item, vars));
  }
  if (typeof template === 'object' && template !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      result[k] = interpolateBody(v, vars);
    }
    return result;
  }
  return template;
}

// ---------------------------------------------------------------------------
// Post-processor registry
// ---------------------------------------------------------------------------

interface PostProcessorContext {
  rawResponse: unknown;
  extracted: Record<string, unknown>;
  output: string;
  skill: FullSkillDefinition;
  options: SkillExecutionOptions;
  imageUrl?: string;
  costUsd: number;
}

type PostProcessor = (ctx: PostProcessorContext, cfg: Record<string, unknown>) => Promise<void>;

const POST_PROCESSORS: Record<string, PostProcessor> = {
  upload_image: async (ctx, cfg) => {
    // Look for base64 image data: configurable field > extracted defaults
    const fieldPath = (cfg.field as string) ?? null;
    let b64: unknown;
    if (fieldPath) {
      b64 = extractByPath(ctx.rawResponse, fieldPath) ?? ctx.extracted[fieldPath];
    }
    if (!b64) b64 = ctx.extracted.image_b64 ?? ctx.extracted.b64_json;
    // Gemini returns parts in variable order — scan all parts for inlineData
    if (!b64 || typeof b64 !== 'string') {
      const parts = extractByPath(ctx.rawResponse, 'candidates.0.content.parts') as unknown[];
      if (Array.isArray(parts)) {
        for (const part of parts) {
          const inline = (part as Record<string, unknown>)?.inlineData as Record<string, unknown> | undefined;
          if (inline?.data && typeof inline.data === 'string') {
            b64 = inline.data;
            // Pick up actual MIME type from the response
            if (inline.mimeType && typeof inline.mimeType === 'string') {
              cfg = { ...cfg, mime_type: inline.mimeType };
            }
            break;
          }
        }
      }
    }
    if (typeof b64 !== 'string') return;

    const mimeType = (cfg.mime_type as string) ?? 'image/png';
    const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
    const prefix = (cfg.filename_prefix as string) ?? 'declarative';
    const blob = base64ToBlob(b64, mimeType);
    const storageUrl = await uploadGeneratedImage(blob, `${prefix}-${Date.now()}.${ext}`, mimeType);
    ctx.imageUrl = storageUrl ?? `data:${mimeType};base64,${b64}`;
  },

  estimate_cost: async (ctx, cfg) => {
    const baseCost = (cfg.base_cost_usd as number) ?? 0;
    if (baseCost > 0) ctx.costUsd = baseCost;
  },
};

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export async function executeDeclarative(
  skill: FullSkillDefinition,
  command: SkillCommand,
  params: Record<string, unknown>,
  options: SkillExecutionOptions,
): Promise<SkillExecutionResult> {
  const startTime = Date.now();
  const request = command.request!;
  const response: ResponseConfig = command.response ?? {};

  try {
    // 0. Apply parameter defaults
    const resolvedParams = { ...params };
    if (command.parameters) {
      for (const p of command.parameters) {
        if (resolvedParams[p.name] === undefined && p.default !== undefined) {
          resolvedParams[p.name] = p.default;
        }
      }
    }

    // 1. Resolve API key from vault (if needed)
    let apiKey: string | null = null;
    const vaultService = skill.apiConfig?.vault_service;
    if (vaultService && vaultService !== 'none') {
      const entry = await getVaultEntryByService(vaultService);
      if (!entry) {
        return {
          success: false,
          output: '',
          tokens_used: 0,
          cost_usd: 0,
          duration_ms: Date.now() - startTime,
          error: `No ${vaultService} API key found in the Vault.`,
        };
      }
      apiKey = entry.key_value;

      // Resolve OAuth tokens (JSON bundle → access_token, with auto-refresh)
      if (skill.oauthConfig || (apiKey && apiKey.startsWith('{'))) {
        const { accessToken, error } = await resolveOAuthToken(skill, apiKey);
        if (error) {
          return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error };
        }
        apiKey = accessToken;
      }
    }

    // 2. Build and execute HTTP request
    const { url, init } = buildRequest(skill, request, resolvedParams, apiKey);
    const resp = await fetch(url, init);

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      return {
        success: false,
        output: '',
        tokens_used: 0,
        cost_usd: 0,
        duration_ms: Date.now() - startTime,
        error: `API returned ${resp.status}: ${errBody.slice(0, 500)}`,
      };
    }

    // Parse response based on response_format
    const fmt = request.response_format ?? 'json';
    let rawData: unknown;
    if (fmt === 'text') {
      rawData = await resp.text();
    } else if (fmt === 'binary') {
      const buf = await resp.arrayBuffer();
      // Convert to base64 for downstream handling
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      rawData = btoa(binary);
    } else {
      rawData = await resp.json();
    }

    // 3. Check error_path (only for JSON responses)
    if (response.error_path) {
      const errMsg = extractByPath(rawData, response.error_path);
      if (errMsg) {
        return {
          success: false,
          output: '',
          tokens_used: 0,
          cost_usd: 0,
          duration_ms: Date.now() - startTime,
          error: String(errMsg),
        };
      }
    }

    // 4. Extract fields or passthrough
    let extracted: Record<string, unknown> = {};
    let outputText: string;

    if (response.passthrough) {
      extracted = { raw: rawData };
      outputText = typeof rawData === 'string' ? rawData : JSON.stringify(rawData, null, 2);
    } else if (fmt === 'text') {
      // Text format — raw string passthrough
      extracted = { raw: rawData };
      outputText = typeof rawData === 'string' ? rawData : String(rawData);
    } else if (response.extract_raw) {
      const raw = extractByPath(rawData, response.extract_raw);
      extracted = { raw };
      outputText = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    } else if (response.extract) {
      for (const [name, path] of Object.entries(response.extract)) {
        extracted[name] = extractByPath(rawData, path);
      }
      outputText = JSON.stringify(extracted, null, 2);
    } else {
      // No extraction config — return raw JSON
      extracted = { raw: rawData };
      outputText = JSON.stringify(rawData, null, 2);
    }

    // 5. Run post-processors
    const ctx: PostProcessorContext = {
      rawResponse: rawData,
      extracted,
      output: outputText,
      skill,
      options,
      costUsd: 0,
    };

    if (command.post_processors) {
      for (const pp of command.post_processors) {
        const processor = POST_PROCESSORS[pp.type];
        if (processor) {
          await processor(ctx, pp.config ?? {});
        }
      }
    }

    // 5b. Auto image_field handling (response-level config)
    if (response.image_field && !ctx.imageUrl) {
      let b64 = extractByPath(rawData, response.image_field);
      let mime = 'image/png';
      // Fallback: scan parts for inlineData (Gemini returns parts in variable order)
      if ((!b64 || typeof b64 !== 'string') && Array.isArray(extractByPath(rawData, 'candidates.0.content.parts'))) {
        const parts = extractByPath(rawData, 'candidates.0.content.parts') as unknown[];
        for (const part of parts) {
          const inline = (part as Record<string, unknown>)?.inlineData as Record<string, unknown> | undefined;
          if (inline?.data && typeof inline.data === 'string') {
            b64 = inline.data;
            if (typeof inline.mimeType === 'string') mime = inline.mimeType;
            break;
          }
        }
      }
      if (typeof b64 === 'string' && b64.length > 100) {
        const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
        const blob = base64ToBlob(b64, mime);
        const storageUrl = await uploadGeneratedImage(blob, `declarative-${Date.now()}.${ext}`, mime);
        ctx.imageUrl = storageUrl ?? `data:${mime};base64,${b64}`;
      }
    }

    // 5c. Sync imageUrl to extracted for template interpolation
    if (ctx.imageUrl) {
      extracted.image_url = ctx.imageUrl;
    }

    // 6. Format output via template or default
    if (command.output_template) {
      // Merge params + extracted fields for template interpolation
      const templateVars = { ...resolvedParams, ...extracted };
      outputText = interpolateTemplate(command.output_template, templateVars);
    }

    // 7. TODO: passthrough_to_llm support (future — requires LLM call)

    // 8. Audit log
    const durationMs = Date.now() - startTime;
    await logAudit(
      options.agentId ?? null,
      'SKILL_EXECUTED',
      `Declarative skill "${skill.name}" command "${command.name}" completed in ${durationMs}ms`,
      skill.riskLevel === 'dangerous' ? 'warning' : 'info',
    );

    // Log usage if there's a cost
    if (ctx.costUsd > 0) {
      logUsage({
        provider: skill.apiConfig?.vault_service ?? 'unknown',
        model: skill.apiConfig?.api_model ?? 'unknown',
        inputTokens: 0,
        outputTokens: 0,
        context: 'skill_execution',
        agentId: options.agentId,
        missionId: options.missionId,
        costOverride: ctx.costUsd,
      }).catch(() => {});
    }

    return {
      success: true,
      output: outputText,
      tokens_used: 0,
      cost_usd: ctx.costUsd,
      duration_ms: durationMs,
      ...(ctx.imageUrl ? { imageUrl: ctx.imageUrl } : {}),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

// ---------------------------------------------------------------------------
// Multi-request fan-out executor
// ---------------------------------------------------------------------------

/**
 * Execute a command's request template multiple times with different iteration values.
 * Merges results per merge_strategy: 'concat' (default), 'object', or 'array'.
 */
export async function executeMultiRequest(
  skill: FullSkillDefinition,
  command: SkillCommand,
  params: Record<string, unknown>,
  options: SkillExecutionOptions,
): Promise<SkillExecutionResult> {
  const multi = command.multi_request!;
  const startTime = Date.now();
  const results: { key: string; result: SkillExecutionResult }[] = [];

  for (const iterValue of multi.iterate_over) {
    const iterParams = { ...params, [multi.iterate_param]: iterValue };
    const result = await executeDeclarative(skill, command, iterParams, options);
    results.push({ key: iterValue, result });
  }

  const strategy = multi.merge_strategy ?? 'concat';
  let mergedOutput: string;
  const totalCost = results.reduce((sum, r) => sum + r.result.cost_usd, 0);
  const anyFailed = results.some(r => !r.result.success);

  if (strategy === 'concat') {
    mergedOutput = results
      .filter(r => r.result.success && r.result.output.trim())
      .map(r => r.result.output)
      .join('\n\n');
  } else if (strategy === 'object') {
    const obj: Record<string, string> = {};
    for (const r of results) {
      if (r.result.success) obj[r.key] = r.result.output;
    }
    mergedOutput = JSON.stringify(obj, null, 2);
  } else {
    // 'array'
    mergedOutput = JSON.stringify(
      results.filter(r => r.result.success).map(r => ({ key: r.key, output: r.result.output })),
      null, 2,
    );
  }

  return {
    success: !anyFailed || results.some(r => r.result.success), // partial success OK
    output: mergedOutput || 'No results returned.',
    tokens_used: 0,
    cost_usd: totalCost,
    duration_ms: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// CLI command template executor
// ---------------------------------------------------------------------------

/**
 * Execute a CLI command template — either via direct HTTP fetch (url_template)
 * or via the gateway /exec-cli endpoint (gateway_exec).
 */
export async function executeCLITemplate(
  skill: FullSkillDefinition,
  command: SkillCommand,
  params: Record<string, unknown>,
  options: SkillExecutionOptions,
): Promise<SkillExecutionResult> {
  const cli = command.cli_command_template!;
  const startTime = Date.now();

  // Build variable context
  const vars: Record<string, unknown> = { ...params };

  try {
    if (cli.gateway_exec && cli.command_template) {
      // Gateway execution — POST to gateway /exec-cli
      const gatewayUrl = typeof process !== 'undefined' && process.env?.GATEWAY_URL
        ? process.env.GATEWAY_URL
        : 'http://localhost:3001';
      const cmd = interpolateString(cli.command_template, vars);
      const resp = await fetch(`${gatewayUrl}/exec-cli`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, timeout: cli.timeout ?? 30 }),
      });

      const durationMs = Date.now() - startTime;
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        return {
          success: false, output: '', tokens_used: 0, cost_usd: 0,
          duration_ms: durationMs,
          error: `Gateway CLI exec failed: ${(err as Record<string, unknown>).error ?? resp.statusText}`,
        };
      }

      const data = await resp.json();
      return {
        success: true,
        output: typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2),
        tokens_used: 0, cost_usd: 0, duration_ms: durationMs,
      };
    }

    if (cli.url_template) {
      // Direct HTTP fetch with URL template
      const url = interpolateString(cli.url_template, vars);
      const method = cli.method ?? 'GET';
      const headers = cli.headers ?? {};

      const resp = await fetch(url, { method, headers });
      const durationMs = Date.now() - startTime;

      if (!resp.ok) {
        return {
          success: false, output: '', tokens_used: 0, cost_usd: 0,
          duration_ms: durationMs,
          error: `HTTP ${resp.status}: ${await resp.text().catch(() => '')}`,
        };
      }

      let output: string;
      if (cli.response_type === 'text') {
        output = await resp.text();
      } else {
        const data = await resp.json();
        // If command has response extraction, use it
        if (command.response?.extract) {
          const extracted: Record<string, unknown> = {};
          for (const [name, path] of Object.entries(command.response.extract)) {
            extracted[name] = extractByPath(data, path);
          }
          if (command.output_template) {
            output = interpolateTemplate(command.output_template, { ...vars, ...extracted });
          } else {
            output = JSON.stringify(extracted, null, 2);
          }
        } else if (command.output_template) {
          output = interpolateTemplate(command.output_template, { ...vars, raw: data });
        } else {
          output = JSON.stringify(data, null, 2);
        }
      }

      await logAudit(
        options.agentId ?? null,
        'SKILL_EXECUTED',
        `CLI template "${skill.name}" command "${command.name}" completed in ${durationMs}ms`,
        skill.riskLevel === 'dangerous' ? 'warning' : 'info',
      );

      return { success: true, output, tokens_used: 0, cost_usd: 0, duration_ms: durationMs };
    }

    return {
      success: false, output: '', tokens_used: 0, cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: 'cli_command_template requires either url_template or gateway_exec + command_template',
    };
  } catch (err) {
    return {
      success: false, output: '', tokens_used: 0, cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
