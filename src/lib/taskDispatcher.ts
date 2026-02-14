import { getSupabase } from './supabase';
import { loadCEO, getVaultEntryByService, type ChatMessageRow } from './database';
import { getMemories, queryMemories } from './memory';
import { executeSkill } from './skillExecutor';
import { resolveSkill } from './skillResolver';
import { executeCLISkill, hasCLIHandler } from './cliSkillHandlers';
import { MODEL_SERVICE_MAP, MODEL_API_IDS } from './models';

export interface ParsedMission {
  title: string;
  toolCalls: { name: string; arguments: Record<string, unknown> }[];
}

export interface DispatchContext {
  /** Recent conversation messages leading to this dispatch */
  conversationExcerpt?: ChatMessageRow[];
  /** Conversation ID for tracing */
  conversationId?: string;
  /** True when dispatched from a live chat (founder is watching). Quick tasks auto-complete. */
  founderPresent?: boolean;
}

/** Parse <task_plan> or individual <tool_call> blocks from CEO response */
export function parseTaskPlan(text: string): ParsedMission[] {
  // Try <task_plan> first
  const planMatch = text.match(/<task_plan>\s*([\s\S]*?)\s*<\/task_plan>/);
  if (planMatch) {
    try {
      const plan = JSON.parse(planMatch[1]);
      return (plan.missions ?? []).map((m: Record<string, unknown>) => ({
        title: (m.title as string) ?? 'Untitled mission',
        toolCalls: (m.tool_calls as { name: string; arguments: Record<string, unknown> }[]) ?? [],
      }));
    } catch { /* fall through */ }
  }

  // Fallback: individual <tool_call> blocks -> one mission per call
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const missions: ParsedMission[] = [];
  let match: RegExpExecArray | null;
  while ((match = toolCallRegex.exec(text)) !== null) {
    try {
      const call = JSON.parse(match[1]);
      missions.push({
        title: `${call.name}: ${Object.values(call.arguments ?? {})[0] ?? 'execute'}`.slice(0, 100),
        toolCalls: [call],
      });
    } catch { /* skip unparseable */ }
  }

  return missions;
}

