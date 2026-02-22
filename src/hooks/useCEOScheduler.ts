/**
 * useCEOScheduler — React hook (display-only)
 * =============================================
 * The sidecar now owns the scheduler loop. This hook polls
 * `scheduler_state` for heartbeat + last cycle result to
 * display in the UI. No evaluateCycle() calls from browser.
 */

import { useEffect, useState, useCallback } from 'react';
import { getSupabase } from '../lib/supabase';

interface SchedulerInfo {
  isRunning: boolean;
  lastHeartbeat: string | null;
  source: string | null;
  intervalMs: number | null;
  budgetPaused: boolean;
  checks: Record<string, unknown> | null;
}

export function useCEOScheduler(): SchedulerInfo {
  const [info, setInfo] = useState<SchedulerInfo>({
    isRunning: false,
    lastHeartbeat: null,
    source: null,
    intervalMs: null,
    budgetPaused: false,
    checks: null,
  });

  const poll = useCallback(async () => {
    try {
      const { data } = await getSupabase()
        .from('scheduler_state')
        .select('status, last_heartbeat, interval_ms, last_cycle_result, config')
        .eq('id', 'main')
        .single();

      if (!data) return;

      const config = (data.config ?? {}) as Record<string, unknown>;
      const lastCycle = (data.last_cycle_result ?? {}) as Record<string, unknown>;

      // Consider "running" if heartbeat is within 2x the interval
      const interval = data.interval_ms ?? 30000;
      const heartbeat = data.last_heartbeat;
      const isStale = heartbeat
        ? Date.now() - new Date(heartbeat).getTime() > interval * 2
        : true;

      setInfo({
        isRunning: data.status === 'running' && !isStale,
        lastHeartbeat: heartbeat,
        source: (config.source as string) ?? null,
        intervalMs: interval,
        budgetPaused: !!config.budget_paused,
        checks: (lastCycle.checks as Record<string, unknown>) ?? null,
      });
    } catch {
      // Supabase not available yet — that's fine
    }
  }, []);

  useEffect(() => {
    poll();
    const id = window.setInterval(poll, 5000);
    return () => window.clearInterval(id);
  }, [poll]);

  return info;
}
