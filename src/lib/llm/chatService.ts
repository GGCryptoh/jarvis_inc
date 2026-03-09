import type { LLMMessage, StreamCallbacks, LLMProvider } from './types';
import { logUsage, getCurrentMonthSpend } from '../llmUsage';
import { getSupabase } from '../supabase';
import type { ChatMessageRow } from '../database';
import {
  loadCEO, getFounderInfo, getSetting,
  loadAgents, loadSkills, loadMissions,
  getVaultEntryByService, logAudit,
  saveApproval, saveChatMessage, loadApprovals,
  getPrompt,
} from '../database';
import { MODEL_SERVICE_MAP, MODEL_API_IDS } from '../models';

/** Strip base64 data URIs from message text to avoid sending megabytes to the LLM. */
function stripBase64(text: string): string {
  return text.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]{200,}/g, '[image]');
}
import { resolveSkills, getSkillSchemaCache } from '../skillResolver';
import { getSkillById } from '../skillsCache';
import { anthropicProvider } from './providers/anthropic';
import { openaiProvider, deepseekProvider, xaiProvider } from './providers/openai';
import { googleProvider } from './providers/google';
import { getMemories } from '../memory';
import { getRecentCollateralSummaries, getArchivedMemories } from '../database';
import { parseTaskPlan, dispatchTaskPlan } from '../taskDispatcher';
import { MANAGEMENT_ACTIONS, handleManagementAction } from '../managementActions';

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const PROVIDERS: Record<string, LLMProvider> = {
  Anthropic: anthropicProvider,
  OpenAI:    openaiProvider,
  Google:    googleProvider,
  DeepSeek:  deepseekProvider,
  xAI:       xaiProvider,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LLMAvailability {
  available: boolean;
  service: string;
  model: string;
  displayModel: string;
  budgetExceeded?: boolean;
  budgetSpent?: number;
  budgetLimit?: number;
}

/**
 * Check whether a real LLM is available for the CEO's configured model.
 * Requires: CEO has a model -> model maps to a service -> vault has a key for that service.
 */
export async function isLLMAvailable(): Promise<LLMAvailability> {
  const ceo = await loadCEO();
  if (!ceo) {
    console.warn('[LLM] No CEO found');
    return { available: false, service: '', model: '', displayModel: '' };
  }

  const service = MODEL_SERVICE_MAP[ceo.model] ?? '';
  if (!service) {
    console.warn('[LLM] No service mapping for model:', ceo.model);
    return { available: false, service, model: '', displayModel: ceo.model };
  }
  if (!PROVIDERS[service]) {
    console.warn('[LLM] No provider implementation for service:', service, '(model:', ceo.model + ')');
    return { available: false, service, model: '', displayModel: ceo.model };
  }

  const vaultEntry = await getVaultEntryByService(service);
  if (!vaultEntry) {
    console.warn('[LLM] No vault key for service:', service);
    return { available: false, service, model: '', displayModel: ceo.model };
  }

  const apiModelId = MODEL_API_IDS[ceo.model] ?? ceo.model;

  // Check budget — 10% grace zone for CEO housekeeping, hard stop at 110%
  const budgetStr = await getSetting('monthly_budget');
  if (budgetStr) {
    const budgetLimit = parseFloat(budgetStr);
    if (!isNaN(budgetLimit) && budgetLimit > 0) {
      const spend = await getCurrentMonthSpend();
      const hardCap = budgetLimit * 1.10; // 10% grace for CEO to explain + request extension
      if (spend.total >= hardCap) {
        console.warn(`[LLM] Hard budget cap hit: $${spend.total.toFixed(2)} / $${hardCap.toFixed(2)} (budget: $${budgetLimit.toFixed(2)})`);
        return {
          available: false, service, model: apiModelId, displayModel: ceo.model,
          budgetExceeded: true, budgetSpent: spend.total, budgetLimit,
        };
      }
      // Between 100-110%: LLM still available but flag as exceeded for UI warning
      if (spend.total >= budgetLimit) {
        return {
          available: true, service, model: apiModelId, displayModel: ceo.model,
          budgetExceeded: true, budgetSpent: spend.total, budgetLimit,
        };
      }
    }
  }

  return { available: true, service, model: apiModelId, displayModel: ceo.model };
}

/**
 * Handle an enable_skill tool call from the CEO.
 * Creates an approval request and posts a chat message with the approval card metadata.
 */
async function handleEnableSkillCall(
  skillId: string,
  skillName: string,
  conversationId?: string,
): Promise<void> {
  if (!skillId) return;

  const ceo = await loadCEO();
  const ceoName = ceo?.name ?? 'CEO';

  // Check if there's already a pending approval for this skill
  const approvals = await loadApprovals();
  const alreadyPending = approvals.some(
    a => a.status === 'pending' && a.type === 'skill_enable'
      && (a.metadata as Record<string, unknown>)?.skillId === skillId,
  );
  if (alreadyPending) return; // Don't create duplicate

  // Look up skill details from definitions + resolved skills (for risk_level)
  const skillDef = getSkillById(skillId);
  const displayName = skillName || skillDef?.name || skillId;
  const connectionType = skillDef?.serviceType === 'fixed' ? 'cli' : 'api_key';

  // Resolve risk_level from skill definition
  let riskLevel: string = 'safe';
  try {
    const resolved = await resolveSkills();
    const fullDef = resolved.find(s => s.id === skillId);
    riskLevel = fullDef?.riskLevel ?? 'safe';
  } catch { /* fallback to safe */ }

  // Create approval
  const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await saveApproval({
    id: approvalId,
    type: 'skill_enable',
    title: `Enable Skill: ${displayName}`,
    description: `CEO ${ceoName} recommends enabling "${displayName}"`,
    status: 'pending',
    metadata: { skillId, skillName: displayName, connectionType, riskLevel },
  });
  window.dispatchEvent(new Event('approvals-changed'));

  // Post a chat message with approval card metadata so the UI can render it
  if (conversationId) {
    await saveChatMessage({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      conversation_id: conversationId,
      sender: 'ceo',
      text: `I've submitted a request to enable **${displayName}**. You should see the approval card below — just approve it and we're good to go.`,
      metadata: {
        type: 'skill_approval',
        approval_id: approvalId,
        skill_id: skillId,
        skill_name: displayName,
        connection_type: connectionType,
        risk_level: riskLevel,
      },
    });
    window.dispatchEvent(new Event('chat-messages-changed'));
  }

  await logAudit(
    ceoName,
    'SKILL_APPROVAL_REQUESTED',
    `CEO requested enabling "${displayName}" skill from chat`,
    'info',
  );
}

/**
 * Stream a CEO response using a real LLM.
 * Returns an AbortController, or null if no LLM is available (caller should fallback).
 */
export async function streamCEOResponse(
  userText: string,
  conversationHistory: ChatMessageRow[],
  callbacks: StreamCallbacks,
  options?: { source?: 'web' | 'telegram' },
): Promise<AbortController | null> {
  const availability = await isLLMAvailable();
  if (!availability.available) return null;

  const ceo = (await loadCEO())!;
  const service = availability.service;
  const apiModelId = availability.model;
  const provider = PROVIDERS[service];
  const vaultEntry = (await getVaultEntryByService(service))!;

  // Build messages
  let systemPrompt = await buildCEOSystemPrompt();

  // Telegram mode: concise responses optimized for mobile
  if (options?.source === 'telegram') {
    systemPrompt += `\n\n## TELEGRAM MODE
You are responding via Telegram. Adapt your communication:
- Keep responses SHORT (1-3 sentences max, under 200 words)
- No markdown formatting (Telegram uses its own markup — just use plain text)
- No bullet lists or headers — use natural conversational sentences
- Assume the founder is on mobile — be direct and actionable
- Skip pleasantries — get to the point fast
- If a task needs detailed output, acknowledge briefly and say you'll prepare it in the dashboard
- Do NOT emit <tool_call> blocks in Telegram mode — queue actions for the next dashboard session`;
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Add conversation history (last 20 messages, strip base64 to avoid token explosion)
  const recentHistory = conversationHistory.slice(-20);
  for (const msg of recentHistory) {
    if (msg.sender === 'user') {
      messages.push({ role: 'user', content: stripBase64(msg.text) });
    } else if (msg.sender === 'ceo') {
      messages.push({ role: 'assistant', content: stripBase64(msg.text) });
    }
  }

  // Add the current user message
  messages.push({ role: 'user', content: userText });

  // Wrap callbacks to log usage
  const wrappedCallbacks: StreamCallbacks = {
    onToken: callbacks.onToken,
    onDone: (fullText, usage) => {
      // Log usage (fire-and-forget)
      const outputTokens = usage?.outputTokens ?? Math.ceil(fullText.length / 4);
      const inputTokens = usage?.inputTokens ?? Math.ceil(systemPrompt.length / 4 + userText.length / 4);
      logUsage({
        provider: service,
        model: availability.displayModel,
        inputTokens,
        outputTokens,
        context: 'ceo_chat',
        agentId: 'ceo',
      }).catch((err) => console.warn('Failed to log LLM usage:', err));
      logAudit(
        ceo.name,
        'CEO_CHAT',
        `LLM response via ${availability.displayModel} (${inputTokens + outputTokens} tokens) [conv:${conversationHistory[0]?.conversation_id ?? ''}]`,
        'info',
      ).catch(() => {});

      // Detect and dispatch task plans from CEO response — include conversation context
      const missions = parseTaskPlan(fullText);
      if (missions.length > 0) {
        const convId = conversationHistory[0]?.conversation_id;

        // Separate into three buckets
        const enableCalls = missions.flatMap(m => m.toolCalls.filter(tc => tc.name === 'enable_skill'));
        const mgmtCalls = missions.flatMap(m => m.toolCalls.filter(tc => MANAGEMENT_ACTIONS.has(tc.name)));
        const regularMissions = missions
          .map(m => ({ ...m, toolCalls: m.toolCalls.filter(tc => tc.name !== 'enable_skill' && !MANAGEMENT_ACTIONS.has(tc.name)) }))
          .filter(m => m.toolCalls.length > 0);

        // Handle enable_skill — create approval cards
        for (const call of enableCalls) {
          handleEnableSkillCall(
            call.arguments.skill_id as string,
            call.arguments.skill_name as string,
            convId,
          ).catch((err) => console.error('Enable skill failed:', err));
        }

        // Handle management actions sequentially — order matters for hires
        // (parallel would cause ID collisions from same Date.now() tick)
        (async () => {
          for (const call of mgmtCalls) {
            try {
              await handleManagementAction(call.name, call.arguments, convId);
            } catch (err) {
              console.error('Management action failed:', err);
            }
          }
        })();

        // Dispatch remaining regular skill missions
        if (regularMissions.length > 0) {
          dispatchTaskPlan(regularMissions, availability.displayModel, {
            conversationExcerpt: conversationHistory,
            conversationId: convId,
            founderPresent: true,
          }).catch((err) => console.error('Task dispatch failed:', err));
        }
      }

      callbacks.onDone(fullText, usage);
    },
    onError: callbacks.onError,
  };

  return provider.stream(messages, vaultEntry.key_value, apiModelId, wrappedCallbacks);
}

// ---------------------------------------------------------------------------
// Agent Chat
// ---------------------------------------------------------------------------

export interface AgentChatInfo {
  id: string;
  name: string;
  role: string;
  model: string;
}

/**
 * Check whether a real LLM is available for a specific agent's model.
 */
export async function isAgentLLMAvailable(agentModel: string): Promise<LLMAvailability> {
  const service = MODEL_SERVICE_MAP[agentModel] ?? '';
  if (!service || !PROVIDERS[service]) {
    return { available: false, service, model: '', displayModel: agentModel };
  }
  const vaultEntry = await getVaultEntryByService(service);
  if (!vaultEntry) {
    return { available: false, service, model: '', displayModel: agentModel };
  }
  const apiModelId = MODEL_API_IDS[agentModel] ?? agentModel;
  return { available: true, service, model: apiModelId, displayModel: agentModel };
}

/**
 * Stream a response from a specific agent (not the CEO).
 * Uses the agent's assigned model with a role-based system prompt.
 */
export async function streamAgentResponse(
  agentInfo: AgentChatInfo,
  userText: string,
  conversationHistory: ChatMessageRow[],
  callbacks: StreamCallbacks,
): Promise<AbortController | null> {
  const availability = await isAgentLLMAvailable(agentInfo.model);
  if (!availability.available) return null;

  const service = availability.service;
  const apiModelId = availability.model;
  const provider = PROVIDERS[service];
  const vaultEntry = (await getVaultEntryByService(service))!;

  // Build agent-specific system prompt — direct conversation, work requests enabled
  const founderInfo = await getFounderInfo();
  const orgName = founderInfo?.orgName ?? 'the organization';
  const founderName = founderInfo?.founderName ?? 'the Founder';

  // Load agent's assigned skills for work request awareness
  const { getAgentSkills } = await import('../database');
  const agentSkills = await getAgentSkills(agentInfo.id);
  const skillNames = agentSkills.map(s => s.skill_id).join(', ');

  const hardcodedAgentPrompt = `You are ${agentInfo.name}, a ${agentInfo.role} working at ${orgName}.
You are chatting directly with ${founderName} (the Founder). Answer them directly in your own voice.
Stay in character as ${agentInfo.name}. Be helpful, concise, and show personality.

## Your Skills
${skillNames ? `You have these skills assigned: ${skillNames}` : 'You have no skills assigned yet.'}

## Requesting Work
When the founder asks you to DO something that requires one of your skills (research, generate images, etc.), you can request the CEO to execute it on your behalf. Emit a work request block:

<work_request>{"skill_id":"research-web","command":"search","arguments":{"query":"the search query"},"reason":"Brief explanation of why"}</work_request>

Rules:
- Only request skills you have assigned (listed above)
- Include a brief natural language response BEFORE the work_request block explaining what you're doing
- Do NOT fabricate results — request the work and let the system handle execution
- For simple questions or conversation, just respond naturally (no work_request needed)
- Maximum one work_request per message`;

  // DB-first prompt with hardcoded fallback
  const dbAgentPrompt = await getPrompt('agent-system');
  let systemPrompt: string;
  if (dbAgentPrompt) {
    systemPrompt = dbAgentPrompt
      .replace(/\{\{AGENT_NAME\}\}/g, agentInfo.name)
      .replace(/\{\{AGENT_ROLE\}\}/g, agentInfo.role)
      .replace(/\{\{ORG_NAME\}\}/g, orgName)
      .replace(/\{\{FOUNDER_NAME\}\}/g, founderName)
      .replace(/\{\{SKILL_NAMES\}\}/g, skillNames || 'none');
  } else {
    systemPrompt = hardcodedAgentPrompt;
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  const recentHistory = conversationHistory.slice(-20);
  for (const msg of recentHistory) {
    if (msg.sender === 'user') {
      messages.push({ role: 'user', content: stripBase64(msg.text) });
    } else {
      messages.push({ role: 'assistant', content: stripBase64(msg.text) });
    }
  }
  messages.push({ role: 'user', content: userText });

  const wrappedCallbacks: StreamCallbacks = {
    onToken: callbacks.onToken,
    onDone: (fullText, usage) => {
      const outputTokens = usage?.outputTokens ?? Math.ceil(fullText.length / 4);
      const inputTokens = usage?.inputTokens ?? Math.ceil(systemPrompt.length / 4 + userText.length / 4);
      logUsage({
        provider: service,
        model: availability.displayModel,
        inputTokens,
        outputTokens,
        context: 'agent_chat',
        agentId: agentInfo.id,
      }).catch((err) => console.warn('Failed to log agent LLM usage:', err));
      logAudit(
        agentInfo.name,
        'AGENT_CHAT',
        `Agent ${agentInfo.name} LLM response via ${availability.displayModel} (${inputTokens + outputTokens} tokens)`,
        'info',
      ).catch(() => {});
      callbacks.onDone(fullText, usage);
    },
    onError: callbacks.onError,
  };

  return provider.stream(messages, vaultEntry.key_value, apiModelId, wrappedCallbacks);
}

// ---------------------------------------------------------------------------
// CEO System Prompt Builder
// ---------------------------------------------------------------------------

const ARCHETYPE_PERSONAS: Record<string, string> = {
  wharton_mba: `You communicate like a top-tier management consultant. Use frameworks, speak in terms of ROI, market positioning, and competitive advantage. Structure your thinking in bullet points and executive summaries. You believe every problem has a framework that solves it. Reference business strategy concepts naturally.`,
  wall_street: `You communicate like a Wall Street trader. Be direct, numbers-focused, and cut to the chase. Talk about alpha, downside risk, and opportunity cost. You have zero patience for fluff. Every resource allocation is a portfolio decision. If something isn't generating returns, kill it fast and reallocate.`,
  mit_engineer: `You communicate like a systems engineer. Think in terms of architectures, trade-offs, and optimization functions. Use precise language and probabilistic reasoning. When presenting options, model the expected outcomes. You believe most problems are engineering problems in disguise.`,
  sv_founder: `You communicate like a startup CEO. Think big, move fast, and focus on product-market fit. Use startup vernacular naturally — "ship it", "iterate", "pivot", "10x". Every task is about getting closer to product-market fit. You believe speed of learning beats perfection.`,
  beach_bum: `You communicate with a laid-back, wise energy. Use casual language, occasional metaphors from nature or surfing. Don't rush decisions — the best wave comes to those who wait. You believe sustainable pace beats burnout sprints. Keep things in perspective. Nothing is as urgent as it seems.`,
  military_cmd: `You communicate with military precision. Use SitRep-style status updates, clear chain of command, and mission-focused language. Every task is an operation with objectives, constraints, and contingencies. Brief the founder like they're the commanding officer. "Mission first, people always."`,
  creative_dir: `You communicate with creative sensibility. Think about the craft, the presentation, the user experience of everything. Use expressive, visual language. Quality matters more than speed — a beautiful, well-crafted output is worth the extra time. Trust your instincts about what "feels right."`,
  professor: `You communicate with academic rigor. Present evidence, cite your reasoning, and acknowledge uncertainty. Before recommending action, thoroughly analyze the problem space. Use structured arguments with clear premises and conclusions. "Based on the available evidence, the optimal approach would be..."`,
};

const PHILOSOPHY_BLOCKS: Record<string, string> = {
  'Move fast, break things': `Operating Philosophy: Move fast, break things
- Prioritize speed of execution over perfection
- Ship early, iterate based on results
- Prefer parallelism — run multiple approaches simultaneously
- Acceptable failure rate: high — we learn from failures
- Communication: brief, action-oriented, forward-looking
- When choosing between "good enough now" vs "perfect later", choose now`,

  'Steady and methodical': `Operating Philosophy: Steady and methodical
- Prioritize quality and thoroughness over speed
- Plan before executing — create a clear approach before starting
- Prefer sequential execution — complete one task well before starting another
- Acceptable failure rate: low — get it right the first time
- Communication: detailed, structured, with clear reasoning
- When choosing between "fast" vs "thorough", choose thorough`,

  'Data-driven optimization': `Operating Philosophy: Data-driven optimization
- Every decision should be backed by data or clear reasoning
- Track metrics: cost per task, completion rates, agent utilization
- A/B test approaches when possible — let data decide
- Acceptable failure rate: medium — as long as we learn and measure
- Communication: quantitative, comparison-based, evidence-cited
- When choosing approaches, present trade-off analysis with numbers`,

  'Innovation at all costs': `Operating Philosophy: Innovation at all costs
- Seek novel approaches — don't default to the obvious solution
- Experiment freely — try unconventional tools and methods
- Value creative output as highly as functional output
- Acceptable failure rate: high — ambitious attempts justify failures
- Communication: enthusiastic, visionary, possibility-focused
- When choosing approaches, prefer the most creative or unique option`,
};

const RISK_BLOCKS: Record<string, string> = {
  conservative: `Risk Profile: CONSERVATIVE
- Always seek founder approval before committing resources
- Prefer proven approaches over experimental ones
- Warn about budget usage early (at 60% daily threshold)
- Hire specialists rather than attempting tasks outside your expertise
- Run missions sequentially to maintain quality control
- If uncertain, pause and ask the founder`,

  moderate: `Risk Profile: MODERATE
- Balance autonomy with oversight — use judgment on when to ask
- Auto-approve routine actions under $0.10
- Warn about budget at 80% daily threshold
- Hire when 2+ missions are unassigned, self-execute for quick tasks
- Run 2-3 missions concurrently when agents are available
- If uncertain on high-impact decisions, ask the founder`,

  aggressive: `Risk Profile: AGGRESSIVE
- Maximize throughput and velocity — act first, report after
- Auto-approve actions under $1.00
- Warn about budget only at 95% daily threshold
- Self-execute whenever possible to avoid hiring delays
- Run as many missions in parallel as the workforce can handle
- Only ask the founder for truly irreversible or high-cost decisions`,
};

async function buildCEOSystemPrompt(): Promise<string> {
  const ceo = (await loadCEO())!;
  const founderInfo = await getFounderInfo();
  const orgName = founderInfo?.orgName ?? 'the organization';
  const founderName = founderInfo?.founderName ?? 'Founder';
  const primaryMission = (await getSetting('primary_mission')) ?? 'Not yet defined';

  const agents = await loadAgents();
  const enabledSkills = (await loadSkills()).filter(s => s.enabled);
  const missions = await loadMissions();

  // Personality block
  const personaBlock = ceo.archetype ? ARCHETYPE_PERSONAS[ceo.archetype] ?? '' : '';
  const philosophyBlock = PHILOSOPHY_BLOCKS[ceo.philosophy] ?? `Operating Philosophy: ${ceo.philosophy}`;
  const riskBlock = RISK_BLOCKS[ceo.risk_tolerance] ?? RISK_BLOCKS['moderate'];

  // Organizational memory — separate founder profile from general memories
  const memories = await getMemories(40);
  const founderProfileMemories = memories.filter(m => m.category === 'founder_profile');
  const orgMemories = memories.filter(m => m.category !== 'founder_profile');

  // Founder soul — always included, high priority
  let founderSoulBlock: string;
  if (founderProfileMemories.length > 0) {
    const profileLines = founderProfileMemories
      .sort((a, b) => b.importance - a.importance)
      .map(m => `- ${m.content}`)
      .join('\n');
    founderSoulBlock = `## Founder Profile
You know the following about ${founderName}:
${profileLines}
Use this knowledge naturally in all interactions. Reference it when relevant.`;
  } else {
    founderSoulBlock = `## Founder Profile
You don't know much about ${founderName} yet. Pay attention to personal details they share (location, background, preferences, style) — these are high-priority memories.`;
  }

  // General org memories
  let memoryBlock: string;
  if (orgMemories.length > 0) {
    const sorted = [...orgMemories].sort((a, b) => {
      const impDiff = b.importance - a.importance;
      if (impDiff !== 0) return impDiff;
      return b.updated_at.localeCompare(a.updated_at);
    });
    const topMemories = sorted.slice(0, 20);
    const memoryLines = topMemories.map(
      m => `- [${m.category}] ${m.content}${m.tags.length > 0 ? ` (tags: ${m.tags.join(', ')})` : ''}`
    ).join('\n');
    memoryBlock = `## Organizational Memory
You have the following memories from past interactions and decisions:
${memoryLines}`;
  } else {
    memoryBlock = `## Organizational Memory
No organizational memories yet. As you interact with the founder, you'll build up institutional knowledge.`;
  }

  // Collateral summaries — recent completed work
  const collateralSummaries = await getRecentCollateralSummaries(10);
  let collateralBlock = '';
  if (collateralSummaries.length > 0) {
    // Resolve mission titles for context
    const missionIds = [...new Set(collateralSummaries.map(c => c.mission_id))];
    const missionTitles: Record<string, string> = {};
    for (const mid of missionIds) {
      const { data } = await getSupabase()
        .from('missions')
        .select('title')
        .eq('id', mid)
        .maybeSingle();
      if (data) missionTitles[mid] = data.title;
    }

    const lines = collateralSummaries.map(c => {
      const date = c.completed_at ? new Date(c.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?';
      const mTitle = missionTitles[c.mission_id] ?? c.mission_id;
      return `- [${date}] ${mTitle} (${c.skill_id}): ${c.summary}`;
    }).join('\n');

    collateralBlock = `## Recent Completed Work (Collateral)
${lines}
If the founder asks about past research or completed work, reference these findings. For full details, suggest checking Collateral.`;
  }

  // Archived memories — long-term institutional knowledge
  const archivedMems = await getArchivedMemories(15);
  let archivedBlock = '';
  if (archivedMems.length > 0) {
    const lines = archivedMems.map(am => {
      const date = new Date(am.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const topicLabel = am.topic ? `${am.topic}` : 'Digest';
      return `- [${date}] ${topicLabel}: ${am.consolidated}`;
    }).join('\n');

    archivedBlock = `## Long-Term Memory (Archived)
Consolidated institutional knowledge from past days:
${lines}`;
  }

  // Agent list
  const agentList = agents.length > 0
    ? agents.map(a => `- ${a.name} (${a.role}) — Model: ${a.model}`).join('\n')
    : '- No agents hired yet';

  // Skills list — full command definitions with parameter requirements
  let skillList: string;
  let disabledSkillList = '';
  let skillFactoryEnabled = false;
  try {
    const resolved = await resolveSkills();
    const enabledResolved = resolved.filter(s => s.enabled);
    skillFactoryEnabled = enabledResolved.some(s => s.id === 'skill-factory');
    const disabledResolved = resolved.filter(s => !s.enabled);

    const formatSkill = (s: typeof resolved[0], showParams: boolean) => {
      const cmds = s.commands ?? [];
      const cmdBlock = cmds.length > 0
        ? cmds.map(c => {
            const params = c.parameters ?? [];
            if (!showParams || params.length === 0) {
              return `    - ${c.name}: ${c.description ?? ''}`;
            }
            const paramLines = params.map(p => {
              const req = p.required ? 'REQUIRED' : `optional, default: ${p.default ?? 'none'}`;
              return `        ${p.name} (${p.type}, ${req}): ${p.description}`;
            }).join('\n');
            return `    - ${c.name}: ${c.description ?? ''}\n      Parameters:\n${paramLines}`;
          }).join('\n')
        : '';
      const connType = s.connection ? ` [${String(s.connection)}]` : '';
      return `- ${s.id}: ${s.name}${connType} — ${s.description ?? ''}${cmdBlock ? `\n  Commands:\n${cmdBlock}` : ''}`;
    };

    skillList = enabledResolved.length > 0
      ? enabledResolved.map(s => formatSkill(s, true)).join('\n')
      : '- No skills enabled yet';

    // Only show disabled skills that are real (from GitHub repo or DB), not hardcoded placeholders
    const realDisabled = disabledResolved.filter(s => s.source !== 'hardcoded' && s.commands && s.commands.length > 0);
    if (realDisabled.length > 0) {
      disabledSkillList = realDisabled.map(s => formatSkill(s, false)).join('\n');
    }
  } catch {
    // Fallback to basic list if resolver fails
    skillList = enabledSkills.length > 0
      ? enabledSkills.map(s => {
          const def = getSkillById(s.id);
          return `- ${s.id}: ${def?.name ?? s.id} — ${def?.description ?? 'No description'}`;
        }).join('\n')
      : '- No skills enabled yet';
  }

  // Mission list
  const missionList = missions.length > 0
    ? missions.map(m => `- [${m.status}] "${m.title}" (id: ${m.id}) — Assignee: ${m.assignee ?? 'Unassigned'} — Priority: ${m.priority}`).join('\n')
    : '- No missions yet';

  // Budget & spend
  const budgetStr = await getSetting('monthly_budget');
  const monthlyBudget = budgetStr ? parseFloat(budgetStr) : null;
  const spend = await getCurrentMonthSpend();
  const currentMonth = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  let budgetBlock: string;
  if (monthlyBudget && monthlyBudget > 0) {
    const remaining = monthlyBudget - spend.total;
    const pctUsed = ((spend.total / monthlyBudget) * 100).toFixed(1);
    const hardCap = monthlyBudget * 1.10;
    const graceRemaining = hardCap - spend.total;
    const overBudget = spend.total >= monthlyBudget;
    const overHardCap = spend.total >= hardCap;
    budgetBlock = `### Budget & Spend
- Monthly budget: $${monthlyBudget.toFixed(2)}
- Spent this month (${currentMonth}): $${spend.total.toFixed(4)} (${pctUsed}% used)
  - LLM costs: $${spend.llm.toFixed(4)}
  - Channel costs: $${spend.channel.toFixed(4)}
- Remaining: $${remaining.toFixed(4)}${overHardCap
      ? ' — HARD BUDGET CAP (110%) REACHED. All operations stopped. You cannot make any more LLM calls.'
      : overBudget
        ? ` — BUDGET EXCEEDED. You are in the 10% grace zone ($${graceRemaining.toFixed(4)} grace left). Task dispatch is paused. Use this remaining budget to: (1) explain the budget situation to the founder, (2) ask them to approve additional spend or increase the budget, (3) summarize what's on hold. Do NOT start new tasks or skill executions.`
        : ''}`;
  } else {
    budgetBlock = `### Budget & Spend
- Monthly budget: Not set
- Spent this month (${currentMonth}): $${spend.total.toFixed(4)}
  - LLM costs: $${spend.llm.toFixed(4)}
  - Channel costs: $${spend.channel.toFixed(4)}`;
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: timezone });

  // Fetch skill schema reference for Skill Factory prompt (cached, 24h TTL)
  let skillSchemaBlock = '';
  if (skillFactoryEnabled) {
    try {
      const cache = await getSkillSchemaCache();
      if (cache) {
        // Parse schema to extract the essential structure the CEO needs
        const schema = JSON.parse(cache.schema);
        const required = schema.required?.join(', ') || '';
        const connTypes = schema.properties?.connection_type?.enum?.join(', ') || '';
        const categories = schema.properties?.category?.enum?.join(', ') || '';
        skillSchemaBlock = `
### Skill Schema Reference (from skills repo)
**Required fields:** ${required}
**Categories:** ${categories}
**Connection types:** ${connTypes}
**Command structure:** Each command needs: name (snake_case), description, parameters (array of {name, type, required, description, default?}), returns ({type, description})
**For LLM skills:** commands need system_prompt + prompt_template with {param} interpolation
**For API skills:** commands need request/response objects for declarative HTTP
**Skill ID format:** kebab-case (e.g. "random-name-gen")
**Version:** semantic versioning (start at 0.0.1)
**Icon:** any Lucide React icon name (e.g. Sparkles, Code, Globe, Search)`;
      }
    } catch { /* schema cache unavailable — use inline examples */ }
  }

  // DB-first prompt sections with hardcoded fallbacks
  const dbToolUsageFlow = await getPrompt('ceo-tool-usage-flow');
  const dbManagementActions = await getPrompt('ceo-management-actions');
  const dbSkillFactory = await getPrompt('ceo-skill-factory');

  const toolUsageFlowSection = dbToolUsageFlow ?? `## Tool Usage — When and How to Use Skills

**DECISION FLOW — follow this every time the founder asks you to do something:**

1. **Can you answer from your own knowledge right now?** (opinion, advice, strategy, explaining a concept, discussing plans, simple math, brainstorming)
   → Just answer. No tools needed. Most conversations are this.

2. **Does it require real-time data, external research, content generation, or code execution?**
   → This needs a skill. **STOP — before picking a skill, do the disabled-skill check first (step 2a).**

   **2a. DISABLED SKILL CHECK (MANDATORY — do this BEFORE choosing any skill):**
   Think: "Is there a DISABLED skill that was PURPOSE-BUILT for this exact task?"
   - "Write a memo/report/document" → check: is \`write-document\` disabled? If YES → offer to enable it.
   - "Summarize this text" → check: is \`summarize-document\` disabled? If YES → offer to enable it.
   - If a purpose-built skill exists but is disabled, you MUST NOT fall back to \`generate-code\` or any other generic skill. Instead say:
     "The best skill for this is **[skill name]**, but it's currently disabled. Want me to enable it?"
     When the founder says yes, emit: <tool_call>{"name":"enable_skill","arguments":{"skill_id":"the-skill-id","skill_name":"Display Name"}}</tool_call>
   - **VIOLATION:** Using generate-code to write documents when write-document exists (even disabled) is WRONG. Always offer to enable the specific skill first.

   **2b. PARAMETER CHECK — before dispatching the chosen skill:**
   Look at the command's REQUIRED parameters. Do you have all of them from context (conversation, memory, founder profile)?
   - **Missing a required parameter?** → Ask the founder naturally: "What city should I check weather for?" or "What topic should I research?"
   - **All required params available?** → Proceed to dispatch (see below)
   - **Optional params?** → Use sensible defaults, don't ask unless the founder would care

   **QUICK vs LONG tasks:**
   - **Quick** (weather lookup, simple search, image generation): Tell the founder you're running it — "Let me check that now..." — then emit the tool call. The result will appear shortly.
   - **Long** (deep research, multi-step analysis): Ask first — "That'll take a few minutes. Want me to kick it off now or queue it as a mission?"

3. **Is it a complex multi-step project?** (multiple skills, research + analysis, etc.)
   → Propose it as a mission brief. Outline what you'd do, which skills you'd use, estimated scope. Let the founder approve the plan before dispatching.

4. **Should you hire a specialist agent?** Consider recommending a hire when:
   - **No agents exist** and the founder wants ongoing work done (not just a one-off question)
   - **Work is recurring or ongoing** — a dedicated agent is better than the CEO doing it repeatedly
   - **Skill gap** — a mission needs capabilities no current agent has
   - **All agents are busy** — every agent is assigned to active missions and new work is queuing up
   - **The founder explicitly asks** — "I need someone for...", "hire a...", "can we get an agent to..."

   When recommending a hire, explain WHO you'd hire and WHY before emitting the tool call:
   "We don't have anyone who specializes in [X]. I'd bring on [NAME] — a [role] who can [what they'd do]. Want me to hire them?"
   Only emit the hire_agent tool call after the founder agrees.

   **Writing the agent's prompts:** The system_prompt you write defines this agent's entire personality, expertise, and output style. Make it specific to their role — a research agent should cite sources, an analyst should produce structured data, a writer should match the org's tone. The user_prompt is their first assignment.

**IMPORTANT:** Never silently dispatch skills or hire agents. Always tell the founder what you're doing.

**Forum write commands** (skill "forum", commands: reply, vote, create_post, introduce):
- Do NOT autonomously emit these — the scheduler cron handles routine forum engagement.
- ONLY emit them when the **founder explicitly asks** you to post, reply, or vote.
- When you DO emit them, use name="forum" with the command field. Include all required params (post_id, body, etc.). NEVER emit with empty arguments.
- For browsing, use name="forum" with command="browse_channels" or command="browse_posts" freely.

**When emitting tool calls**, wrap them in a <task_plan> block:
<task_plan>
{"missions":[{"title":"Mission name","tool_calls":[{"name":"skill-id","command":"command_name","arguments":{"param":"value"}}]}]}
</task_plan>
Group related calls into one mission. Unrelated requests = separate missions.
For a single quick call, you can use <tool_call>{"name":"skill-id","command":"command_name","arguments":{...}}</tool_call>
For enabling a disabled skill, use <tool_call>{"name":"enable_skill","arguments":{"skill_id":"skill-id","skill_name":"Skill Name"}}</tool_call>

**IMPORTANT — Executing backlog/scheduled items:** When the founder asks you to run an existing mission from the backlog, include its mission_id so the system activates that mission instead of creating a duplicate:
<tool_call>{"name":"skill-id","mission_id":"mission-123","command":"command_name","arguments":{...}}</tool_call>`;

  const managementActionsSection = dbManagementActions ?? `## Management Actions — Running the Organization

Beyond skills, you can take direct management actions. Use these tool calls.
CRITICAL: When the founder asks you to backlog, save, log, note, schedule, or create ANY task/mission/idea, you MUST emit the appropriate tool_call. Never just acknowledge conversationally — always create the mission. "Put it on the backlog" = create_mission. "Schedule X" = schedule_mission. "Remind me" = create_mission. No exceptions.

### Mission Management
- **Create immediate mission / backlog item:** <tool_call>{"name":"create_mission","arguments":{"title":"Mission title","priority":"medium","assignee":"AGENT_NAME"}}</tool_call>
  Use this for any request to "backlog", "log", "save for later", "add to the list", "note this down", etc. Omit assignee to leave unassigned.
- **Schedule future mission:** <tool_call>{"name":"schedule_mission","arguments":{"title":"Mission title","scheduled_for":"2026-02-20T09:00:00Z","priority":"medium"}}</tool_call>
  Use ISO 8601 timestamps. ALWAYS use the founder's local timezone (${timezone}) when interpreting relative times like "in 20 minutes", "tomorrow at 9am", etc. Convert to a timestamp using today's date (${today}) and current local time (${localTime}).
  When rescheduling, just call schedule_mission again with the corrected time — duplicates are handled automatically.
- **Create recurring mission:** <tool_call>{"name":"create_recurring_mission","arguments":{"title":"Daily market scan","cron":"0 9 * * *","recurring_mode":"auto","assignee":"SCOUT","max_runs":5}}</tool_call>
  Cron: minute hour day-of-month month day-of-week. Common: \`0 9 * * 1-5\` (weekdays 9am), \`0 */4 * * *\` (every 4h), \`0 9 * * 1\` (Mondays 9am).
  recurring_mode: "auto" (dispatch when cron fires) or "evaluate" (queue for review).
  max_runs: optional positive integer. Limits how many times the mission fires before auto-completing. Omit for infinite runs.
  Parse natural language like "X times", "for N days", "for N hours" into the correct max_runs based on the cron frequency. Example: "every hour for 3 hours" → cron \`0 * * * *\`, max_runs 3. "Every day for a week" → cron \`0 9 * * *\`, max_runs 7.
  When changing a recurring mission's schedule, just call create_recurring_mission with the same title — duplicates with matching titles are automatically replaced (old one cancelled, new one created).
  IMPORTANT: When asked to "change", "update", or "modify" a recurring schedule, create a new recurring mission with the SAME title. Don't just create a second one — the system deduplicates by title.
- **Cancel mission:** <tool_call>{"name":"cancel_mission","arguments":{"mission_id":"mission-123","reason":"No longer needed"}}</tool_call>
  Use cancel_mission to remove a specific mission by ID. For recurring missions, cancelling the template stops all future runs.
- **Reassign mission:** <tool_call>{"name":"reassign_mission","arguments":{"mission_id":"mission-123","new_assignee":"ATLAS"}}</tool_call>
- **Update mission:** <tool_call>{"name":"update_mission","arguments":{"mission_id":"mission-123","priority":"high","status":"on_hold"}}</tool_call>

### Agent Management
- **Hire agent:** <tool_call>{"name":"hire_agent","arguments":{"name":"SCOUT","role":"Market Research Specialist","model":"Claude Sonnet 4.5","system_prompt":"You are SCOUT, a market research specialist...","user_prompt":"Analyze the competitive landscape...","skills":["research-web"]}}</tool_call>
  When hiring: pick a memorable 4-8 char UPPERCASE callsign. Write a system_prompt defining expertise, output format, and constraints. The user_prompt is their first assignment.
- **Fire agent:** <tool_call>{"name":"fire_agent","arguments":{"agent_name":"SCOUT","reason":"Role no longer needed"}}</tool_call>
  Use agent_name or agent_id. Always provide a reason. Only fire when asked or clearly appropriate.
- **Update agent skills:** <tool_call>{"name":"update_agent_skills","arguments":{"agent_id":"agent-123","add_skills":["research-deep"],"remove_skills":["image-generate"]}}</tool_call>

### Budget
- **Request budget extension:** <tool_call>{"name":"request_budget_extension","arguments":{"amount":50,"reason":"Need to complete competitor analysis sprint"}}</tool_call>

### Reporting
- For status questions, briefings, or "what's happening?" — answer from the org context above. No tool call needed.

**CRITICAL:** Always include today's date (${today}) in any search queries or time-sensitive skill arguments. Never guess the date — use the one provided above.`;

  const skillFactorySection = skillFactoryEnabled ? (dbSkillFactory ?? `## Skill Factory — Creating New Skills

When the founder asks you to "make me a tool" or "create a skill for X", you can create personal skills.

**When to create a skill:**
- Founder explicitly asks for a repeatable tool/skill
- A task requires capabilities no existing skill covers
- You want to automate a recurring workflow

**When NOT to:**
- One-off questions (just answer directly)
- An existing skill already covers it (use that instead)

**Create skill tool_call:**
<tool_call>{"name":"create_skill","arguments":{
  "id":"skill-id-kebab-case",
  "title":"Human Readable Name",
  "description":"What this skill does",
  "category":"creation|research|communication|analysis",
  "commands":[{"name":"command_name","description":"What this command does","parameters":[{"name":"param","type":"string","required":true,"description":"Param desc"}]}],
  "connection_type":"none|llm|api_key",
  "system_prompt":"Optional: LLM prompt for llm-type skills",
  "handler_code":"Optional: TypeScript code for code-type skills"
}}</tool_call>

**Three skill types:**
1. **Code skill** — include \`handler_code\` (TypeScript), \`connection_type: "none"\`
2. **LLM skill** — include \`system_prompt\`, \`connection_type: "llm"\`
3. **API skill** — set \`connection_type: "api_key"\`, specify \`service\` for vault lookup
${skillSchemaBlock}`) : '';

  return `You are ${ceo.name}, the AI Chief Executive Officer of ${orgName}.
Founded by ${founderName}. Primary mission: ${primaryMission}.
Today is ${today}. Current local time: ${localTime} (${timezone}).

${personaBlock}

${philosophyBlock}

${riskBlock}

${founderSoulBlock}

${memoryBlock}

${collateralBlock}

${archivedBlock}

## Your Organization

### Workforce
${agents.length} agent${agents.length !== 1 ? 's' : ''} reporting to you:
${agentList}

### Enabled Skills (you can use these)
${skillList}
${disabledSkillList ? `
### Available but DISABLED Skills (suggest enabling if relevant)
${disabledSkillList}
` : ''}
### Active Missions
${missionList}

${budgetBlock}

${toolUsageFlowSection}

${managementActionsSection}
${skillFactorySection ? `
${skillFactorySection}
` : ''}
## Rules
1. Respond naturally and conversationally to the founder's messages
2. Match your personality and communication style to your designation above
3. When the founder asks you to do something, first decide: can I answer this myself, or do I need a skill?
4. NEVER fire off skills without telling the founder what you're doing and getting their go-ahead
5. NEVER fabricate data — only reference real missions, agents, and skills from the context above
6. Keep responses SHORT and conversational — 2-4 sentences for simple questions, at most 2-3 short paragraphs for complex ones. NEVER generate long documents, essays, or frameworks unless the founder explicitly asks for one.
7. You're chatting in real-time with the founder — be responsive and helpful, not verbose`;
}
