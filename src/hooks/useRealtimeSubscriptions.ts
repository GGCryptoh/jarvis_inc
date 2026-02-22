/**
 * useRealtimeSubscriptions — Supabase Realtime → window events bridge
 * =====================================================================
 * Subscribes to Postgres changes on key tables and re-broadcasts them
 * as window events so existing components (which already listen via
 * `window.addEventListener`) get live updates without any refactoring.
 *
 * Tables monitored:
 *   approvals, agents, missions, chat_messages, ceo, ceo_action_queue, task_executions
 */

import { useEffect } from 'react';
import { getSupabase } from '../lib/supabase';

/** Map of table name → window event name to dispatch on change. */
const TABLE_EVENT_MAP: Record<string, string> = {
  approvals: 'approvals-changed',
  agents: 'agents-changed',
  missions: 'missions-changed',
  chat_messages: 'chat-messages-changed',
  ceo: 'ceo-changed',
  ceo_action_queue: 'ceo-actions-changed',
  task_executions: 'task-executions-changed',
};

export function useRealtimeSubscriptions(): void {
  useEffect(() => {
    const supabase = getSupabase();

    const channel = supabase.channel('db-changes');

    // Subscribe to each table
    for (const [table, eventName] of Object.entries(TABLE_EVENT_MAP)) {
      channel.on(
        'postgres_changes' as 'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          window.dispatchEvent(new Event(eventName));
        },
      );
    }

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[Realtime] Subscribed to database changes');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('[Realtime] Channel error — will retry');
      }
    });

    // Cleanup
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}
