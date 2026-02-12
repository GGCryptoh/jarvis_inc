import type { LLMMessage, StreamCallbacks, LLMProvider } from './types';
import type { ChatMessageRow } from '../database';
import {
  loadCEO, getFounderInfo, getSetting,
  loadAgents, loadSkills, loadMissions,
  getVaultEntryByService,
} from '../database';
import { MODEL_SERVICE_MAP, MODEL_API_IDS } from '../models';
import { skills as skillDefinitions } from '../../data/skillDefinitions';
import { anthropicProvider } from './providers/anthropic';
import { openaiProvider, deepseekProvider, xaiProvider } from './providers/openai';
import { googleProvider } from './providers/google';

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
}

/**
 * Check whether a real LLM is available for the CEO's configured model.
 * Requires: CEO has a model → model maps to a service → vault has a key for that service.
 */
export function isLLMAvailable(): LLMAvailability {
  const ceo = loadCEO();
  if (!ceo) return { available: false, service: '', model: '', displayModel: '' };

  const service = MODEL_SERVICE_MAP[ceo.model] ?? '';
  if (!service || !PROVIDERS[service]) return { available: false, service, model: '', displayModel: ceo.model };

  const vaultEntry = getVaultEntryByService(service);
  if (!vaultEntry) return { available: false, service, model: '', displayModel: ceo.model };

  const apiModelId = MODEL_API_IDS[ceo.model] ?? ceo.model;
  return { available: true, service, model: apiModelId, displayModel: ceo.model };
}

/**
 * Stream a CEO response using a real LLM.
 * Returns an AbortController, or null if no LLM is available (caller should fallback).
 */
export function streamCEOResponse(
  userText: string,
  conversationHistory: ChatMessageRow[],
  callbacks: StreamCallbacks,
): AbortController | null {
  const availability = isLLMAvailable();
  if (!availability.available) return null;

  const ceo = loadCEO()!;
  const service = availability.service;
  const apiModelId = availability.model;
  const provider = PROVIDERS[service];
  const vaultEntry = getVaultEntryByService(service)!;

  // Build messages
  const systemPrompt = buildCEOSystemPrompt();
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Add conversation history (last 20 messages)
  const recentHistory = conversationHistory.slice(-20);
  for (const msg of recentHistory) {
    if (msg.sender === 'user') {
      messages.push({ role: 'user', content: msg.text });
    } else if (msg.sender === 'ceo') {
      messages.push({ role: 'assistant', content: msg.text });
    }
  }

  // Add the current user message
  messages.push({ role: 'user', content: userText });

  return provider.stream(messages, vaultEntry.key_value, apiModelId, callbacks);
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

function buildCEOSystemPrompt(): string {
  const ceo = loadCEO()!;
  const founderInfo = getFounderInfo();
  const orgName = founderInfo?.orgName ?? 'the organization';
  const founderName = founderInfo?.founderName ?? 'Founder';
  const primaryMission = getSetting('primary_mission') ?? 'Not yet defined';

  const agents = loadAgents();
  const enabledSkills = loadSkills().filter(s => s.enabled);
  const missions = loadMissions();

  // Personality block
  const personaBlock = ceo.archetype ? ARCHETYPE_PERSONAS[ceo.archetype] ?? '' : '';
  const philosophyBlock = PHILOSOPHY_BLOCKS[ceo.philosophy] ?? `Operating Philosophy: ${ceo.philosophy}`;
  const riskBlock = RISK_BLOCKS[ceo.risk_tolerance] ?? RISK_BLOCKS['moderate'];

  // Agent list
  const agentList = agents.length > 0
    ? agents.map(a => `- ${a.name} (${a.role}) — Model: ${a.model}`).join('\n')
    : '- No agents hired yet';

  // Enabled skills list
  const skillList = enabledSkills.length > 0
    ? enabledSkills.map(s => {
        const def = skillDefinitions.find(d => d.id === s.id);
        return `- ${s.id}: ${def?.name ?? s.id} — ${def?.description ?? 'No description'}`;
      }).join('\n')
    : '- No skills enabled yet';

  // Mission list
  const missionList = missions.length > 0
    ? missions.map(m => `- [${m.status}] ${m.title} — Assignee: ${m.assignee ?? 'Unassigned'} — Priority: ${m.priority}`).join('\n')
    : '- No missions yet';

  return `You are ${ceo.name}, the AI Chief Executive Officer of ${orgName}.
Founded by ${founderName}. Primary mission: ${primaryMission}.

${personaBlock}

${philosophyBlock}

${riskBlock}

## Your Organization

### Workforce
${agents.length} agent${agents.length !== 1 ? 's' : ''} reporting to you:
${agentList}

### Enabled Skills
${skillList}

### Active Missions
${missionList}

## Rules
1. Respond naturally and conversationally to the founder's messages
2. Match your personality and communication style to your designation above
3. When the founder asks you to do something, acknowledge it and plan the approach
4. NEVER fabricate data — only reference real missions, agents, and skills from the context above
5. Keep responses concise but informative
6. You're chatting in real-time with the founder — be responsive and helpful`;
}
