import { getSupabase } from './supabase';
import { loadCEO, type ChatMessageRow } from './database';
import { getMemories, queryMemories, type MemoryRow } from './memory';

export interface ParsedMission {
  title: string;
  toolCalls: { name: string; arguments: Record<string, unknown> }[];
}

export interface DispatchContext {
  /** Recent conversation messages leading to this dispatch */
  conversationExcerpt?: ChatMessageRow[];
  /** Conversation ID for tracing */
  conversationId?: string;
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

/** Create missions + task_executions and dispatch to edge function */
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
    await sb.from('missions').insert({
      id: missionId,
      title: mission.title,
      status: 'in_progress',
      assignee: ceo?.name ?? 'CEO',
      priority: 'medium',
      created_by: ceo?.name ?? 'CEO',
    });

    // Create task_executions and dispatch
    for (const call of mission.toolCalls) {
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      await sb.from('task_executions').insert({
        id: taskId,
        mission_id: missionId,
        agent_id: 'ceo',
        skill_id: call.name,
        command_name: call.name,
        params: call.arguments,
        model,
        status: 'pending',
        context: taskContext,
      });

      // Fire-and-forget dispatch to edge function
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('jarvis_supabase_url') || '';
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('jarvis_supabase_anon_key') || '';

      fetch(`${supabaseUrl}/functions/v1/execute-skill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ task_execution_id: taskId }),
      }).catch(err => console.error('Dispatch failed:', err));
    }
  }

  window.dispatchEvent(new Event('missions-changed'));
  window.dispatchEvent(new Event('task-executions-changed'));
  return missionIds;
}
