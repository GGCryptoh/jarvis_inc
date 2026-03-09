import { getSupabase } from './supabase';
import { estimateCost } from './models';

export type UsageContext = 'ceo_chat' | 'agent_chat' | 'skill_execution' | 'memory_extraction' | 'conversation_summary' | 'mission_planning' | 'ceo_direct';

export interface UsageEntry {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  context: UsageContext;
  missionId?: string;
  agentId?: string;
  conversationId?: string;
  /** Override estimated cost (e.g. DALL-E fixed per-image pricing) */
  costOverride?: number;
}

export async function logUsage(entry: UsageEntry): Promise<void> {
  const cost = entry.costOverride ?? estimateCost(entry.model, entry.inputTokens, entry.outputTokens);
  const id = `usage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error } = await getSupabase().from('llm_usage').insert({
    id,
    provider: entry.provider,
    model: entry.model,
    input_tokens: entry.inputTokens,
    output_tokens: entry.outputTokens,
    estimated_cost: cost,
    context: entry.context,
    mission_id: entry.missionId ?? null,
    agent_id: entry.agentId ?? null,
    conversation_id: entry.conversationId ?? null,
  });
  if (error) {
    console.warn('logUsage insert failed:', error.message, error.details);
    throw error;
  }
}

export async function getTotalUsage(): Promise<{ totalTokens: number; totalCost: number }> {
  const { data, error } = await getSupabase()
    .from('llm_usage')
    .select('input_tokens, output_tokens, estimated_cost');
  if (error) console.warn('getTotalUsage query failed:', error.message);
  if (!data || data.length === 0) return { totalTokens: 0, totalCost: 0 };
  return {
    totalTokens: data.reduce((sum, r) => sum + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0),
    totalCost: data.reduce((sum, r) => sum + (r.estimated_cost ?? 0), 0),
  };
}

export async function getUsageByContext(context: UsageContext): Promise<{ totalTokens: number; totalCost: number }> {
  const { data, error } = await getSupabase()
    .from('llm_usage')
    .select('input_tokens, output_tokens, estimated_cost')
    .eq('context', context);
  if (error) console.warn('getUsageByContext query failed:', error.message);
  if (!data || data.length === 0) return { totalTokens: 0, totalCost: 0 };
  return {
    totalTokens: data.reduce((sum, r) => sum + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0),
    totalCost: data.reduce((sum, r) => sum + (r.estimated_cost ?? 0), 0),
  };
}

export async function getMonthlyUsage(): Promise<{ month: string; llmCost: number; channelCost: number }[]> {
  const { data: llm, error: llmErr } = await getSupabase()
    .from('llm_usage')
    .select('created_at, estimated_cost');
  if (llmErr) console.warn('getMonthlyUsage llm query failed:', llmErr.message);

  const { data: channels, error: chanErr } = await getSupabase()
    .from('channel_usage')
    .select('created_at, cost');
  if (chanErr) console.warn('getMonthlyUsage channel query failed:', chanErr.message);

  // Group by month (YYYY-MM format)
  const months: Record<string, { llm: number; channel: number }> = {};

  for (const row of llm ?? []) {
    const month = new Date(row.created_at).toISOString().slice(0, 7);
    months[month] = months[month] ?? { llm: 0, channel: 0 };
    months[month].llm += row.estimated_cost ?? 0;
  }

  for (const row of channels ?? []) {
    const month = new Date(row.created_at).toISOString().slice(0, 7);
    months[month] = months[month] ?? { llm: 0, channel: 0 };
    months[month].channel += row.cost ?? 0;
  }

  return Object.entries(months)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, costs]) => ({ month, llmCost: costs.llm, channelCost: costs.channel }));
}

export async function getCurrentMonthSpend(): Promise<{ llm: number; channel: number; total: number }> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: llm, error: llmErr } = await getSupabase()
    .from('llm_usage')
    .select('estimated_cost')
    .gte('created_at', startOfMonth.toISOString());
  if (llmErr) console.warn('getCurrentMonthSpend llm query failed:', llmErr.message);

  const { data: channels, error: chanErr } = await getSupabase()
    .from('channel_usage')
    .select('cost')
    .gte('created_at', startOfMonth.toISOString());
  if (chanErr) console.warn('getCurrentMonthSpend channel query failed:', chanErr.message);

  const llmTotal = (llm ?? []).reduce((s, r) => s + (r.estimated_cost ?? 0), 0);
  const channelTotal = (channels ?? []).reduce((s, r) => s + (r.cost ?? 0), 0);

  return { llm: llmTotal, channel: channelTotal, total: llmTotal + channelTotal };
}

export async function getDailyUsage(): Promise<{ day: number; date: string; llmCost: number; channelCost: number }[]> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [{ data: llm, error: llmErr }, { data: channels, error: chanErr }] = await Promise.all([
    getSupabase().from('llm_usage').select('created_at, estimated_cost').gte('created_at', startOfMonth.toISOString()),
    getSupabase().from('channel_usage').select('created_at, cost').gte('created_at', startOfMonth.toISOString()),
  ]);
  if (llmErr) console.warn('getDailyUsage llm query failed:', llmErr.message);
  if (chanErr) console.warn('getDailyUsage channel query failed:', chanErr.message);

  // Group by day-of-month
  const days: Record<number, { llm: number; channel: number }> = {};
  for (const row of llm ?? []) {
    const d = new Date(row.created_at).getDate();
    days[d] = days[d] ?? { llm: 0, channel: 0 };
    days[d].llm += row.estimated_cost ?? 0;
  }
  for (const row of channels ?? []) {
    const d = new Date(row.created_at).getDate();
    days[d] = days[d] ?? { llm: 0, channel: 0 };
    days[d].channel += row.cost ?? 0;
  }

  const now = new Date();
  const daysElapsed = now.getDate();
  const result: { day: number; date: string; llmCost: number; channelCost: number }[] = [];
  for (let d = 1; d <= daysElapsed; d++) {
    const entry = days[d] ?? { llm: 0, channel: 0 };
    const dateObj = new Date(now.getFullYear(), now.getMonth(), d);
    result.push({
      day: d,
      date: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      llmCost: entry.llm,
      channelCost: entry.channel,
    });
  }
  return result;
}

export async function getAgentUsage(agentId: string): Promise<{ totalTokens: number; totalCost: number; taskCount: number }> {
  const { data, error } = await getSupabase()
    .from('llm_usage')
    .select('input_tokens, output_tokens, estimated_cost')
    .eq('agent_id', agentId);
  if (error) console.warn('getAgentUsage query failed:', error.message);

  if (!data || data.length === 0) return { totalTokens: 0, totalCost: 0, taskCount: 0 };
  return {
    totalTokens: data.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0),
    totalCost: data.reduce((s, r) => s + r.estimated_cost, 0),
    taskCount: data.length,
  };
}
