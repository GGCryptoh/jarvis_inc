import { getSupabase } from './supabase';
import { estimateCost } from './models';

export type UsageContext = 'ceo_chat' | 'skill_execution' | 'memory_extraction' | 'conversation_summary';

export interface UsageEntry {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  context: UsageContext;
  missionId?: string;
  agentId?: string;
  conversationId?: string;
}

export async function logUsage(entry: UsageEntry): Promise<void> {
  const cost = estimateCost(entry.model, entry.inputTokens, entry.outputTokens);
  const id = `usage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await getSupabase().from('llm_usage').insert({
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
}

export async function getTotalUsage(): Promise<{ totalTokens: number; totalCost: number }> {
  const { data } = await getSupabase()
    .from('llm_usage')
    .select('input_tokens, output_tokens, estimated_cost');
  if (!data || data.length === 0) return { totalTokens: 0, totalCost: 0 };
  return {
    totalTokens: data.reduce((sum, r) => sum + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0),
    totalCost: data.reduce((sum, r) => sum + (r.estimated_cost ?? 0), 0),
  };
}

export async function getUsageByContext(context: UsageContext): Promise<{ totalTokens: number; totalCost: number }> {
  const { data } = await getSupabase()
    .from('llm_usage')
    .select('input_tokens, output_tokens, estimated_cost')
    .eq('context', context);
  if (!data || data.length === 0) return { totalTokens: 0, totalCost: 0 };
  return {
    totalTokens: data.reduce((sum, r) => sum + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0),
    totalCost: data.reduce((sum, r) => sum + (r.estimated_cost ?? 0), 0),
  };
}
