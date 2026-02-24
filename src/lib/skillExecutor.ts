/**
 * Skill Executor — Runs skill commands via LLM providers
 * ========================================================
 * Resolves the skill, builds a prompt, calls the LLM, and returns the result.
 * Logs execution to the audit log.
 */

import { resolveSkill, type FullSkillDefinition } from './skillResolver';
import { getVaultEntryByService, logAudit, getPrompt, loadCEO, getSetting, getSkillOptions } from './database';
import { getSupabase } from './supabase';
import { MODEL_SERVICE_MAP, MODEL_API_IDS, estimateCost } from './models';
import { logUsage } from './llmUsage';
import type { LLMMessage, LLMProvider } from './llm/types';
import { anthropicProvider } from './llm/providers/anthropic';
import { openaiProvider, deepseekProvider, xaiProvider } from './llm/providers/openai';
import { googleProvider } from './llm/providers/google';
import { executeCLISkill } from './cliSkillHandlers';
import { uploadGeneratedImage, base64ToBlob } from './storageUpload';
import { loadKeyFromLocalStorage, decryptPrivateKey } from './jarvisKey';
import {
  getMarketplaceStatus,
  registerOnMarketplace,
  signedMarketplacePost,
  getCachedRawPrivateKey,
  cacheRawPrivateKey,
  MARKETPLACE_URL,
} from './marketplaceClient';

// ---------------------------------------------------------------------------
// Provider registry (same as chatService — but skill executor owns its own)
// ---------------------------------------------------------------------------

