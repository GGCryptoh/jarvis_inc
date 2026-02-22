/**
 * Jarvis CEO Sidecar — Headless Node.js scheduler
 * =================================================
 * Runs the CEO decision engine on a loop, independent of any browser.
 * Connects to Supabase via REST API using environment variables.
 */

import { initSupabase, getSupabase } from '../lib/supabase';
import { evaluateCycle } from '../lib/ceoDecisionEngine';
import { startTelegramPolling, stopTelegramPolling } from './telegram';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const INTERVAL_MS = parseInt(process.env.CEO_INTERVAL_MS ?? '30000', 10);
const HEARTBEAT_KEY = 'main';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const key = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

  if (!url || !key) {
    console.error('[CEO Sidecar] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    process.exit(1);
  }

  initSupabase(url, key);
  console.log('[CEO Sidecar] Supabase connected');

  // Verify DB connectivity
  const { error } = await getSupabase().from('settings').select('key').limit(1);
  if (error) {
    console.error('[CEO Sidecar] DB connection failed:', error.message);
    process.exit(1);
  }
  console.log('[CEO Sidecar] DB verified');

  // Initialize marketplace signing (loads key from vault)
  const { initSidecarSigning } = await import('../lib/marketplaceClient');
  const signingReady = await initSidecarSigning();
  console.log(`[CEO Sidecar] Marketplace signing: ${signingReady ? 'READY' : 'NOT AVAILABLE (no key in vault)'}`);
}

// ---------------------------------------------------------------------------
// Scheduler loop
// ---------------------------------------------------------------------------

async function tick(): Promise<void> {
  try {
    const result = await evaluateCycle();
    const now = new Date().toISOString();

    await getSupabase()
      .from('scheduler_state')
      .upsert({
        id: HEARTBEAT_KEY,
        status: 'running',
        interval_ms: INTERVAL_MS,
        last_heartbeat: now,
        last_cycle_result: result,
        config: { source: 'sidecar' },
        updated_at: now,
      }, { onConflict: 'id' });

    const actionCount = result.actions?.length ?? 0;
    if (actionCount > 0) {
      console.log(`[CEO Sidecar] Cycle: ${actionCount} action(s) produced`);
    }
  } catch (err) {
    console.error('[CEO Sidecar] Tick error:', err);
  }
}

async function main(): Promise<void> {
  console.log('[CEO Sidecar] Starting...');
  console.log(`[CEO Sidecar] Interval: ${INTERVAL_MS}ms`);

  await boot();

  // Start Telegram polling (fire-and-forget — runs its own loop)
  startTelegramPolling().catch((err) => {
    console.error('[CEO Sidecar] Telegram polling failed:', err);
  });

  // Run first tick immediately
  await tick();

  // Schedule recurring ticks
  setInterval(() => {
    tick().catch((err) => console.error('[CEO Sidecar] Unhandled tick error:', err));
  }, INTERVAL_MS);

  console.log('[CEO Sidecar] Running. Press Ctrl+C to stop.');
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[CEO Sidecar] SIGTERM received, shutting down');
  stopTelegramPolling();
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('[CEO Sidecar] SIGINT received, shutting down');
  stopTelegramPolling();
  process.exit(0);
});

main().catch((err) => {
  console.error('[CEO Sidecar] Fatal:', err);
  process.exit(1);
});
