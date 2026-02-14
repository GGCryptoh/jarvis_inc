/**
 * Skill Executor — Runs skill commands via LLM providers
 * ========================================================
 * Resolves the skill, builds a prompt, calls the LLM, and returns the result.
 * Logs execution to the audit log.
 */

import { resolveSkill, type FullSkillDefinition } from './skillResolver';
import { getVaultEntryByService, logAudit } from './database';
import { MODEL_SERVICE_MAP, MODEL_API_IDS, estimateCost } from './models';
import { logUsage } from './llmUsage';
import type { LLMMessage, LLMProvider } from './llm/types';
import { anthropicProvider } from './llm/providers/anthropic';
import { openaiProvider, deepseekProvider, xaiProvider } from './llm/providers/openai';
import { googleProvider } from './llm/providers/google';
import { executeCLISkill } from './cliSkillHandlers';

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
}

// ---------------------------------------------------------------------------
// Direct API handlers for api_key skills
// ---------------------------------------------------------------------------

async function executeImageGeneration(
  skill: FullSkillDefinition,
  commandName: string,
  params: Record<string, unknown>,
  options: SkillExecutionOptions,
  startTime: number,
): Promise<SkillExecutionResult> {
  // Get OpenAI API key from vault
  const vaultEntry = await getVaultEntryByService('OpenAI');
  if (!vaultEntry) {
    return {
      success: false,
      output: '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: 'No OpenAI API key found in the Vault. Add one to use Image Generation.',
    };
  }

  try {
    if (commandName === 'generate') {
      const prompt = params.prompt as string;
      if (!prompt) throw new Error('Image generation requires a "prompt" parameter');

      const size = (params.size as string) || '1024x1024';
      const quality = (params.quality as string) || 'standard';
      const style = (params.style as string) || 'vivid';
      const model = 'dall-e-3';

      const resp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${vaultEntry.key_value}`,
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size,
          quality,
          style,
          response_format: 'b64_json',
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new Error(`OpenAI Images API returned ${resp.status}: ${errBody}`);
      }

      const data = await resp.json();
      const b64 = data.data?.[0]?.b64_json;
      const revisedPrompt = data.data?.[0]?.revised_prompt;

      if (!b64) throw new Error('No image data returned from OpenAI');

      // Build permanent data URI
      const dataUri = `data:image/png;base64,${b64}`;

      // Estimate cost: DALL-E 3 standard = $0.040/image, HD = $0.080/image
      const costUsd = quality === 'hd' ? 0.08 : 0.04;

      const durationMs = Date.now() - startTime;

      await logAudit(
        options.agentId ?? null,
        'SKILL_EXECUTED',
        `Image generated via DALL-E 3 (${size}, ${quality}) in ${durationMs}ms`,
        'info',
      );

      // Log usage
      logUsage({
        provider: 'OpenAI',
        model: 'DALL-E 3',
        inputTokens: 0,
        outputTokens: 0,
        context: 'skill_execution',
        agentId: options.agentId,
        missionId: options.missionId,
        costOverride: costUsd,
      }).catch(() => {});

      const output = [
        `## Generated Image`,
        ``,
        `![${prompt.slice(0, 80)}](${dataUri})`,
        ``,
        `**Prompt:** ${prompt}`,
        revisedPrompt ? `**Revised prompt:** ${revisedPrompt}` : '',
        `**Size:** ${size} | **Quality:** ${quality} | **Style:** ${style}`,
      ].filter(Boolean).join('\n');

      return {
        success: true,
        output,
        tokens_used: 0,
        cost_usd: costUsd,
        duration_ms: durationMs,
      };
    }

    // edit and variation commands — not yet supported browser-side
    return {
      success: false,
      output: '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: `Image "${commandName}" command is not yet supported. Only "generate" is available.`,
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

async function executeGeminiImageGeneration(
  skill: FullSkillDefinition,
  commandName: string,
  params: Record<string, unknown>,
  options: SkillExecutionOptions,
  startTime: number,
): Promise<SkillExecutionResult> {
  const vaultEntry = await getVaultEntryByService('Google');
  if (!vaultEntry) {
    return {
      success: false,
      output: '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: 'No Google API key found in the Vault. Add one to use Gemini Image Generation.',
    };
  }

  try {
    if (commandName === 'generate') {
      const prompt = params.prompt as string;
      if (!prompt) throw new Error('Image generation requires a "prompt" parameter');

      const model = 'gemini-2.5-flash-preview-image-generation';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${vaultEntry.key_value}`;

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new Error(`Gemini Images API returned ${resp.status}: ${errBody}`);
      }

      const data = await resp.json();
      const parts = data.candidates?.[0]?.content?.parts ?? [];

      let imageDataUri: string | null = null;
      let textResponse = '';

      for (const part of parts) {
        if (part.inlineData) {
          const mime = part.inlineData.mimeType ?? 'image/png';
          imageDataUri = `data:${mime};base64,${part.inlineData.data}`;
        }
        if (part.text) {
          textResponse += part.text;
        }
      }

      if (!imageDataUri) throw new Error('No image returned from Gemini');

      // Gemini 2.5 Flash image: ~$0.02-0.04 per generation
      const costUsd = 0.04;
      const durationMs = Date.now() - startTime;

      await logAudit(
        options.agentId ?? null,
        'SKILL_EXECUTED',
        `Image generated via Gemini (Nano Banana) in ${durationMs}ms`,
        'info',
      );

      logUsage({
        provider: 'Google',
        model: 'Gemini 2.5 Flash Image',
        inputTokens: 0,
        outputTokens: 0,
        context: 'skill_execution',
        agentId: options.agentId,
        missionId: options.missionId,
        costOverride: costUsd,
      }).catch(() => {});

      const output = [
        `## Generated Image (Gemini)`,
        ``,
        `![${prompt.slice(0, 80)}](${imageDataUri})`,
        ``,
        `**Prompt:** ${prompt}`,
        textResponse ? `**Model notes:** ${textResponse}` : '',
        ``,
        `> Generated via Gemini Nano Banana (gemini-2.5-flash image generation)`,
      ].filter(Boolean).join('\n');

      return {
        success: true,
        output,
        tokens_used: 0,
        cost_usd: costUsd,
        duration_ms: durationMs,
      };
    }

    return {
      success: false,
      output: '',
      tokens_used: 0,
      cost_usd: 0,
      duration_ms: Date.now() - startTime,
      error: `Gemini image "${commandName}" command is not yet supported. Only "generate" is available.`,
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
// API handler registry — keyed by `execution_handler` from skill JSON
// ---------------------------------------------------------------------------

type ApiHandler = (
  skill: FullSkillDefinition,
  commandName: string,
  params: Record<string, unknown>,
  options: SkillExecutionOptions,
  startTime: number,
) => Promise<SkillExecutionResult>;

const API_HANDLERS: Record<string, ApiHandler> = {
  openai_image_generation: executeImageGeneration,
  gemini_image_generation: executeGeminiImageGeneration,
};

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

  // 1b. CLI skill? Execute via HTTP handler — no LLM needed
  const connType = typeof skill.connection === 'string'
    ? skill.connection
    : (skill.connection as Record<string, unknown>)?.type as string ?? '';

  if (connType === 'cli') {
    const cliResult = await executeCLISkill(skillId, commandName, params);
    if (cliResult) {
      const durationMs = Date.now() - startTime;
      await logAudit(
        options.agentId ?? null,
        'SKILL_EXECUTED',
        `CLI skill "${skill.name}" command "${commandName}" completed in ${durationMs}ms via HTTP`,
        'info',
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

  // 1c. API skill? Dispatch to named execution handler — no LLM reasoning needed
  const handler = skill.executionHandler ?? '';
  if (handler && API_HANDLERS[handler]) {
    return API_HANDLERS[handler](skill, commandName, params, options, startTime);
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

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: `You are an AI agent executing the "${skill.name}" skill. Be precise, thorough, and return structured output when possible.`,
    },
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
      'info',
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