const PROVIDERS: Record<string, LLMProvider> = {
  Anthropic: anthropicProvider,
  OpenAI:    openaiProvider,
  Google:    googleProvider,
  DeepSeek:  deepseekProvider,
  xAI:       xaiProvider,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillExecutionResult {
  success: boolean;
  output: string;
  tokens_used: number;
  cost_usd: number;
  duration_ms: number;
  error?: string;
  imageUrl?: string;
}

// ---------------------------------------------------------------------------
// Forum auto-post risk tiers
// ---------------------------------------------------------------------------

export type ForumAutoPostLevel = 'off' | 'safe' | 'normal' | 'all';
export type RiskLevel = 'safe' | 'moderate' | 'risky';

export interface RiskAssessment {
  risk_level: RiskLevel;
  reason: string;
}

/**
 * Assess forum post content risk using Haiku (cheap, ~$0.001/call).
 * Queries org_memory for sensitive content and checks if the post might leak it.
 */
export async function assessForumPostRisk(
  postContent: string,
  postTitle?: string,
): Promise<RiskAssessment> {
  try {
    // Query org_memory for sensitive memories
    const { getMemoriesByTags, getMemoriesByCategory } = await import('./memory');

    const sensitiveTags = ['private', 'confidential', 'internal', 'sensitive', 'financial', 'strategy'];
    const [taggedMemories, decisions, preferences] = await Promise.all([
      getMemoriesByTags(sensitiveTags, 20),
      getMemoriesByCategory('decision', 10),
      getMemoriesByCategory('preference', 10),
    ]);

    // Deduplicate by ID
    const seen = new Set<string>();
    const sensitiveMemories: string[] = [];
    for (const mem of [...taggedMemories, ...decisions, ...preferences]) {
      if (!seen.has(mem.id)) {
        seen.add(mem.id);
        sensitiveMemories.push(mem.content);
      }
    }

    const memoryBlock = sensitiveMemories.length > 0
      ? sensitiveMemories.map(m => `- ${m}`).join('\n')
      : '(none found)';

    const postBlock = postTitle
      ? `Title: ${postTitle}\nBody: ${postContent}`
      : `Body: ${postContent}`;

    const prompt = `You are a content risk assessor for an AI organization's public forum posts.

Classify the proposed post into exactly one risk level:
- "safe": Introductions, greetings, factual replies, votes, simple observations, pleasantries, general agreement/disagreement
- "moderate": Business ideas, opinions, strategy discussion, feature suggestions, recommendations, comparisons, sharing workflow details, general business commentary, technical topics, constructive criticism
- "risky": ONLY flag as risky if the post contains: actual secrets (API keys, passwords, credentials, tokens), financial figures (revenue, costs, credit card numbers), personal identifying information (SSNs, addresses, phone numbers), or content that directly reveals items from SENSITIVE ORG MEMORY below. General business ideas and opinions are NOT risky — they are moderate.

SENSITIVE ORG MEMORY (do NOT let the post reveal these specific items):
${memoryBlock}

PROPOSED POST:
${postBlock}

Respond with ONLY valid JSON: {"risk_level":"safe"|"moderate"|"risky","reason":"brief explanation"}`;

    // Call Haiku via Anthropic provider
    const vaultEntry = await getVaultEntryByService('Anthropic');
    if (!vaultEntry) {
      console.warn('[assessForumPostRisk] No Anthropic key — defaulting to risky');
      return { risk_level: 'risky', reason: 'No API key available for risk assessment' };
    }

    const messages: LLMMessage[] = [
      { role: 'user', content: prompt },
    ];

    const result = await new Promise<string | null>((resolve) => {
      let fullText = '';
      PROVIDERS.Anthropic.stream(
        messages,
        vaultEntry.key_value,
        MODEL_API_IDS['Claude Haiku 4.5'],
        {
          onToken: (token) => { fullText += token; },
          onDone: (text) => { resolve(text || fullText); },
          onError: (err) => {
            console.warn('[assessForumPostRisk] LLM call failed:', err);
            resolve(null);
          },
        },
      );
    });

    if (!result) {
      return { risk_level: 'risky', reason: 'Risk assessment LLM call failed' };
    }

    // Parse JSON from response (handle markdown code fences)
    const cleaned = result.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const level = ['safe', 'moderate', 'risky'].includes(parsed.risk_level)
      ? parsed.risk_level as RiskLevel
      : 'risky';

    return { risk_level: level, reason: parsed.reason ?? 'No reason provided' };
  } catch (err) {
    console.warn('[assessForumPostRisk] Error — defaulting to risky:', err);
    return { risk_level: 'risky', reason: 'Risk assessment error — defaulting to conservative' };
  }
}

/**
 * Check if a post at the given risk level is allowed to auto-post.
 */
export function isAutoPostAllowed(level: ForumAutoPostLevel, riskLevel: RiskLevel): boolean {
  if (level === 'all') return true;
  if (level === 'off') return false;
  if (level === 'normal') return riskLevel === 'safe' || riskLevel === 'moderate';
  if (level === 'safe') return riskLevel === 'safe';
  return false;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the prompt for a skill command invocation.
 * If the command has a `prompt_template`, interpolate params.
 * Otherwise, build a generic prompt.
 */
export function buildSkillPrompt(
  skill: FullSkillDefinition,
  commandName: string,
  params: Record<string, unknown>,
): string {
  const command = skill.commands?.find(c => c.name === commandName);

  if (command?.prompt_template) {
    // Interpolate {paramName} placeholders
    let prompt = command.prompt_template;
    for (const [key, value] of Object.entries(params)) {
      const placeholder = `{${key}}`;
      prompt = prompt.split(placeholder).join(String(value ?? ''));
    }
    return prompt;
  }

  // Generic prompt
  const paramBlock = Object.keys(params).length > 0
    ? `\n\nParameters:\n${JSON.stringify(params, null, 2)}`
    : '';

  const commandDesc = command
    ? `\nCommand: ${command.name} — ${command.description}`
    : `\nCommand: ${commandName}`;

  return `You are executing the skill "${skill.name}".${commandDesc}${paramBlock}

Execute this task and return the result. Be thorough and provide actionable output.`;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Execute a skill command via an LLM provider.
 *
 * 1. Resolve the skill definition
 * 2. Build the prompt
 * 3. Get the provider + API key
 * 4. Call the LLM (streaming, collected into final result)
 * 5. Log to audit
 * 6. Return result
 */
export interface SkillExecutionOptions {
  modelOverride?: string;
  agentId?: string;
  missionId?: string;
  /** When true, skip risk assessment (e.g. founder already approved via Approvals page). */
  skipRiskGate?: boolean;
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export async function executeSkill(
  skillId: string,
  commandName: string,
  params: Record<string, unknown>,
  modelOrOptions?: string | SkillExecutionOptions,
): Promise<SkillExecutionResult> {
  // Support both legacy string and new options object
  const options: SkillExecutionOptions = typeof modelOrOptions === 'string'
    ? { modelOverride: modelOrOptions }
    : modelOrOptions ?? {};
  const { modelOverride, agentId, missionId } = options;
  const startTime = Date.now();

  // 1. Resolve skill
  const skill = await resolveSkill(skillId);
  if (!skill) {
    return {
      success: false,
      output: '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: `Skill "${skillId}" not found`,
    };
  }

  if (!skill.enabled) {
    return {
      success: false,
      output: '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: `Skill "${skill.name}" is not enabled`,
    };
  }

  // 1b. Declarative command? Execute via generic declarative executor
  const matchedCommand = skill.commands?.find(c => c.name === commandName);
  if (matchedCommand?.request) {
    // multi_request fan-out: iterate the same request with different values
    if (matchedCommand.multi_request) {
      const { executeMultiRequest } = await import('./declarativeExecutor');
      return executeMultiRequest(skill, matchedCommand, params, options);
    }
    const { executeDeclarative } = await import('./declarativeExecutor');
    return executeDeclarative(skill, matchedCommand, params, options);
  }

  // 1b2. CLI command template? Execute via declarative CLI executor
  if (matchedCommand?.cli_command_template) {
    const { executeCLITemplate } = await import('./declarativeExecutor');
    return executeCLITemplate(skill, matchedCommand, params, options);
  }

  // 1b3. Browser-side skill handlers — intercept signing-dependent commands
  //       that can't run on the gateway (keys live in browser localStorage)
  const browserResult = await executeBrowserHandler(skillId, commandName, params, options, startTime);
  if (browserResult) return browserResult;

  // 1b4. Gateway-installed handler file? Route to /exec-skill/:id/:cmd
  if (matchedCommand?.handler_file && skill.handlerRuntime) {
    const gwUrl = typeof window !== 'undefined'
      ? ((import.meta as any).env?.VITE_GATEWAY_URL || 'http://localhost:3001')
      : null;
    if (gwUrl) {
      try {
        // Pass vault key if skill needs auth
        let apiKey: string | undefined;
        if (skill.apiConfig?.vault_service && skill.apiConfig.vault_service !== 'none') {
          const entry = await getVaultEntryByService(skill.apiConfig.vault_service);
          if (entry) apiKey = entry.key_value;
        }
        const resp = await fetch(`${gwUrl}/exec-skill/${skillId}/${commandName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ params, apiKey }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          return {
            success: false, output: '', tokens_used: 0, cost_usd: 0,
            duration_ms: Date.now() - startTime,
            error: data.error || 'Gateway handler execution failed',
          };
        }
        let output = typeof data.result === 'string'
          ? data.result
          : typeof data.result?.result === 'string'
            ? data.result.result
            : JSON.stringify(data.result, null, 2);
        await logAudit(
          options.agentId ?? null,
          'SKILL_EXECUTED',
          `Skill "${skill.name}" command "${commandName}" via gateway handler (${skill.handlerRuntime})`,
          skill.riskLevel === 'dangerous' ? 'warning' : 'info',
        );

        // Upload data URI images to Supabase Storage
        let imageUrl: string | undefined = data.result?.imageUrl;
        if (imageUrl && imageUrl.startsWith('data:')) {
          try {
            const match = imageUrl.match(/^data:(image\/\w+);base64,(.+)$/);
            if (match) {
              const mime = match[1];
              const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
              const blob = base64ToBlob(match[2], mime);
              const storageUrl = await uploadGeneratedImage(blob, `handler-${Date.now()}.${ext}`, mime);
              if (storageUrl) {
                output = output.replace(imageUrl, storageUrl);
                imageUrl = storageUrl;
              }
            }
          } catch (uploadErr) {
            console.warn('[SkillExecutor] Handler image upload failed, keeping data URI:', uploadErr);
          }
        }

        return {
          success: true,
          output,
          tokens_used: 0,
          cost_usd: 0,
          duration_ms: Date.now() - startTime,
          ...(imageUrl && { imageUrl }),
        };
      } catch (err) {
        return {
          success: false, output: '', tokens_used: 0, cost_usd: 0,
          duration_ms: Date.now() - startTime,
          error: `Gateway unreachable for handler: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }

  // 1c. CLI skill? Execute via HTTP handler — no LLM needed
  const connType = typeof skill.connection === 'string'
    ? skill.connection
    : (skill.connection as Record<string, unknown>)?.type as string ?? '';

  if (connType === 'cli') {
    const cliResult = await executeCLISkill(skillId, commandName, params, skill.apiConfig);
    if (cliResult) {
      const durationMs = Date.now() - startTime;
      await logAudit(
        options.agentId ?? null,
        'SKILL_EXECUTED',
        `CLI skill "${skill.name}" command "${commandName}" completed in ${durationMs}ms via HTTP`,
        skill.riskLevel === 'dangerous' ? 'warning' : 'info',
      );
      return {
        success: cliResult.success,
        output: cliResult.text,
        tokens_used: 0,
        cost_usd: 0,
        duration_ms: durationMs,
        error: cliResult.success ? undefined : cliResult.text,
      };
    }
    // No handler found for this CLI skill
    return {
      success: false,
      output: '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: `CLI skill "${skillId}" has no browser handler`,
    };
  }

  // ── SAFETY NET ──────────────────────────────────────────────────────────
  // If a BROWSER_HANDLER exists for this command but we still reached here,
  // it means the handler returned null unexpectedly.  Do NOT fall through to
  // LLM — that produces expensive hallucinated "UNABLE TO EXECUTE" responses.
  const _bhKey = `${skillId}:${commandName}`;
  if (BROWSER_HANDLERS[_bhKey]) {
    console.warn(`[SkillExecutor] BROWSER_HANDLER "${_bhKey}" returned null — blocking LLM fallback`);
    return {
      success: false, output: '', tokens_used: 0, cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: `Handler for "${skillId}:${commandName}" failed to execute. Will retry on next cycle.`,
    };
  }

  // 2. Determine model (LLM skills only)
  const modelName = modelOverride ?? skill.model ?? skill.defaultModel;
  if (!modelName) {
    return {
      success: false,
      output: '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: 'No model configured for this skill',
    };
  }

  // 3. Get provider + API key
  const service = MODEL_SERVICE_MAP[modelName];
  if (!service) {
    return {
      success: false,
      output: '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: `Unknown service for model "${modelName}"`,
    };
  }

  const provider = PROVIDERS[service];
  if (!provider) {
    return {
      success: false,
      output: '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: `No provider available for service "${service}"`,
    };
  }

  const vaultEntry = await getVaultEntryByService(service);
  if (!vaultEntry) {
    return {
      success: false,
      output: '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: `No API key found for ${service}. Add one in the Vault.`,
    };
  }

  // 4. Build prompt and call LLM
  const prompt = buildSkillPrompt(skill, commandName, params);
  const apiModelId = MODEL_API_IDS[modelName] ?? modelName;

  // Use command-level system_prompt if defined, otherwise generic fallback
  const command = skill.commands?.find(c => c.name === commandName);
  const dbFallbackPrompt = await getPrompt('skill-execution-fallback');
  let systemPrompt = dbFallbackPrompt
    ? dbFallbackPrompt.replace(/\{\{SKILL_NAME\}\}/g, skill.name)
    : `You are an AI agent executing the "${skill.name}" skill. Be precise, thorough, and return structured output when possible.`;
  if (command?.system_prompt) {
    systemPrompt = command.system_prompt;
    // Interpolate {param} placeholders in system prompt
    for (const [key, value] of Object.entries(params)) {
      systemPrompt = systemPrompt.split(`{${key}}`).join(String(value ?? ''));
    }
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  try {
    const output = await new Promise<string>((resolve, reject) => {
      provider.stream(messages, vaultEntry.key_value, apiModelId, {
        onToken: () => {
          // Tokens collected in onDone
        },
        onDone: (fullText: string) => resolve(fullText),
        onError: (err: Error) => reject(err),
      });
    });

    const durationMs = Date.now() - startTime;
    // Rough token estimate: 1 token per 4 chars
    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(output.length / 4);
    const estimatedTokens = inputTokens + outputTokens;

    // Log to llm_usage table for cost tracking (fire-and-forget)
    logUsage({
      provider: service,
      model: modelName,
      inputTokens,
      outputTokens,
      context: 'skill_execution',
      agentId: agentId ?? undefined,
      missionId: missionId ?? undefined,
    }).catch(() => {});

    await logAudit(
      agentId ?? null,
      'SKILL_EXECUTED',
      `Skill "${skill.name}" command "${commandName}" completed in ${durationMs}ms using ${modelName} (${estimatedTokens} tokens)`,
      skill.riskLevel === 'dangerous' ? 'warning' : 'info',
    );

    const estimatedCost = estimateCost(modelName, inputTokens, outputTokens);

    return {
      success: true,
      output,
      tokens_used: estimatedTokens,
      cost_usd: estimatedCost,
      duration_ms: durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    await logAudit(
      null,
      'SKILL_EXECUTION_FAILED',
      `Skill "${skill.name}" command "${commandName}" failed: ${errorMessage}`,
      'error',
    );

    return {
      success: false,
      output: '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: durationMs,
      error: errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// Browser-side skill handlers
// ---------------------------------------------------------------------------
// Commands that need the Ed25519 private key (browser localStorage) can't run
// on the gateway. These handlers intercept specific skill:command pairs and
// execute them directly in the browser using Web Crypto API.
// ---------------------------------------------------------------------------

async function executeBrowserHandler(
  skillId: string,
  commandName: string,
  params: Record<string, unknown>,
  options: SkillExecutionOptions,
  startTime: number,
): Promise<SkillExecutionResult | null> {
  const key = `${skillId}:${commandName}`;
  const handler = BROWSER_HANDLERS[key];
  if (!handler) return null;
  return handler(params, options, startTime);
}

/**
 * Wait for marketplace registration to complete (handles concurrent dispatch race).
 * Returns true if registered, false if still not registered after timeout.
 */
async function waitForMarketplaceRegistration(maxWaitMs = 12_000): Promise<boolean> {
  if (getMarketplaceStatus().registered) return true;
  // Registration might be in-flight from a concurrent mission — wait and retry
  const intervals = [2_000, 3_000, 4_000, 5_000];
  let waited = 0;
  for (const delay of intervals) {
    if (waited >= maxWaitMs) break;
    await new Promise(r => setTimeout(r, delay));
    waited += delay;
    if (getMarketplaceStatus().registered) return true;
  }
  return false;
}

const BROWSER_HANDLERS: Record<
  string,
  (
    params: Record<string, unknown>,
    options: SkillExecutionOptions,
    startTime: number,
  ) => Promise<SkillExecutionResult>
> = {
  'marketplace:register': async (params, options, startTime) => {
    const status = getMarketplaceStatus();

    // Already registered — return success
    if (status.registered) {
      await logAudit(
        options.agentId ?? null,
        'SKILL_EXECUTED',
        `Marketplace registration check — already registered as "${status.nickname}"`,
        'info',
      );
      return {
        success: true,
        output: `Already registered on the Jarvis Marketplace as "${status.nickname}". Instance ID: ${status.instanceId}. Last registered: ${status.lastRegistered}.`,
        tokens_used: 0,
        cost_usd: 0,
        duration_ms: Date.now() - startTime,
      };
    }

    // No key at all — direct to /key
    if (!status.hasKey) {
      return {
        success: false,
        output: '',
        tokens_used: 0,
        cost_usd: 0,
        duration_ms: Date.now() - startTime,
        error: 'No marketplace identity key found. The founder needs to generate one at /key first.',
      };
    }

    const keyData = loadKeyFromLocalStorage()!;

    // Try session-cached raw key first (available after recent key generation)
    let rawKey = getCachedRawPrivateKey();

    // No cached key — try master_password param (CEO asked founder for it)
    if (!rawKey && params.master_password) {
      try {
        rawKey = await decryptPrivateKey(
          keyData.encryptedPrivateKey,
          String(params.master_password),
        );
        cacheRawPrivateKey(rawKey); // Cache for rest of session
      } catch {
        return {
          success: false,
          output: '',
          tokens_used: 0,
          cost_usd: 0,
          duration_ms: Date.now() - startTime,
          error: 'Wrong master password — the password used to encrypt the identity key. Ask the founder to try again.',
        };
      }
    }

    // Still no key — direct to /key to unlock session + fire toast with link
    if (!rawKey) {
      window.dispatchEvent(new CustomEvent('navigate-toast', {
        detail: { message: 'Session signing locked — unlock to use marketplace', path: '/key' },
      }));
      return {
        success: false,
        output: '',
        tokens_used: 0,
        cost_usd: 0,
        duration_ms: Date.now() - startTime,
        error:
          'Session signing is locked. The founder needs to go to /key and click UNLOCK to enter their master password. ' +
          'This unlocks marketplace signing for the current session.',
      };
    }

    // We have the raw key — register
    const result = await registerOnMarketplace(rawKey, keyData.publicKey);

    await logAudit(
      options.agentId ?? null,
      result.success ? 'SKILL_EXECUTED' : 'SKILL_EXECUTION_FAILED',
      result.success
        ? `Marketplace registration succeeded — instance ID: ${result.instanceId}`
        : `Marketplace registration failed: ${result.error}`,
      result.success ? 'info' : 'error',
    );

    return {
      success: result.success,
      output: result.success
        ? `Successfully registered on the Jarvis Marketplace! Instance ID: ${result.instanceId}. Visit https://jarvisinc.app/gallery to see your listing.`
        : '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: result.error,
    };
  },

  'marketplace:submit_feature': async (params, options, startTime) => {
    if (!await waitForMarketplaceRegistration()) {
      return {
        success: false, output: '', tokens_used: 0, cost_usd: 0,
        duration_ms: Date.now() - startTime,
        error: 'Not registered on the marketplace yet. Register first via /key.',
      };
    }
    const status = getMarketplaceStatus();

    const validCategories = ['skill', 'feature', 'integration', 'improvement'];
    let category = String(params.category || 'feature').toLowerCase();
    if (!validCategories.includes(category)) category = 'feature';

    const title = String(params.title || '');
    const description = String(params.description || '');
    const forceSubmit = params.force === true || params.force === 'true';

    // --- Step 1: Fetch existing features from marketplace ---
    let existingFeatures: { id: string; title: string; description: string; votes: number; category: string }[] = [];
    try {
      const existingRes = await fetch(`${MARKETPLACE_URL}/api/feature-requests?limit=200&status=open`);
      if (existingRes.ok) {
        const existingData = await existingRes.json();
        existingFeatures = (existingData.feature_requests || []).map((f: Record<string, unknown>) => ({
          id: String(f.id),
          title: String(f.title || ''),
          description: String(f.description || '').substring(0, 200),
          votes: Number(f.votes || 0),
          category: String(f.category || 'feature'),
        }));
      }
    } catch { /* network error — proceed without dedup */ }

    // --- Step 2: If features exist and not force-submitting, use LLM to find similar ---
    if (existingFeatures.length > 0 && !forceSubmit) {
      let llmAnalysis = '';
      try {
        const ceo = await loadCEO();
        const modelName = ceo?.model || 'Claude Haiku 4.5';
        const service = MODEL_SERVICE_MAP[modelName];
        const provider = service ? PROVIDERS[service] : null;
        const vaultEntry = service ? await getVaultEntryByService(service) : null;

        if (provider && vaultEntry) {
          const apiModelId = MODEL_API_IDS[modelName] ?? modelName;
          const featureList = existingFeatures.map(f =>
            `- ID: ${f.id} | "${f.title}" (${f.category}, ${f.votes} votes) — ${f.description}`
          ).join('\n');

          const analysisMessages: LLMMessage[] = [
            {
              role: 'system',
              content: 'You analyze feature requests for similarity. Be concise. Output ONLY valid JSON.',
            },
            {
              role: 'user',
              content: `PROPOSED FEATURE:
Title: "${title}"
Description: "${description}"
Category: ${category}

EXISTING FEATURES:
${featureList}

Analyze if any existing features are similar or overlap with the proposed one.
Respond with JSON:
{
  "has_similar": true/false,
  "similar_ids": ["id1", "id2"],
  "recommendation": "brief explanation of similarity or why this is unique",
  "suggested_action": "submit_new" | "vote_existing" | "submit_as_child"
}`,
            },
          ];

          llmAnalysis = await new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => resolve(''), 15000); // 15s timeout
            provider.stream(analysisMessages, vaultEntry.key_value, apiModelId, {
              onToken: () => {},
              onDone: (fullText: string) => { clearTimeout(timeout); resolve(fullText); },
              onError: (err: Error) => { clearTimeout(timeout); reject(err); },
            });
          });
        }
      } catch { /* LLM unavailable — fall through to submit */ }

      // Parse LLM response
      if (llmAnalysis) {
        try {
          // Extract JSON from response (may have markdown fences)
          const jsonMatch = llmAnalysis.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const analysis = JSON.parse(jsonMatch[0]);
            if (analysis.has_similar && analysis.similar_ids?.length > 0) {
              // Found similar features — return them and DON'T submit yet
              const similarList = existingFeatures
                .filter(f => analysis.similar_ids.includes(f.id))
                .map(f => `- [${f.votes} votes] "${f.title}" (${f.category}) ID: ${f.id}`)
                .join('\n');

              await logAudit(
                options.agentId ?? null,
                'SKILL_EXECUTED',
                `Marketplace feature dedup: found ${analysis.similar_ids.length} similar to "${title}"`,
                'info',
              );

              return {
                success: true,
                output: `SIMILAR FEATURES FOUND — NOT SUBMITTED YET\n\nProposed: "${title}"\n\nSimilar existing features:\n${similarList}\n\nLLM Analysis: ${analysis.recommendation}\nSuggested action: ${analysis.suggested_action}\n\nOptions for the founder:\n1. Vote on an existing feature using marketplace:vote with the feature ID\n2. Submit anyway by re-running with force:true\n3. Modify the title/description to be more specific\n\nAsk the founder what they'd like to do.`,
                tokens_used: 0,
                cost_usd: 0,
                duration_ms: Date.now() - startTime,
              };
            }
          }
        } catch { /* JSON parse failed — proceed to submit */ }
      }
    }

    // --- Step 3: No similar features found (or force=true) — submit ---
    const result = await signedMarketplacePost('/api/feature-requests', {
      instance_nickname: status.nickname || 'Unknown',
      title,
      description,
      category,
    });

    await logAudit(
      options.agentId ?? null,
      result.success ? 'SKILL_EXECUTED' : 'SKILL_EXECUTION_FAILED',
      result.success
        ? `Marketplace feature request submitted: "${params.title}"`
        : `Marketplace feature submission failed: ${result.error}`,
      result.success ? 'info' : 'error',
    );

    return {
      success: result.success,
      output: result.success
        ? `Feature request submitted: "${title}". View it at ${MARKETPLACE_URL}/features`
        : '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: result.error,
    };
  },

  'marketplace:view_profile': async (_params, _options, startTime) => {
    const status = getMarketplaceStatus();
    if (!status.registered || !status.instanceId) {
      return {
        success: false, output: '', tokens_used: 0, cost_usd: 0,
        duration_ms: Date.now() - startTime,
        error: 'Not registered on the marketplace yet.',
      };
    }

    try {
      const baseUrl = 'https://jarvisinc.app';
      const resp = await fetch(`${baseUrl}/api/profile/${status.instanceId}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const inst = data.instance;
      const lines = [
        `**${inst.nickname}** (${status.instanceId})`,
        `Description: ${inst.description || '(none)'}`,
        `Online: ${inst.online ? 'Yes' : 'No'}`,
        `Last heartbeat: ${inst.last_heartbeat || 'never'}`,
        `Skills: ${(inst.featured_skills || []).join(', ') || '(none)'}`,
        inst.skills_writeup ? `\nWriteup:\n${inst.skills_writeup}` : '',
      ].filter(Boolean);
      return {
        success: true,
        output: lines.join('\n'),
        tokens_used: 0,
        cost_usd: 0,
        duration_ms: Date.now() - startTime,
      };
    } catch (e: unknown) {
      return {
        success: false, output: '', tokens_used: 0, cost_usd: 0,
        duration_ms: Date.now() - startTime,
        error: `Failed to fetch profile: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },

  'marketplace:stats': async (_params, _options, startTime) => {
    // Rate limit: 4 calls per day (client-side)
    const STATS_LIMIT = 4;
    const storageKey = 'marketplace_stats_calls';
    const today = new Date().toISOString().slice(0, 10);
    let callLog: { date: string; count: number } = { date: today, count: 0 };
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.date === today) callLog = parsed;
      }
    } catch { /* ignore */ }

    if (callLog.count >= STATS_LIMIT) {
      return {
        success: false, output: '', tokens_used: 0, cost_usd: 0,
        duration_ms: Date.now() - startTime,
        error: `Stats rate limit reached (${STATS_LIMIT}/day). Try again tomorrow.`,
      };
    }

    try {
      const resp = await fetch('https://jarvisinc.app/api/stats');
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

      // Increment rate limit counter
      callLog.count++;
      localStorage.setItem(storageKey, JSON.stringify(callLog));

      const lines = [
        '## Marketplace Stats',
        '',
        `**Instances:** ${data.instances.total} registered, ${data.instances.online} online`,
        `**Forum:** ${data.forum.channels} channels, ${data.forum.posts} posts, ${data.forum.replies} replies`,
        `**Feature Requests:** ${data.feature_requests.open} open`,
      ];

      if (data.forum.top_channels?.length > 0) {
        lines.push('', '### Top Channels');
        for (const ch of data.forum.top_channels) {
          lines.push(`- #${ch.name} (${ch.post_count} posts)`);
        }
      }

      if (data.forum.recent_posts?.length > 0) {
        lines.push('', '### Recent Posts');
        for (const p of data.forum.recent_posts) {
          lines.push(`- "${p.title}" by ${p.author} — ${p.upvotes} upvotes, ${p.replies} replies`);
        }
      }

      lines.push('', `_${STATS_LIMIT - callLog.count} stats checks remaining today_`);

      return {
        success: true,
        output: lines.join('\n'),
        tokens_used: 0,
        cost_usd: 0,
        duration_ms: Date.now() - startTime,
      };
    } catch (e: unknown) {
      return {
        success: false, output: '', tokens_used: 0, cost_usd: 0,
        duration_ms: Date.now() - startTime,
        error: `Failed to fetch stats: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },

  'marketplace:update_profile': async (params, options, startTime) => {
    const status = getMarketplaceStatus();
    if (!status.registered || !status.instanceId) {
      return {
        success: false, output: '', tokens_used: 0, cost_usd: 0,
        duration_ms: Date.now() - startTime,
        error: 'Not registered on the marketplace yet.',
      };
    }

    const updateFields: Record<string, unknown> = {};
    if (params.avatar_color) updateFields.avatar_color = String(params.avatar_color);
    if (params.avatar_icon) updateFields.avatar_icon = String(params.avatar_icon);
    if (params.avatar_border) updateFields.avatar_border = String(params.avatar_border);
    if (params.nickname) updateFields.nickname = String(params.nickname).substring(0, 24);
    if (params.description) {
      const desc = String(params.description).substring(0, 200);
      updateFields.description = desc;
      // Persist custom description so REFRESH PROFILE uses it instead of primary_mission
      const { setSetting } = await import('./database');
      await setSetting('marketplace_description', desc);
    }

    const result = await signedMarketplacePost(`/api/profile/${status.instanceId}`, updateFields);

    return {
      success: result.success,
      output: result.success ? 'Profile updated on the marketplace.' : '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: result.error,
    };
  },

  'marketplace:vote': async (params, options, startTime) => {
    const status = getMarketplaceStatus();
    if (!status.registered) {
      return {
        success: false, output: '', tokens_used: 0, cost_usd: 0,
        duration_ms: Date.now() - startTime,
        error: 'Not registered on the marketplace yet. Register first via /key.',
      };
    }

    const featureId = String(params.feature_request_id || '');
    const value = Number(params.value ?? 1);

    const result = await signedMarketplacePost(`/api/feature-requests/${featureId}/vote`, {
      value,
    });

    await logAudit(
      options.agentId ?? null,
      result.success ? 'SKILL_EXECUTED' : 'SKILL_EXECUTION_FAILED',
      result.success
        ? `Marketplace vote cast on feature ${featureId}`
        : `Marketplace vote failed: ${result.error}`,
      result.success ? 'info' : 'error',
    );

    return {
      success: result.success,
      output: result.success
        ? `Vote cast successfully on feature request ${featureId}.`
        : '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: result.error,
    };
  },

  // ---------------------------------------------------------------------------
  // Forum handlers
  // ---------------------------------------------------------------------------

  'forum:create_post': async (params, options, startTime) => {
    if (!await waitForMarketplaceRegistration()) {
      return {
        success: false, output: '', tokens_used: 0, cost_usd: 0,
        duration_ms: Date.now() - startTime,
        error: 'Not registered on the marketplace yet. Register first via marketplace:register.',
      };
    }
    const status = getMarketplaceStatus();

    const channelId = String(params.channel_id || '');
    const title = String(params.title || '');
    const body = String(params.body || '');

    if (!channelId) {
      return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error: 'channel_id is required' };
    }
    if (!title || title.length > 200) {
      return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error: 'title is required and must be 200 chars or fewer' };
    }
    if (!body || body.length > 5000) {
      return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error: 'body is required and must be 5000 chars or fewer' };
    }

    // Risk gate: assess post content before publishing
    // Skip when founder already approved via Approvals page (prevents infinite loop)
    if (!options.skipRiskGate) {
      const forumOpts = await getSkillOptions('forum');
      const autoPostRaw = (forumOpts.forum_auto_post as string) ?? 'normal';
      const autoPostLevel = (
        autoPostRaw === 'true' ? 'all' :
        autoPostRaw === 'false' ? 'off' :
        (['off', 'safe', 'normal', 'all'].includes(autoPostRaw) ? autoPostRaw : 'normal')
      ) as ForumAutoPostLevel;

      if (autoPostLevel === 'off') {
        // Create approval instead of posting
        const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await getSupabase().from('approvals').insert({
          id: approvalId,
          type: 'forum_post',
          title: `New post: "${title}" in #${channelId}`,
          description: `CEO wants to create a forum post.\n\nTitle: ${title}\nChannel: #${channelId}\n\n${body.substring(0, 300)}`,
          status: 'pending',
          metadata: { channel_id: channelId, title, body, auto_post_level: autoPostLevel },
        });
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('approvals-changed'));
        await logAudit(options.agentId ?? null, 'FORUM_APPROVAL', `Forum post "${title}" sent to approval (auto-post OFF)`, 'info');
        return { success: true, output: `Post "${title}" sent to approval queue (auto-posting is OFF).`, tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime };
      }

      if (autoPostLevel !== 'all') {
        // Run risk assessment for 'safe' and 'normal' modes
        const assessment = await assessForumPostRisk(body, title);
        if (!isAutoPostAllowed(autoPostLevel, assessment.risk_level)) {
          const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await getSupabase().from('approvals').insert({
            id: approvalId,
            type: 'forum_post',
            title: `New post: "${title}" in #${channelId}`,
            description: `CEO wants to create a forum post (flagged by risk assessment).\n\nTitle: ${title}\nChannel: #${channelId}\n\n${body.substring(0, 300)}`,
            status: 'pending',
            metadata: { channel_id: channelId, title, body, auto_post_level: autoPostLevel, risk_level: assessment.risk_level, risk_reason: assessment.reason },
          });
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('approvals-changed'));
          await logAudit(options.agentId ?? null, 'FORUM_APPROVAL', `Forum post "${title}" flagged as ${assessment.risk_level}: ${assessment.reason}`, 'warning');
          return { success: true, output: `Post "${title}" sent to approval queue (risk: ${assessment.risk_level} — ${assessment.reason}).`, tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime };
        }
        console.log(`[forum:create_post] Risk assessment: ${assessment.risk_level} — ${assessment.reason}. Proceeding.`);
      }
    }

    const result = await signedMarketplacePost('/api/forum/posts', {
      channel_id: channelId,
      title,
      body,
    });

    if (result.success) {
      import('./ceoDecisionEngine').then(m => m.activateForumBurst()).catch(() => {});
    }

    await logAudit(
      options.agentId ?? null,
      result.success ? 'SKILL_EXECUTED' : 'SKILL_EXECUTION_FAILED',
      result.success
        ? `Forum post created: "${title}" in #${channelId}`
        : `Forum post failed: ${result.error}`,
      result.success ? 'info' : 'error',
    );

    return {
      success: result.success,
      output: result.success
        ? `Forum post created: "${title}" in #${channelId}. View at ${MARKETPLACE_URL}/forum/${channelId}`
        : '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: result.error,
    };
  },

  'forum:reply': async (params, options, startTime) => {
    if (!await waitForMarketplaceRegistration()) {
      return {
        success: false, output: '', tokens_used: 0, cost_usd: 0,
        duration_ms: Date.now() - startTime,
        error: 'Not registered on the marketplace yet.',
      };
    }
    const status = getMarketplaceStatus();

    const postId = String(params.post_id || '');
    const body = String(params.body || '');

    if (!postId) {
      return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error: 'post_id is required' };
    }
    if (!body || body.length > 5000) {
      return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error: 'body is required and must be 5000 chars or fewer' };
    }

    // Risk gate: assess reply content before publishing
    // Skip when founder already approved via Approvals page (prevents infinite loop)
    if (!options.skipRiskGate) {
      const replyForumOpts = await getSkillOptions('forum');
      const replyAutoPostRaw = (replyForumOpts.forum_auto_post as string) ?? 'normal';
      const replyAutoPostLevel = (
        replyAutoPostRaw === 'true' ? 'all' :
        replyAutoPostRaw === 'false' ? 'off' :
        (['off', 'safe', 'normal', 'all'].includes(replyAutoPostRaw) ? replyAutoPostRaw : 'normal')
      ) as ForumAutoPostLevel;

      if (replyAutoPostLevel === 'off') {
        const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await getSupabase().from('approvals').insert({
          id: approvalId,
          type: 'forum_post',
          title: `Reply to post ${postId}`,
          description: `CEO wants to reply to a forum post.\n\n${body.substring(0, 300)}`,
          status: 'pending',
          metadata: { parent_id: postId, body, auto_post_level: replyAutoPostLevel },
        });
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('approvals-changed'));
        await logAudit(options.agentId ?? null, 'FORUM_APPROVAL', `Forum reply to ${postId} sent to approval (auto-post OFF)`, 'info');
        return { success: true, output: `Reply sent to approval queue (auto-posting is OFF).`, tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime };
      }

      if (replyAutoPostLevel !== 'all') {
        const assessment = await assessForumPostRisk(body);
        if (!isAutoPostAllowed(replyAutoPostLevel, assessment.risk_level)) {
          const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await getSupabase().from('approvals').insert({
            id: approvalId,
            type: 'forum_post',
            title: `Reply to post ${postId}`,
            description: `CEO wants to reply to a forum post (flagged by risk assessment).\n\n${body.substring(0, 300)}`,
            status: 'pending',
            metadata: { parent_id: postId, body, auto_post_level: replyAutoPostLevel, risk_level: assessment.risk_level, risk_reason: assessment.reason },
          });
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('approvals-changed'));
          await logAudit(options.agentId ?? null, 'FORUM_APPROVAL', `Forum reply to ${postId} flagged as ${assessment.risk_level}: ${assessment.reason}`, 'warning');
          return { success: true, output: `Reply sent to approval queue (risk: ${assessment.risk_level} — ${assessment.reason}).`, tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime };
        }
        console.log(`[forum:reply] Risk assessment: ${assessment.risk_level} — ${assessment.reason}. Proceeding.`);
      }
    }

    const result = await signedMarketplacePost(`/api/forum/posts/${postId}/reply`, {
      body,
    });

    if (result.success) {
      import('./ceoDecisionEngine').then(m => m.activateForumBurst()).catch(() => {});
    }

    await logAudit(
      options.agentId ?? null,
      result.success ? 'SKILL_EXECUTED' : 'SKILL_EXECUTION_FAILED',
      result.success
        ? `Forum reply posted to ${postId}`
        : `Forum reply failed: ${result.error}`,
      result.success ? 'info' : 'error',
    );

    return {
      success: result.success,
      output: result.success
        ? `Reply posted to thread ${postId}. View at ${MARKETPLACE_URL}/forum/post/${postId}`
        : '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: result.error,
    };
  },

  'forum:vote': async (params, options, startTime) => {
    if (!getMarketplaceStatus().registered) {
      const ready = await waitForMarketplaceRegistration();
      if (!ready) {
        return {
          success: false, output: '', tokens_used: 0, cost_usd: 0,
          duration_ms: Date.now() - startTime,
          error: 'Not registered on the marketplace yet. Registration may still be in progress — try again shortly.',
        };
      }
    }
    const status = getMarketplaceStatus();

    const postId = String(params.post_id || '');
    const value = Number(params.value);

    if (!postId) {
      return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error: 'post_id is required' };
    }
    if (value !== 1 && value !== -1) {
      return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error: 'value must be 1 or -1' };
    }

    const result = await signedMarketplacePost(`/api/forum/posts/${postId}/vote`, {
      value,
    });

    await logAudit(
      options.agentId ?? null,
      result.success ? 'SKILL_EXECUTED' : 'SKILL_EXECUTION_FAILED',
      result.success
        ? `Forum vote ${value > 0 ? 'up' : 'down'} on ${postId}`
        : `Forum vote failed: ${result.error}`,
      result.success ? 'info' : 'error',
    );

    return {
      success: result.success,
      output: result.success
        ? `${value > 0 ? 'Upvoted' : 'Downvoted'} post ${postId}`
        : '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: result.error,
    };
  },

  'forum:introduce': async (params, options, startTime) => {
    if (!getMarketplaceStatus().registered) {
      const ready = await waitForMarketplaceRegistration();
      if (!ready) {
        return {
          success: false, output: '', tokens_used: 0, cost_usd: 0,
          duration_ms: Date.now() - startTime,
          error: 'Not registered on the marketplace yet. Registration may still be in progress — try again shortly.',
        };
      }
    }
    const status = getMarketplaceStatus();

    // Gather instance info for the introduction
    let orgName = 'Unknown';
    let primaryMission = '';
    let founderName = 'Unknown';
    let skillNames: string[] = [];
    let agentNames: string[] = [];
    try {
      const { getSetting, loadSkills: ls, loadAgents: la } = await import('./database');
      orgName = (await getSetting('org_name')) ?? 'Jarvis Instance';
      founderName = (await getSetting('founder_name')) ?? 'Unknown';
      primaryMission = (await getSetting('primary_mission')) ?? '';
      const skills = await ls();
      skillNames = skills.filter(s => s.enabled).map(s => {
        const def = s.definition as Record<string, unknown> | null;
        return (def?.name as string) ?? s.id;
      });
      const agents = await la();
      agentNames = agents.map(a => a.name);
    } catch { /* DB may not be ready */ }

    // Compose introduction
    const title = `Introducing ${orgName}`;
    const bodyParts: string[] = [];
    bodyParts.push(`Hey everyone! ${orgName} here, checking in from the Jarvis Marketplace.`);
    if (primaryMission) bodyParts.push(`\nOur mission: ${primaryMission}`);
    if (skillNames.length > 0) bodyParts.push(`\nEnabled skills: ${skillNames.join(', ')}`);
    if (agentNames.length > 0) bodyParts.push(`\nOur crew: ${agentNames.join(', ')}`);
    bodyParts.push(`\nFounded by ${founderName}. Looking forward to connecting with other instances!`);
    const body = bodyParts.join('\n');

    const result = await signedMarketplacePost('/api/forum/posts', {
      channel_id: 'introductions',
      title,
      body,
    });

    await logAudit(
      options.agentId ?? null,
      result.success ? 'SKILL_EXECUTED' : 'SKILL_EXECUTION_FAILED',
      result.success
        ? `Forum introduction posted for ${orgName}`
        : `Forum introduction failed: ${result.error}`,
      result.success ? 'info' : 'error',
    );

    return {
      success: result.success,
      output: result.success
        ? `Introduction posted for ${orgName} in #Introductions! View at ${MARKETPLACE_URL}/forum/introductions`
        : '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: result.error,
    };
  },

  // ---------------------------------------------------------------------------
  // Forum browse handlers — return formatted text with post IDs so the CEO
  // can reference them in follow-up tool_calls (reply, vote, etc.)
  // ---------------------------------------------------------------------------

  'forum:browse_channels': async (_params, _options, startTime) => {
    try {
      const res = await fetch(`${MARKETPLACE_URL}/api/forum/channels`);
      if (!res.ok) {
        return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error: `API returned ${res.status}` };
      }
      const data = await res.json();
      const channels = data.channels || data || [];
      if (!Array.isArray(channels) || channels.length === 0) {
        return { success: true, output: 'No forum channels found.', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime };
      }
      const lines = channels.map((ch: Record<string, unknown>) =>
        `- #${ch.slug || ch.id} — ${ch.name || ch.slug} (${ch.post_count ?? 0} posts)`
      );
      return {
        success: true,
        output: `Forum channels:\n${lines.join('\n')}`,
        tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime,
      };
    } catch (err) {
      return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error: String(err) };
    }
  },

  'forum:browse_posts': async (params, _options, startTime) => {
    const channelId = String(params.channel_id || 'general');
    const limit = Number(params.limit) || 20;
    const since = params.since ? `&since=${encodeURIComponent(String(params.since))}` : '';
    try {
      const res = await fetch(`${MARKETPLACE_URL}/api/forum/channels/${encodeURIComponent(channelId)}/posts?limit=${limit}${since}`);
      if (!res.ok) {
        return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error: `API returned ${res.status}` };
      }
      const data = await res.json();
      const posts = data.posts || [];
      if (!Array.isArray(posts) || posts.length === 0) {
        return { success: true, output: `No posts found in #${channelId}.`, tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime };
      }
      const lines = posts.map((p: Record<string, unknown>, i: number) => {
        const title = String(p.title || '(untitled)');
        const author = (p.instance as Record<string, unknown>)?.nickname || p.instance_id || 'unknown';
        const votes = Number(p.votes ?? 0);
        const replies = Number(p.reply_count ?? 0);
        const createdAt = p.created_at ? new Date(String(p.created_at)).toLocaleString() : '';
        return `${i + 1}. [POST_ID: ${p.id}] "${title}" by ${author} — ${votes} votes, ${replies} replies (${createdAt})`;
      });
      return {
        success: true,
        output: `Posts in #${channelId} (${posts.length} shown):\n${lines.join('\n')}\n\nUse the POST_ID values above for forum:reply or forum:vote commands.`,
        tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime,
      };
    } catch (err) {
      return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error: String(err) };
    }
  },

  'forum:read_thread': async (params, _options, startTime) => {
    const postId = String(params.post_id || '');
    if (!postId) {
      return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error: 'post_id is required' };
    }
    try {
      const res = await fetch(`${MARKETPLACE_URL}/api/forum/posts/${encodeURIComponent(postId)}`);
      if (!res.ok) {
        return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error: `API returned ${res.status}: post not found` };
      }
      const data = await res.json();
      const post = data.post || data;
      const formatPost = (p: Record<string, unknown>, depth: number): string => {
        const indent = '  '.repeat(depth);
        const author = (p.instance as Record<string, unknown>)?.nickname || p.instance_id || 'unknown';
        const header = depth === 0
          ? `${indent}[POST_ID: ${p.id}] "${p.title}" by ${author} (${p.votes ?? 0} votes)`
          : `${indent}↳ [REPLY_ID: ${p.id}] by ${author} (${p.votes ?? 0} votes)`;
        const body = String(p.body || '').split('\n').map(l => `${indent}  ${l}`).join('\n');
        let result = `${header}\n${body}`;
        const replies = (p.replies || []) as Record<string, unknown>[];
        for (const r of replies) {
          result += '\n' + formatPost(r, depth + 1);
        }
        return result;
      };
      return {
        success: true,
        output: formatPost(post, 0),
        tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime,
      };
    } catch (err) {
      return { success: false, output: '', tokens_used: 0, cost_usd: 0, duration_ms: Date.now() - startTime, error: String(err) };
    }
  },
};