/** Strip task_plan/tool_call blocks from text, leaving the conversational parts */
export function stripTaskBlocks(text: string): string {
  return text
    .replace(/<task_plan>[\s\S]*?<\/task_plan>/g, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .trim();
}

/**
 * Build context payload for agent task execution.
 * CEO selects relevant memories + conversation context to include.
 */
async function buildTaskContext(
  mission: ParsedMission,
  context?: DispatchContext,
): Promise<Record<string, unknown>> {
  const taskContext: Record<string, unknown> = {};

  // Founder profile memories — always included
  const allMemories = await getMemories(40);
  const founderProfile = allMemories
    .filter(m => m.category === 'founder_profile')
    .map(m => m.content);
  if (founderProfile.length > 0) {
    taskContext.founder_profile = founderProfile;
  }

  // Query relevant org memories based on mission title + tool call args
  const searchText = [
    mission.title,
    ...mission.toolCalls.map(tc => Object.values(tc.arguments).join(' ')),
  ].join(' ');
  const relevantMemories = await queryMemories(searchText, 10);
  const orgMemories = relevantMemories
    .filter(m => m.category !== 'founder_profile')
    .map(m => ({ category: m.category, content: m.content, tags: m.tags }));
  if (orgMemories.length > 0) {
    taskContext.relevant_memories = orgMemories;
  }

  // Conversation excerpt — last 10 messages from the chat that spawned this
  if (context?.conversationExcerpt && context.conversationExcerpt.length > 0) {
    const excerpt = context.conversationExcerpt.slice(-10).map(m => ({
      sender: m.sender,
      text: m.text.slice(0, 500), // Truncate long messages
    }));
    taskContext.conversation_context = excerpt;
    taskContext.conversation_id = context.conversationId;
  }

  return taskContext;
}

// ---------------------------------------------------------------------------
// Mission summary synthesizer — combines multi-task results into one artifact
// ---------------------------------------------------------------------------

export async function synthesizeMissionSummary(
  missionId: string,
  missionTitle: string,
): Promise<void> {
  const sb = getSupabase();

  try {
    // Fetch all completed task results
    const { data: tasks } = await sb
      .from('task_executions')
      .select('skill_id, command_name, result, status')
      .eq('mission_id', missionId)
      .eq('status', 'completed')
      .order('created_at', { ascending: true });

    if (!tasks || tasks.length < 2) return; // Only synthesize multi-task missions

    // Build a combined text of all task outputs
    const taskOutputs = tasks.map((t, i) => {
      const output = (t.result as Record<string, unknown>)?.output as string ?? 'No output';
      const skill = t.skill_id ?? 'unknown';
      const cmd = t.command_name ?? '';
      return `--- Task ${i + 1}: ${skill} / ${cmd} ---\n${output}`;
    }).join('\n\n');

    // Try to get the CEO's LLM to synthesize
    const ceo = await loadCEO();
    if (!ceo?.model) {
      // No LLM available — create a simple concatenated summary
      const summaryId = `task-summary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await sb.from('task_executions').insert({
        id: summaryId,
        mission_id: missionId,
        agent_id: 'ceo',
        skill_id: 'mission-summary',
        command_name: 'synthesize',
        params: { mission_title: missionTitle, task_count: tasks.length },
        model: 'none',
        status: 'completed',
        result: {
          output: `# ${missionTitle}\n\n${taskOutputs}`,
          summary: `Combined results from ${tasks.length} tasks for "${missionTitle}"`,
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      window.dispatchEvent(new Event('task-executions-changed'));
      return;
    }

    const service = MODEL_SERVICE_MAP[ceo.model] ?? '';
    const vaultEntry = service ? await getVaultEntryByService(service) : null;

    if (!service || !vaultEntry) {
      // No API key — fall back to concatenation
      const summaryId = `task-summary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await sb.from('task_executions').insert({
        id: summaryId,
        mission_id: missionId,
        agent_id: 'ceo',
        skill_id: 'mission-summary',
        command_name: 'synthesize',
        params: { mission_title: missionTitle, task_count: tasks.length },
        model: 'none',
        status: 'completed',
        result: {
          output: `# ${missionTitle}\n\n${taskOutputs}`,
          summary: `Combined results from ${tasks.length} tasks for "${missionTitle}"`,
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      window.dispatchEvent(new Event('task-executions-changed'));
      return;
    }

    // Use LLM to synthesize
    const { anthropicProvider } = await import('./llm/providers/anthropic');
    const { openaiProvider, deepseekProvider, xaiProvider } = await import('./llm/providers/openai');
    const { googleProvider } = await import('./llm/providers/google');
    const providers: Record<string, typeof anthropicProvider> = {
      Anthropic: anthropicProvider, OpenAI: openaiProvider, Google: googleProvider,
      DeepSeek: deepseekProvider, xAI: xaiProvider,
    };
    const provider = providers[service];
    if (!provider) return;

    const apiModelId = MODEL_API_IDS[ceo.model] ?? ceo.model;

    const synthesisPrompt = `You are a CEO synthesizing the results of a multi-part mission.

Mission: "${missionTitle}"

Below are the outputs from ${tasks.length} individual research/analysis tasks that were part of this mission. Create a single, unified executive report that:

1. Opens with a brief executive summary (2-3 sentences)
2. Synthesizes the key findings across all tasks into a coherent narrative
3. Highlights the most important insights, data points, and recommendations
4. Ends with clear next steps or action items

Use markdown formatting (headers, bullet points, bold for emphasis). Be comprehensive but avoid redundancy — merge overlapping findings rather than repeating them.

---

${taskOutputs}`;

    const messages = [
      { role: 'system' as const, content: 'You are an executive AI assistant creating a unified mission report from multiple research outputs.' },
      { role: 'user' as const, content: synthesisPrompt },
    ];

    const synthesized = await new Promise<string>((resolve, reject) => {
      provider.stream(messages, vaultEntry.key_value, apiModelId, {
        onToken: () => {},
        onDone: (fullText: string) => resolve(fullText),
        onError: (err: Error) => reject(err),
      });
    });

    // Store as a summary artifact
    const summaryId = `task-summary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const inputTokens = Math.ceil(synthesisPrompt.length / 4);
    const outputTokens = Math.ceil(synthesized.length / 4);

    await sb.from('task_executions').insert({
      id: summaryId,
      mission_id: missionId,
      agent_id: 'ceo',
      skill_id: 'mission-summary',
      command_name: 'synthesize',
      params: { mission_title: missionTitle, task_count: tasks.length },
      model: ceo.model,
      status: 'completed',
      tokens_used: inputTokens + outputTokens,
      cost_usd: 0, // We could estimate but keeping it simple
      result: {
        output: synthesized,
        summary: `Unified report for "${missionTitle}" — synthesized from ${tasks.length} tasks`,
      },
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    window.dispatchEvent(new Event('task-executions-changed'));
  } catch (err) {
    console.warn('[TaskDispatcher] Mission summary synthesis failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Browser-side skill execution fallback
// ---------------------------------------------------------------------------

async function executeBrowserSide(
  taskId: string,
  missionId: string,
  skillId: string,
  commandName: string,
  params: Record<string, unknown>,
  model: string,
  founderPresent = false,
): Promise<void> {
  const sb = getSupabase();

  // Mark as running
  await sb.from('task_executions').update({
    status: 'running',
    started_at: new Date().toISOString(),
  }).eq('id', taskId);

  try {
    let resultText: string;
    let cost = 0;
    let tokensUsed = 0;

    // Check for CLI handler first
    if (hasCLIHandler(skillId)) {
      const result = await executeCLISkill(skillId, commandName, params);
      if (!result) throw new Error(`CLI skill "${skillId}" handler returned null`);
      if (!result.success) throw new Error(result.text);
      resultText = result.text;
    } else {
      // LLM skill — use browser-side executor (handles CLI fallback too)
      const result = await executeSkill(skillId, commandName, params, {
        modelOverride: model,
        missionId,
      });

      if (!result.success) throw new Error(result.error ?? 'Skill execution failed');
      resultText = result.output;
      cost = result.cost_usd;
      tokensUsed = result.tokens_used;
    }

    // Update task_execution
    await sb.from('task_executions').update({
      status: 'completed',
      result: { output: resultText, summary: resultText.slice(0, 200) },
      tokens_used: tokensUsed,
      cost_usd: cost,
      completed_at: new Date().toISOString(),
    }).eq('id', taskId);

    // Check if all tasks for this mission are complete
    const { data: siblings } = await sb
      .from('task_executions')
      .select('status')
      .eq('mission_id', missionId);

    const allComplete = siblings?.every(t => t.status === 'completed' || t.status === 'failed');

    if (allComplete) {
      const completedCount = siblings?.filter(t => t.status === 'completed').length ?? 0;
      const isSingle = (siblings?.length ?? 0) === 1 && completedCount === 1;

      // Founder present + quick task = auto-done (they see it in chat)
      // Founder away or complex multi-task = review (needs approval)
      const isTabVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
      const autoComplete = founderPresent && isTabVisible && isSingle;
      const missionStatus = autoComplete ? 'done' : 'review';

      await sb.from('missions').update({ status: missionStatus }).eq('id', missionId);

      // For multi-task missions, synthesize a unified summary (fire-and-forget)
      if (!isSingle && completedCount >= 2) {
        const { data: missionRow } = await sb.from('missions').select('title').eq('id', missionId).single();
        synthesizeMissionSummary(missionId, missionRow?.title ?? 'Untitled Mission').catch(err =>
          console.warn('[TaskDispatcher] Summary synthesis failed:', err),
        );
      }

      // Post CEO summary to chat
      const { data: convos } = await sb
        .from('conversations')
        .select('id')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1);

      const convoId = convos?.[0]?.id;
      if (convoId) {
        const brief = resultText.slice(0, 300).replace(/\n+/g, ' ').trim();
        const ellipsis = resultText.length > 300 ? '...' : '';

        let summary: string;
        if (autoComplete) {
          // Quick task, founder watching — show result inline, mission auto-done
          summary = resultText;
        } else if (isSingle) {
          // Single task but founder not watching — brief summary + pointer
          summary = `Done — ${brief}${ellipsis}\n\nFull results in Collateral.`;
        } else {
          // Multi-task mission — always review
          summary = `Mission complete — ${completedCount} task(s) finished. Full results in Collateral.`;
        }

        await sb.from('chat_messages').insert({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: convoId,
          sender: 'ceo',
          text: summary,
          metadata: autoComplete
            ? {
                type: 'skill_result',
                mission_id: missionId,
                skill_id: skillId,
                output_type: 'inline',
                auto_completed: true,
                actions: [
                  { id: 'view', label: 'VIEW IN COLLATERAL', action: 'navigate', target: '/collateral' },
                ],
              }
            : {
                type: 'mission_complete',
                mission_id: missionId,
                skill_id: skillId,
                output_type: 'review',
                actions: [
                  { id: 'approve', label: 'LOOKS GOOD', action: 'approve_mission' },
                  { id: 'review', label: 'REVIEW IN MISSIONS', action: 'navigate', target: `/missions/${missionId}` },
                  { id: 'collateral', label: 'VIEW COLLATERAL', action: 'navigate', target: '/collateral' },
                ],
              },
        });

        // Trigger UI update
        window.dispatchEvent(new Event('chat-messages-changed'));
      }

      // Queue CEO proactive action for multi-task or review missions
      if (!autoComplete) {
        const mTitle = missionStatus === 'review'
          ? (await sb.from('missions').select('title').eq('id', missionId).single()).data?.title ?? missionId
          : missionId;
        try {
          const { queueCEOAction } = await import('./ceoActionQueue');
          await queueCEOAction(
            'mission_review',
            `Mission complete: ${mTitle}`,
            `I've finished ${completedCount} task(s). Ready for your review.`,
            { mission_id: missionId, task_count: completedCount },
          );
        } catch { /* ignore action queue errors */ }
      }
    }

    window.dispatchEvent(new Event('missions-changed'));
    window.dispatchEvent(new Event('task-executions-changed'));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Browser-side skill execution failed [${skillId}]:`, errorMsg);

    await sb.from('task_executions').update({
      status: 'failed',
      result: { error: errorMsg },
      completed_at: new Date().toISOString(),
    }).eq('id', taskId);

    // Post error to chat
    const { data: convos } = await sb
      .from('conversations')
      .select('id')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);
    const convoId = convos?.[0]?.id;
    if (convoId) {
      await sb.from('chat_messages').insert({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        conversation_id: convoId,
        sender: 'ceo',
        text: `I ran into an issue executing ${skillId}: ${errorMsg}`,
        metadata: { type: 'skill_error', skill_id: skillId, mission_id: missionId },
      });
      window.dispatchEvent(new Event('chat-messages-changed'));
    }

    await sb.from('missions').update({ status: 'review' }).eq('id', missionId);
    window.dispatchEvent(new Event('missions-changed'));
    window.dispatchEvent(new Event('task-executions-changed'));
  }
}

/** Create missions + task_executions and dispatch to edge function (with browser fallback) */
export async function dispatchTaskPlan(
  missions: ParsedMission[],
  model: string,
  context?: DispatchContext,
): Promise<string[]> {
  const sb = getSupabase();
  const ceo = await loadCEO();
  const missionIds: string[] = [];

  for (const mission of missions) {
    const missionId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    missionIds.push(missionId);

    // Build context payload with relevant memories + conversation
    const taskContext = await buildTaskContext(mission, context);

    // Create mission
    const { error: missionErr } = await sb.from('missions').insert({
      id: missionId,
      title: mission.title,
      status: 'in_progress',
      assignee: ceo?.name ?? 'CEO',
      priority: 'medium',
      created_by: ceo?.name ?? 'CEO',
    });
    if (missionErr) {
      console.error('Failed to insert mission:', missionErr.message, missionErr.details);
      continue;
    }

    // Create task_executions and dispatch
    for (const call of mission.toolCalls) {
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      // CEO format: { name, command, arguments } — command may be top-level or inside arguments
      const commandName = (call as Record<string, unknown>).command as string
        ?? call.arguments.command as string
        ?? call.name;

      const { error: taskInsertErr } = await sb.from('task_executions').insert({
        id: taskId,
        mission_id: missionId,
        agent_id: 'ceo',
        skill_id: call.name,
        command_name: commandName,
        params: call.arguments,
        model,
        status: 'pending',
        context: taskContext,
      });
      if (taskInsertErr) {
        console.error('Failed to insert task_execution:', taskInsertErr.message, taskInsertErr.details);
        continue; // skip this task
      }

      // Try edge function first, fall back to browser-side execution
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('jarvis_supabase_url') || '';
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('jarvis_supabase_anon_key') || '';

      const founderPresent = !!(context?.founderPresent);

      const runBrowserFallback = () =>
        executeBrowserSide(taskId, missionId, call.name, commandName, call.arguments, model, founderPresent);

      fetch(`${supabaseUrl}/functions/v1/execute-skill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ task_execution_id: taskId }),
      }).then(async (resp) => {
        if (!resp.ok) {
          const errText = await resp.text().catch(() => 'Unknown error');
          console.warn(`Edge function returned ${resp.status}: ${errText}. Falling back to browser execution.`);
          await runBrowserFallback();
          return;
        }
        // Edge function returned 200 — check after 15s if it actually processed.
        // If task is still pending, the edge function didn't do anything → run browser-side.
        setTimeout(async () => {
          try {
            const { data: check } = await sb
              .from('task_executions')
              .select('status')
              .eq('id', taskId)
              .single();
            if (check?.status === 'pending') {
              console.warn('Edge function returned 200 but task still pending after 15s. Running browser fallback.');
              await runBrowserFallback();
            } else if (founderPresent) {
              // Edge function completed it — check for founder-present auto-done
              const { data: siblings } = await sb
                .from('task_executions')
                .select('status')
                .eq('mission_id', missionId);
              const allDone = siblings?.every(t => t.status === 'completed' || t.status === 'failed');
              const isSingle = (siblings?.length ?? 0) === 1;
              const isTabVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
              if (allDone && isSingle && isTabVisible) {
                await sb.from('missions').update({ status: 'done' }).eq('id', missionId);
                window.dispatchEvent(new Event('missions-changed'));
              }
            }
          } catch { /* ignore timeout check errors */ }
        }, 15_000);
      }).catch(async (err) => {
        console.warn('Edge function unreachable:', err.message ?? err, '— falling back to browser execution.');
        await runBrowserFallback();
      });
    }
  }

  window.dispatchEvent(new Event('missions-changed'));
  window.dispatchEvent(new Event('task-executions-changed'));
  return missionIds;
}
