/**
 * useCEOScheduler — React hook wrapping the CEO scheduler
 * =========================================================
 * Creates the scheduler on mount with `evaluateCycle` as the callback.
 * Auto-starts immediately (the CEO is always watching).
 * Stops cleanly on unmount.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createScheduler } from '../lib/ceoScheduler';
import { evaluateCycle } from '../lib/ceoDecisionEngine';

export function useCEOScheduler(): {
  isRunning: boolean;
  lastHeartbeat: string | null;
  start: () => void;
  stop: () => void;
} {
  const [isRunning, setIsRunning] = useState(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<string | null>(null);

  // Stable ref for the scheduler instance — survives re-renders
  const schedulerRef = useRef<ReturnType<typeof createScheduler> | null>(null);

  // Heartbeat polling interval ref
  const heartbeatIntervalRef = useRef<number | null>(null);

  const start = useCallback(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;
    scheduler.start();
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;
    scheduler.stop();
    setIsRunning(false);
  }, []);

  useEffect(() => {
    // Wrap evaluateCycle to return the CycleResult as a generic Record
    const onCycle = async (): Promise<Record<string, unknown>> => {
      const result = await evaluateCycle();
      return result as unknown as Record<string, unknown>;
    };

    const scheduler = createScheduler(onCycle);
    schedulerRef.current = scheduler;

    // Auto-start
    scheduler.start();
    setIsRunning(true);

    // Poll scheduler state for heartbeat updates (every 5s)
    heartbeatIntervalRef.current = window.setInterval(() => {
      const state = scheduler.getState();
      setLastHeartbeat(state.lastHeartbeat);
      setIsRunning(state.status === 'running');
    }, 5000);

    return () => {
      scheduler.stop();
      setIsRunning(false);
      if (heartbeatIntervalRef.current !== null) {
        window.clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      schedulerRef.current = null;
    };
  }, []);

  return { isRunning, lastHeartbeat, start, stop };
}
