/**
 * CEO Action Queue — lightweight proactive CEO notification system
 * Actions are written to the ceo_action_queue Supabase table and
 * consumed by UI components to show notifications.
 */

import { getSupabase } from './supabase';

export interface CEOAction {
  id: string;
  action_type: 'mission_review' | 'needs_attention' | 'insight' | 'greeting';
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  status: 'pending' | 'seen' | 'dismissed';
  created_at: string;
}

/** Queue a new CEO action */
export async function queueCEOAction(
  actionType: CEOAction['action_type'],
  title: string,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const id = `action-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await getSupabase().from('ceo_action_queue').insert({
      id,
      action_type: actionType,
      title,
      message,
      metadata: metadata ?? {},
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    window.dispatchEvent(new Event('ceo-actions-changed'));
  } catch {
    // Table may not exist yet — fail silently
  }
}

/** Load pending CEO actions (not yet seen/dismissed) */
export async function loadPendingActions(): Promise<CEOAction[]> {
  try {
    const { data } = await getSupabase()
      .from('ceo_action_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10);
    return (data ?? []) as CEOAction[];
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
