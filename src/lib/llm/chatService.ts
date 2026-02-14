import type { LLMMessage, StreamCallbacks, LLMProvider } from './types';
import { logUsage, getCurrentMonthSpend } from '../llmUsage';
import type { ChatMessageRow } from '../database';
import {
  loadCEO, getFounderInfo, getSetting,
  loadAgents, loadSkills, loadMissions,
  getVaultEntryByService, logAudit,
  saveApproval, saveChatMessage, loadApprovals,
} from '../database';
import { MODEL_SERVICE_MAP, MODEL_API_IDS } from '../models';
import { skills as skillDefinitions } from '../../data/skillDefinitions';
import { resolveSkills } from '../skillResolver';
import { anthropicProvider } from './providers/anthropic';
import { openaiProvider, deepseekProvider, xaiProvider } from './providers/openai';
import { googleProvider } from './providers/google';
import { getMemories } from '../memory';
import { parseTaskPlan, dispatchTaskPlan } from '../taskDispatcher';

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

  // Check budget — block LLM calls when over monthly budget
  const budgetStr = await getSetting('monthly_budget');
  if (budgetStr) {
    const budgetLimit = parseFloat(budgetStr);
    if (!isNaN(budgetLimit) && budgetLimit > 0) {
      const spend = await getCurrentMonthSpend();
      if (spend.total >= budgetLimit) {
        console.warn(`[LLM] Budget exceeded: $${spend.total.toFixed(2)} / $${budgetLimit.toFixed(2)}`);
        return {
          available: false, service, model: apiModelId, displayModel: ceo.model,
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

  // Look up skill details from definitions
  const skillDef = skillDefinitions.find(s => s.id === skillId);
  const displayName = skillName || skillDef?.name || skillId;
  const connectionType = skillDef?.serviceType === 'fixed' ? 'cli' : 'api_key';

  // Create approval
  const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await saveApproval({
    id: approvalId,
    type: 'skill_enable',
    title: `Enable Skill: ${displayName}`,
    description: `CEO ${ceoName} recommends enabling "${displayName}"`,
    status: 'pending',
    metadata: { skillId, skillName: displayName, connectionType },
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
): Promise<AbortController | null> {
  const availability = await isLLMAvailable();
  if (!availability.available) return null;

  const ceo = (await loadCEO())!;
  const service = availability.service;
  const apiModelId = availability.model;
  const provider = PROVIDERS[service];
  const vaultEntry = (await getVaultEntryByService(service))!;

  // Build messages
  const systemPrompt = await buildCEOSystemPrompt();
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
        // Separate enable_skill calls from regular skill calls
        const enableCalls = missions.flatMap(m => m.toolCalls.filter(tc => tc.name === 'enable_skill'));
        const regularMissions = missions
          .map(m => ({ ...m, toolCalls: m.toolCalls.filter(tc => tc.name !== 'enable_skill') }))
          .filter(m => m.toolCalls.length > 0);

        // Handle enable_skill — create approval cards
        for (const call of enableCalls) {
          handleEnableSkillCall(
            call.arguments.skill_id as string,
            call.arguments.skill_name as string,
            conversationHistory[0]?.conversation_id,
          ).catch((err) => console.error('Enable skill failed:', err));
        }

        // Dispatch remaining regular missions
        if (regularMissions.length > 0) {
          dispatchTaskPlan(regularMissions, availability.displayModel, {
            conversationExcerpt: conversationHistory,
            conversationId: conversationHistory[0]?.conversation_id,
            founderPresent: true, // dispatched from live chat — founder is watching
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

  // Agent list
  const agentList = agents.length > 0
    ? agents.map(a => `- ${a.name} (${a.role}) — Model: ${a.model}`).join('\n')
    : '- No agents hired yet';

  // Skills list — full command definitions with parameter requirements
  let skillList: string;
  let disabledSkillList = '';
  try {
    const resolved = await resolveSkills();
    const enabledResolved = resolved.filter(s => s.enabled);
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
          const def = skillDefinitions.find(d => d.id === s.id);
          return `- ${s.id}: ${def?.name ?? s.id} — ${def?.description ?? 'No description'}`;
        }).join('\n')
      : '- No skills enabled yet';
  }

  // Mission list
  const missionList = missions.length > 0
    ? missions.map(m => `- [${m.status}] ${m.title} — Assignee: ${m.assignee ?? 'Unassigned'} — Priority: ${m.priority}`).join('\n')
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
    budgetBlock = `### Budget & Spend
- Monthly budget: $${monthlyBudget.toFixed(2)}
- Spent this month (${currentMonth}): $${spend.total.toFixed(4)} (${pctUsed}% used)
  - LLM costs: $${spend.llm.toFixed(4)}
  - Channel costs: $${spend.channel.toFixed(4)}
- Remaining: $${remaining.toFixed(4)}${remaining <= 0 ? ' — BUDGET EXCEEDED, no more LLM calls until budget is increased or new month' : ''}`;
  } else {
    budgetBlock = `### Budget & Spend
- Monthly budget: Not set
- Spent this month (${currentMonth}): $${spend.total.toFixed(4)}
  - LLM costs: $${spend.llm.toFixed(4)}
  - Channel costs: $${spend.channel.toFixed(4)}`;
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `You are ${ceo.name}, the AI Chief Executive Officer of ${orgName}.
Founded by ${founderName}. Primary mission: ${primaryMission}.
Today's date: ${today}.

${personaBlock}

${philosophyBlock}

${riskBlock}

${founderSoulBlock}

${memoryBlock}

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

## Tool Usage — When and How to Use Skills

**DECISION FLOW — follow this every time the founder asks you to do something:**

1. **Can you answer from your own knowledge right now?** (opinion, advice, strategy, explaining a concept, discussing plans, simple math, brainstorming)
   → Just answer. No tools needed. Most conversations are this.

2. **Does it require real-time data, external research, content generation, or code execution?**
   → This needs a skill. Check the Enabled Skills list above.

   **PARAMETER CHECK — before dispatching ANY skill:**
   Look at the command's REQUIRED parameters. Do you have all of them from context (conversation, memory, founder profile)?
   - **Missing a required parameter?** → Ask the founder naturally: "What city should I check weather for?" or "What topic should I research?"
   - **All required params available?** → Proceed to dispatch (see below)
   - **Optional params?** → Use sensible defaults, don't ask unless the founder would care

   **QUICK vs LONG tasks:**
   - **Quick** (weather lookup, simple search, image generation): Tell the founder you're running it — "Let me check that now..." — then emit the tool call. The result will appear shortly.
   - **Long** (deep research, multi-step analysis): Ask first — "That'll take a few minutes. Want me to kick it off now or queue it as a mission?"

3. **Is it a complex multi-step project?** (multiple skills, research + analysis, etc.)
   → Propose it as a mission brief. Outline what you'd do, which skills you'd use, estimated scope. Let the founder approve the plan before dispatching.

4. **Does the conversation suggest a DISABLED skill would help?**
   → Check the "Available but DISABLED Skills" list. If one matches what the founder needs:
   "We have [skill name] available but it's not turned on yet. It would let us [what it does]. Want me to enable it?"
   Only suggest skills that are directly relevant — don't spam recommendations.
   **When the founder says yes**, emit an enable_skill tool call to create an approval request:
   <tool_call>{"name":"enable_skill","arguments":{"skill_id":"the-skill-id","skill_name":"Display Name"}}</tool_call>
   This will pop up an approval card for the founder to confirm. Do NOT tell them to go enable it manually.

**IMPORTANT:** Never silently dispatch skills. Always tell the founder what you're doing.

**When emitting tool calls**, wrap them in a <task_plan> block:
<task_plan>
{"missions":[{"title":"Mission name","tool_calls":[{"name":"skill-id","command":"command_name","arguments":{"param":"value"}}]}]}
</task_plan>
Group related calls into one mission. Unrelated requests = separate missions.
For a single quick call, you can use <tool_call>{"name":"skill-id","command":"command_name","arguments":{...}}</tool_call>
For enabling a disabled skill, use <tool_call>{"name":"enable_skill","arguments":{"skill_id":"skill-id","skill_name":"Skill Name"}}</tool_call>

**CRITICAL:** Always include today's date (${today}) in any search queries or time-sensitive skill arguments. Never guess the date — use the one provided above.

## Rules
1. Respond naturally and conversationally to the founder's messages
2. Match your personality and communication style to your designation above
3. When the founder asks you to do something, first decide: can I answer this myself, or do I need a skill?
4. NEVER fire off skills without telling the founder what you're doing and getting their go-ahead
5. NEVER fabricate data — only reference real missions, agents, and skills from the context above
6. Keep responses concise but informative
7. You're chatting in real-time with the founder — be responsive and helpful`;
}
