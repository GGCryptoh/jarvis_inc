/**
 * Skill Executor — Runs skill commands via LLM providers
 * ========================================================
 * Resolves the skill, builds a prompt, calls the LLM, and returns the result.
 * Logs execution to the audit log.
 */

import { resolveSkill, type FullSkillDefinition } from './skillResolver';
import { getVaultEntryByService, logAudit } from './database';
import { MODEL_SERVICE_MAP, MODEL_API_IDS } from './models';
import type { LLMMessage, LLMProvider } from './llm/types';
import { anthropicProvider } from './llm/providers/anthropic';
import { openaiProvider, deepseekProvider, xaiProvider } from './llm/providers/openai';
import { googleProvider } from './llm/providers/google';

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
export async function executeSkill(
  skillId: string,
  commandName: string,
  params: Record<string, unknown>,
  modelOverride?: string,
): Promise<SkillExecutionResult> {
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

  // 2. Determine model
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
    const estimatedTokens = Math.ceil((prompt.length + output.length) / 4);
    // Rough cost estimate: $0.01 per 1000 tokens (simplified)
    const estimatedCost = estimatedTokens * 0.00001;

    await logAudit(
      null,
      'SKILL_EXECUTED',
      `Skill "${skill.name}" command "${commandName}" completed in ${durationMs}ms using ${modelName}`,
      'info',
    );

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
