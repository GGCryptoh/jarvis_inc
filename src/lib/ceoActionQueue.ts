/**
 * CEO Action Queue — lightweight proactive CEO notification system
 * Actions are written to the ceo_action_queue Supabase table and
 * consumed by UI components to show notifications.
 *
 * DB schema: { id, action_type, payload JSONB, status, priority, created_at }
 * payload contains: { topic, message, navigateTo?, ... }
 */

import { getSupabase } from './supabase';

export interface CEOAction {
  id: string;
  action_type: string;
  message: string;
  topic?: string;
  navigateTo?: string;
  payload?: Record<string, unknown>;
  status: 'pending' | 'seen' | 'dismissed';
  priority: number;
  created_at: string;
}

/** Queue a new CEO action */
export async function queueCEOAction(
  actionType: string,
  message: string,
  opts?: { topic?: string; navigateTo?: string; priority?: number; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    const id = `action-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await getSupabase().from('ceo_action_queue').insert({
      id,
      action_type: actionType,
      payload: {
        topic: opts?.topic ?? actionType,
        message,
        navigateTo: opts?.navigateTo,
        ...(opts?.metadata ?? {}),
      },
      status: 'pending',
      priority: opts?.priority ?? 5,
      created_at: new Date().toISOString(),
    });
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('ceo-actions-changed'));
  } catch {
    // Table may not exist yet — fail silently
  }
}

/** Load pending CEO actions (not yet seen/dismissed) — maps DB payload to flat fields */
export async function loadPendingActions(): Promise<CEOAction[]> {
  try {
    const { data } = await getSupabase()
      .from('ceo_action_queue')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(10);
    return (data ?? []).map((row: Record<string, unknown>) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      return {
        id: row.id as string,
        action_type: row.action_type as string,
        message: (payload.message as string) ?? '',
        topic: payload.topic as string | undefined,
        navigateTo: payload.navigateTo as string | undefined,
        payload,
        status: row.status as CEOAction['status'],
        priority: (row.priority as number) ?? 5,
        created_at: row.created_at as string,
      };
    });
  } catch {
    return []; // Table may not exist yet
  }
}

/** Mark an action as seen */
export async function markActionSeen(actionId: string): Promise<void> {
  try {
    await getSupabase()
      .from('ceo_action_queue')
      .update({ status: 'seen' })
      .eq('id', actionId);
    window.dispatchEvent(new Event('ceo-actions-changed'));
  } catch {
    // Table may not exist yet — fail silently
  }
}

/** Mark an action as dismissed */
export async function dismissAction(actionId: string): Promise<void> {
  try {
    await getSupabase()
      .from('ceo_action_queue')
      .update({ status: 'dismissed' })
      .eq('id', actionId);
    window.dispatchEvent(new Event('ceo-actions-changed'));
  } catch {
    // Table may not exist yet — fail silently
  }
}

/** Get count of pending actions */
export async function getPendingActionCount(): Promise<number> {
  try {
    const { count } = await getSupabase()
      .from('ceo_action_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    return count ?? 0;
  } catch {
    return 0; // Table may not exist yet
  }
}
