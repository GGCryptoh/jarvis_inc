/**
 * CEO Scheduler — Visibility-aware interval scheduler
 * ====================================================
 * Runs the CEO decision engine on a configurable interval.
 * Automatically pauses when the browser tab is hidden and
 * resumes when it becomes visible again.
 *
 * Writes heartbeat + last cycle result to the `scheduler_state`
 * table in Supabase after each tick.
 */

import { getSupabase } from './supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchedulerConfig {
  intervalMs: number;        // default 30000 (30s)
  pauseWhenHidden: boolean;  // default true
}

export interface SchedulerState {
  status: 'running' | 'paused' | 'stopped';
  lastHeartbeat: string | null;
  lastCycleResult: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: SchedulerConfig = {
  intervalMs: 30000,
  pauseWhenHidden: true,
};

// ---------------------------------------------------------------------------
// CEOScheduler class
// ---------------------------------------------------------------------------

class CEOScheduler {
  private intervalId: number | null = null;
  private config: SchedulerConfig;
  private onCycle: () => Promise<Record<string, unknown>>;
  private status: 'running' | 'paused' | 'stopped' = 'stopped';
  private lastHeartbeat: string | null = null;
  private lastCycleResult: Record<string, unknown> | null = null;
  private boundHandleVisibility: () => void;

  constructor(
    onCycle: () => Promise<Record<string, unknown>>,
    config?: Partial<SchedulerConfig>,
  ) {
    this.onCycle = onCycle;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.boundHandleVisibility = this.handleVisibility.bind(this);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  start(): void {
    if (this.status === 'running') return;

    this.status = 'running';
    this.scheduleInterval();

    if (this.config.pauseWhenHidden) {
      document.addEventListener('visibilitychange', this.boundHandleVisibility);
    }

    this.writeState().catch(() => { /* fire-and-forget */ });
  }

  stop(): void {
    this.clearInterval();
    this.status = 'stopped';

    if (this.config.pauseWhenHidden) {
      document.removeEventListener('visibilitychange', this.boundHandleVisibility);
    }

    this.writeState().catch(() => { /* fire-and-forget */ });
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.clearInterval();
    this.status = 'paused';
    this.writeState().catch(() => { /* fire-and-forget */ });
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.status = 'running';
    this.scheduleInterval();
    this.writeState().catch(() => { /* fire-and-forget */ });
  }

  getStatus(): 'running' | 'paused' | 'stopped' {
    return this.status;
  }

  getState(): SchedulerState {
    return {
      status: this.status,
      lastHeartbeat: this.lastHeartbeat,
      lastCycleResult: this.lastCycleResult,
    };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private scheduleInterval(): void {
    this.clearInterval();
    this.intervalId = window.setInterval(() => {
      this.tick().catch(() => { /* swallow — logged inside tick */ });
    }, this.config.intervalMs);
  }

  private clearInterval(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.status !== 'running') return;

    try {
      const result = await this.onCycle();
      this.lastHeartbeat = new Date().toISOString();
      this.lastCycleResult = result;
      await this.writeState();
    } catch (err) {
      console.error('[CEOScheduler] tick error:', err);
      this.lastHeartbeat = new Date().toISOString();
      this.lastCycleResult = { error: String(err) };
      await this.writeState().catch(() => { /* ignore */ });
    }
  }

  private handleVisibility(): void {
    if (!document.hidden) {
      // Tab became visible again — run a tick immediately to catch up
      if (this.status === 'running') {
        this.tick().catch(() => { /* swallow */ });
      }
    }
    // NOTE: We no longer stop the interval when hidden. The browser will
    // naturally throttle background tabs (~1/min in Chrome), which is fine
    // for an autonomous system that needs to keep running (forum checks,
    // heartbeats, marketplace online status, Telegram polling, etc.).
  }

  private async writeState(): Promise<void> {
    try {
      await getSupabase()
        .from('scheduler_state')
        .upsert({
          id: 'main',
          status: this.status,
          interval_ms: this.config.intervalMs,
          last_heartbeat: this.lastHeartbeat,
          last_cycle_result: this.lastCycleResult,
          config: this.config as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
    } catch (err) {
      console.error('[CEOScheduler] writeState error:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createScheduler(
  onCycle: () => Promise<Record<string, unknown>>,
  config?: Partial<SchedulerConfig>,
): CEOScheduler {
  return new CEOScheduler(onCycle, config);
}
