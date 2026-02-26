/**
 * Jarvis CEO Sidecar — Headless Node.js scheduler
 * =================================================
 * Runs the CEO decision engine on a loop, independent of any browser.
 * Connects to Supabase via REST API using environment variables.
 */

import { initSupabase, getSupabase } from '../lib/supabase';
import { evaluateCycle } from '../lib/ceoDecisionEngine';
import { startTelegramPolling, stopTelegramPolling } from './telegram';
import { executeSkill } from '../lib/skillExecutor';

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
  const { getMarketplaceStatus } = await import('../lib/marketplaceClient');
  const mktStatus = getMarketplaceStatus();
  marketplaceReady = !!(mktStatus.registered && mktStatus.instanceId);
  console.log(`[CEO Sidecar] Marketplace signing: ${signingReady ? 'READY' : 'NOT AVAILABLE (no key in vault)'}, registered: ${marketplaceReady ? mktStatus.instanceId : 'NO (will retry)'}`);
}

// ---------------------------------------------------------------------------
// Scheduler loop
// ---------------------------------------------------------------------------

let marketplaceReady = false;

async function tick(): Promise<void> {
  try {
    // Retry marketplace signing init if registration wasn't available at boot
    if (!marketplaceReady) {
      const { initSidecarSigning, getMarketplaceStatus } = await import('../lib/marketplaceClient');
      await initSidecarSigning();
      const status = getMarketplaceStatus();
      if (status.registered && status.instanceId) {
        marketplaceReady = true;
        console.log(`[CEO Sidecar] Marketplace signing now READY (instance: ${status.instanceId})`);
      }
    }

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

// ---------------------------------------------------------------------------
// Pending task watcher — picks up browser-dispatched tasks that need sidecar
// execution (e.g. forum skills that require marketplace signing keys)
// ---------------------------------------------------------------------------

const SIDECAR_SKILLS = new Set(['forum', 'marketplace']);
// Bare command names the CEO may emit without the skill prefix
const BARE_COMMAND_TO_SKILL: Record<string, string> = {
  create_post: 'forum', reply: 'forum', vote: 'forum', poll_vote: 'forum',
  introduce: 'forum', browse_channels: 'forum', browse_posts: 'forum', read_thread: 'forum',
  register: 'marketplace', submit_feature: 'marketplace', view_profile: 'marketplace',
  stats: 'marketplace', update_profile: 'marketplace',
};
const TASK_POLL_MS = 5_000;
let taskWatcherRunning = false;

async function processPendingTasks(): Promise<void> {
  if (taskWatcherRunning) return;
  taskWatcherRunning = true;
  try {
    const sb = getSupabase();
    const { data: tasks, error: queryErr } = await sb
      .from('task_executions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(10);

    if (queryErr) {
      console.error('[TaskWatcher] Query error:', queryErr.message);
      taskWatcherRunning = false;
      return;
    }
    if (!tasks || tasks.length === 0) { taskWatcherRunning = false; return; }
    console.log(`[TaskWatcher] Found ${tasks.length} pending task(s): ${tasks.map(t => `${t.skill_id}:${t.command_name}`).join(', ')}`);

    for (const task of tasks) {
      // Normalize bare command names (e.g. skill_id="create_post" → "forum")
      let skillId = task.skill_id;
      let commandName = task.command_name;
      if (BARE_COMMAND_TO_SKILL[skillId]) {
        commandName = skillId;
        skillId = BARE_COMMAND_TO_SKILL[skillId];
      }
      if (!SIDECAR_SKILLS.has(skillId)) continue;

      // Claim the task
      const { error: claimErr } = await sb
        .from('task_executions')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', task.id)
        .eq('status', 'pending'); // optimistic lock

      if (claimErr) continue;

      console.log(`[TaskWatcher] Executing ${skillId}:${commandName} (${task.id})`);

      try {
        const result = await executeSkill(
          skillId,
          commandName,
          task.params as Record<string, unknown> ?? {},
          { missionId: task.mission_id },
        );

        await sb.from('task_executions').update({
          status: result.success ? 'completed' : 'failed',
          result: {
            output: result.output || result.error || '',
            summary: ((result.output || result.error || '') as string).slice(0, 200),
          },
          completed_at: new Date().toISOString(),
        }).eq('id', task.id);

        console.log(`[TaskWatcher] ${result.success ? 'OK' : 'FAIL'}: ${skillId}:${commandName} — ${(result.output || result.error || '').slice(0, 80)}`);
      } catch (err) {
        await sb.from('task_executions').update({
          status: 'failed',
          result: { output: '', error: String(err) },
          completed_at: new Date().toISOString(),
        }).eq('id', task.id);
        console.error(`[TaskWatcher] Error executing ${task.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[TaskWatcher] Poll error:', err);
  }
  taskWatcherRunning = false;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[CEO Sidecar] Starting...');
  console.log(`[CEO Sidecar] Interval: ${INTERVAL_MS}ms`);

  await boot();

  // Start Telegram polling (fire-and-forget — runs its own loop)
  startTelegramPolling().catch((err) => {
    console.error('[CEO Sidecar] Telegram polling failed:', err);
  });

  // Start pending task watcher (picks up browser-dispatched forum/marketplace tasks)
  setInterval(() => {
    processPendingTasks().catch((err) => console.error('[TaskWatcher] Unhandled error:', err));
  }, TASK_POLL_MS);
  console.log(`[CEO Sidecar] Task watcher started (poll every ${TASK_POLL_MS}ms)`);

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
