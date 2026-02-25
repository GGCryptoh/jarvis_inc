/**
 * CEO Decision Engine — Rule-based MVP
 * ======================================
 * Evaluates the current state of the org each scheduler tick and
 * produces a list of actions for the CEO to execute.
 *
 * This is a heuristic-only engine — no LLM calls.  The upgrade path
 * is to replace the heuristic checks with LLM-powered evaluation.
 */

import { getSupabase } from './supabase';
import {
  loadAgents,
  loadMissions,
  loadSkills,
  loadApprovals,
  loadCEO,
  getDueSkillSchedules,
  updateSkillScheduleRun,
  getVaultEntryByService,
  getSetting,
  setSetting,
  type AgentRow,
  type MissionRow,
  type SkillRow,
  type ApprovalRow,
  type CEORow,
  logAudit,
  getSkillOptions,
} from './database';
import { seedSkillsFromRepo } from './skillResolver';
import { synthesizeMissionSummary } from './taskDispatcher';
import { consolidateDailyMemories } from './memory';
import { isCronDue } from './cronParser';
import { getCurrentMonthSpend } from './llmUsage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CEOAction {
  id: string;
  action_type: 'hire_agent' | 'assign_mission' | 'request_approval' | 'send_message' | 'enable_skill' | 'needs_attention';
  payload: Record<string, unknown>;
  priority: number;  // 1-10 (1 = highest)
}

export interface CycleResult {
  timestamp: string;
  actions: CEOAction[];
  checks: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActionId(): string {
  return `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

// Track last skill sync time to throttle GitHub fetches (once per hour)
let lastSkillSyncTime = 0;

// Track last memory consolidation date (once per day)
let lastConsolidationDate = '';

// Track last marketplace profile refresh date (once per day)
let lastProfileRefreshDate = '';

// Track last peer check time (throttled: every 4 hours, same cadence as forum)
let lastPeerCheckTime = 0;
const PEER_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// Track last version check (every 6 hours)
let lastVersionCheckTime = 0;
const VERSION_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Compute the next run timestamp for a skill schedule.
 */
function computeNextRun(
  frequency: 'hourly' | 'every_4h' | 'daily' | 'weekly' | 'monthly',
  runAtTime: string,      // "HH:MM"
  runOnDay: number | null, // 0-6 for weekly, 1-31 for monthly
  fromDate: Date = new Date(),
): Date {
  const next = new Date(fromDate);

  if (frequency === 'hourly') {
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next;
  }

  if (frequency === 'every_4h') {
    const currentHour = next.getHours();
    const nextSlot = Math.ceil((currentHour + 1) / 4) * 4;
    next.setHours(nextSlot, 0, 0, 0);
    if (next <= fromDate) next.setHours(next.getHours() + 4);
    return next;
  }

  const [hours, minutes] = runAtTime.split(':').map(Number);
  next.setHours(hours, minutes, 0, 0);

  if (frequency === 'daily') {
    // If today's time has passed, schedule for tomorrow
    if (next <= fromDate) {
      next.setDate(next.getDate() + 1);
    }
  } else if (frequency === 'weekly') {
    const targetDay = runOnDay ?? 1; // Default to Monday
    const currentDay = next.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil < 0) daysUntil += 7;
    if (daysUntil === 0 && next <= fromDate) daysUntil = 7;
    next.setDate(next.getDate() + daysUntil);
  } else if (frequency === 'monthly') {
    const targetDate = runOnDay ?? 1; // Default to 1st
    next.setDate(targetDate);
    // If this month's date has passed, go to next month
    if (next <= fromDate) {
      next.setMonth(next.getMonth() + 1);
      next.setDate(targetDate);
    }
  }

  return next;
}

// ---------------------------------------------------------------------------
// Heuristic checks
// ---------------------------------------------------------------------------

function checkUnassignedMissions(
  missions: MissionRow[],
  agents: AgentRow[],
  activeMissionAssignees: Set<string>,
): CEOAction[] {
  const actions: CEOAction[] = [];

  const unassigned = missions.filter(
    (m) => (m.status === 'active' || m.status === 'in_progress') && !m.assignee,
  );
  if (unassigned.length === 0) return actions;

  // Find agents that don't currently have an active mission
  const idleAgents = agents.filter((a) => !activeMissionAssignees.has(a.id));
  if (idleAgents.length === 0) return actions;

  // Produce one assign_mission action per pairable (mission, agent)
  const pairCount = Math.min(unassigned.length, idleAgents.length);
  for (let i = 0; i < pairCount; i++) {
    actions.push({
      id: makeActionId(),
      action_type: 'assign_mission',
      payload: {
        mission_id: unassigned[i].id,
        mission_title: unassigned[i].title,
        agent_id: idleAgents[i].id,
        agent_name: idleAgents[i].name,
      },
      priority: 3,
    });
  }

  return actions;
}

function checkIdleAgents(
  _agents: AgentRow[],
  _activeMissionAssignees: Set<string>,
): CEOAction[] {
  // Suppressed — the CEO handles most work directly (forum, skills, schedules).
  // Agents are an advanced feature for parallel specialized workers.
  // No need to nag about idle agents every cycle.
  return [];
}

function checkStaleApprovals(approvals: ApprovalRow[]): CEOAction[] {
  const now = Date.now();
  const stale = approvals.filter((a) => {
    if (a.status !== 'pending') return false;
    const created = new Date(a.created_at).getTime();
    return now - created > TWENTY_FOUR_HOURS_MS;
  });

  if (stale.length === 0) return [];

  return [{
    id: makeActionId(),
    action_type: 'send_message',
    payload: {
      topic: 'stale_approvals',
      message: `${stale.length} approval(s) have been pending for over 24 hours. Please review them.`,
      approval_ids: stale.map((a) => a.id),
    },
    priority: 4,
  }];
}

// Smart hire evaluation — LLM-based, throttled to every 7 days
let lastHireEvalTime = 0;
const HIRE_EVAL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function checkSmartHire(
  agents: AgentRow[],
  missions: MissionRow[],
  skills: SkillRow[],
): Promise<CEOAction[]> {
  const now = Date.now();
  if (now - lastHireEvalTime < HIRE_EVAL_INTERVAL_MS) return [];
  lastHireEvalTime = now;

  // Skip if no missions or already 5+ agents
  const activeMissions = missions.filter(m => m.status === 'active' || m.status === 'in_progress' || m.status === 'backlog');
  if (activeMissions.length === 0 || agents.length >= 5) return [];

  try {
    // Get an API key — prefer Anthropic, fall back to OpenAI
    const anthropicKey = await getVaultEntryByService('Anthropic');
    const openaiKey = !anthropicKey ? await getVaultEntryByService('OpenAI') : null;
    const vaultEntry = anthropicKey ?? openaiKey;
    if (!vaultEntry) return [];

    const enabledSkills = skills.filter(s => s.enabled);
    const agentSummary = agents.length === 0
      ? 'No agents hired yet (CEO handles all work).'
      : agents.map(a => `- ${a.name}: ${a.role} (model: ${a.model})`).join('\n');
    const missionSummary = activeMissions.slice(0, 10)
      .map(m => `- "${m.title}" [${m.status}] assigned to: ${m.assignee ?? 'unassigned'}`)
      .join('\n');
    const skillSummary = enabledSkills.slice(0, 20)
      .map(s => s.id).join(', ');

    const prompt = `You are the strategic hiring advisor for a small AI company. Evaluate whether a new agent should be hired.

CURRENT STATE:
Agents (${agents.length}):
${agentSummary}

Active missions (${activeMissions.length}):
${missionSummary}

Enabled skills: ${skillSummary || 'none'}

RULES:
- Only recommend hiring if there's a clear workload gap (unassigned missions, missions that need specialized skills)
- Each agent costs money to run, so only hire when the benefit clearly outweighs the cost
- If the CEO can handle the current workload alone, say hire: false
- Keep the agent name short (max 12 chars, all caps)
- Pick an appropriate model: "Claude Haiku 4.5" for simple tasks, "Claude Sonnet 4.5" for moderate, "Claude Opus 4.6" for complex
- Assign relevant skills from the enabled skills list
- Write a focused system_prompt and user_prompt that defines the agent's specialization

Respond with ONLY a JSON object (no markdown, no explanation):
{"hire":true/false,"name":"AGENTNAME","role":"Agent Role","model":"Claude Haiku 4.5","system_prompt":"...","user_prompt":"...","skills":["skill-id"],"color":"#50fa7b","reasoning":"One sentence explaining why"}

If hire is false, only include: {"hire":false,"reasoning":"..."}`;

    const { MODEL_API_IDS } = await import('./models');
    let provider: { stream: (msgs: unknown[], key: string, model: string, cb: unknown) => unknown };
    let modelId: string;

    if (anthropicKey) {
      const { anthropicProvider } = await import('./llm/providers/anthropic');
      provider = anthropicProvider as unknown as typeof provider;
      modelId = MODEL_API_IDS['Claude Haiku 4.5'];
    } else {
      const { openaiProvider } = await import('./llm/providers/openai');
      provider = openaiProvider as unknown as typeof provider;
      modelId = MODEL_API_IDS['o4-mini'] || 'o4-mini';
    }

    const llmResult = await new Promise<string | null>((resolve) => {
      let fullText = '';
      provider.stream(
        [{ role: 'user', content: prompt }],
        vaultEntry.key_value,
        modelId,
        {
          onToken: (token: string) => { fullText += token; },
          onDone: (text: string) => { resolve(text || fullText); },
          onError: (err: Error) => {
            console.warn('[checkSmartHire] LLM eval failed:', err);
            resolve(null);
          },
        },
      );
    });

    if (!llmResult) return [];

    const jsonMatch = llmResult.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.hire) {
      logAudit('CEO', 'SMART_HIRE_EVAL', `No hire recommended: ${parsed.reasoning ?? 'N/A'}`, 'info');
      return [];
    }

    logAudit('CEO', 'SMART_HIRE_RECOMMEND', `Recommending hire: ${parsed.name} — ${parsed.reasoning}`, 'info');

    return [{
      id: makeActionId(),
      action_type: 'request_approval',
      payload: {
        topic: 'smart_hire_recommendation',
        message: `I recommend hiring **${parsed.name}** as ${parsed.role}. ${parsed.reasoning}`,
        hire_payload: {
          name: parsed.name,
          role: parsed.role,
          model: parsed.model ?? 'Claude Haiku 4.5',
          system_prompt: parsed.system_prompt ?? '',
          user_prompt: parsed.user_prompt ?? '',
          skills: Array.isArray(parsed.skills) ? parsed.skills : [],
          color: parsed.color ?? '#50fa7b',
        },
      },
      priority: 5,
    }];
  } catch (err) {
    console.warn('[checkSmartHire] Evaluation failed:', err);
    return [];
  }
}

function checkSkillsGap(
  missions: MissionRow[],
  skills: SkillRow[],
): CEOAction[] {
  if (missions.length === 0) return [];

  const enabledSkills = skills.filter((s) => s.enabled);
  if (enabledSkills.length > 0) return [];

  return [{
    id: makeActionId(),
    action_type: 'send_message',
    payload: {
      topic: 'skills_gap',
      message: `There are ${missions.length} mission(s) but no skills are enabled. Consider enabling skills so agents can execute their work.`,
    },
    priority: 5,
  }];
}

// ---------------------------------------------------------------------------
// Stuck task detection — auto-fail tasks stuck for > 5 minutes
// ---------------------------------------------------------------------------

const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

async function checkStuckTasks(): Promise<CEOAction[]> {
  const actions: CEOAction[] = [];

  try {
    const sb = getSupabase();
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();

    // Find tasks that have been pending/running too long
    const { data: stuckTasks } = await sb
      .from('task_executions')
      .select('id, mission_id, skill_id, command_name, params, model, status, agent_id, created_at, context')
      .in('status', ['pending', 'running'])
      .lt('created_at', cutoff);

    if (!stuckTasks || stuckTasks.length === 0) return actions;

    // Check for orphaned tasks (assigned to a fired agent) — reassign to CEO and re-dispatch
    const agents = await loadAgents();
    const agentIds = new Set(agents.map(a => a.id));
    agentIds.add('ceo'); // CEO always exists

    for (const task of stuckTasks) {
      if (task.agent_id && !agentIds.has(task.agent_id)) {
        // Agent no longer exists — reassign to CEO and reset to pending for re-dispatch
        await sb.from('task_executions').update({
          agent_id: 'ceo',
          status: 'pending',
          created_at: new Date().toISOString(), // reset the clock
        }).eq('id', task.id);

        // Also update mission assignee
        await sb.from('missions').update({ assignee: 'CEO' }).eq('id', task.mission_id);

        logAudit('CEO', 'TASK_REASSIGNED', `Task ${task.id} reassigned from fired agent "${task.agent_id}" to CEO`, 'info');

        // Re-dispatch via autoDispatchMission
        import('./taskDispatcher').then(({ autoDispatchMission }) => {
          autoDispatchMission(task.mission_id)
            .catch(err => console.warn('[checkStuckTasks] Re-dispatch after reassign failed:', err));
        });

        actions.push({
          id: makeActionId(),
          action_type: 'send_message',
          payload: { topic: `reassign_${task.id}`, message: `Reassigned stuck task from fired agent to CEO` },
          priority: 3,
        });
        continue; // don't auto-fail this one, give it another chance
      }
    }

    // Re-query to get only tasks that are still stuck (not the ones we just reassigned)
    const { data: remainingStuck } = await sb
      .from('task_executions')
      .select('id, mission_id, skill_id, status, created_at')
      .in('status', ['pending', 'running'])
      .lt('created_at', cutoff);

    if (!remainingStuck || remainingStuck.length === 0) return actions;

    // Group by mission
    const byMission = new Map<string, typeof remainingStuck>();
    for (const task of remainingStuck) {
      const list = byMission.get(task.mission_id) ?? [];
      list.push(task);
      byMission.set(task.mission_id, list);
    }

    for (const [missionId, tasks] of byMission) {
      // Mark each stuck task as failed
      for (const task of tasks) {
        await sb.from('task_executions').update({
          status: 'failed',
          result: { error: `Task stuck in ${task.status} for over 5 minutes. Auto-failed by CEO decision engine.` },
          completed_at: new Date().toISOString(),
        }).eq('id', task.id);
        logAudit('CEO', 'TASK_AUTO_FAILED', `Task ${task.id} stuck in "${task.status}" >5min, auto-failed`, 'warning');
      }

      // Check if all siblings are now terminal → move mission to review
      const { data: siblings } = await sb
        .from('task_executions')
        .select('status')
        .eq('mission_id', missionId);

      const allTerminal = siblings?.every(t => t.status === 'completed' || t.status === 'failed');
      if (allTerminal) {
        await sb.from('missions').update({ status: 'review' }).eq('id', missionId);

        // Get mission title for the message
        const { data: mission } = await sb.from('missions').select('title').eq('id', missionId).single();
        const title = mission?.title ?? missionId;
        const completedCount = siblings?.filter(t => t.status === 'completed').length ?? 0;

        // Synthesize unified summary for multi-task missions
        if (completedCount >= 2) {
          synthesizeMissionSummary(missionId, title).catch(err =>
            console.warn('[CEODecisionEngine] Summary synthesis failed:', err),
          );
        }
        const failedCount = siblings?.filter(t => t.status === 'failed').length ?? 0;

        // Post to chat
        const { data: convos } = await sb
          .from('conversations')
          .select('id')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1);

        if (convos?.[0]) {
          await sb.from('chat_messages').insert({
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            conversation_id: convos[0].id,
            sender: 'ceo',
            text: `Mission "${title}" had ${failedCount} stuck task(s) that I auto-cancelled. ${completedCount} task(s) completed successfully. Full results in Collateral. Ready for your review.`,
            metadata: {
              type: 'mission_complete',
              mission_id: missionId,
              actions: [
                { id: 'approve', label: 'LOOKS GOOD', action: 'approve_mission' },
                { id: 'review', label: 'REVIEW MISSION', action: 'navigate', target: `/missions/${missionId}` },
                { id: 'collateral', label: 'VIEW COLLATERAL', action: 'navigate', target: '/collateral' },
              ],
            },
          });
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('chat-messages-changed'));
          }
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('missions-changed'));
          window.dispatchEvent(new Event('task-executions-changed'));
        }
      }
    }
  } catch (err) {
    console.warn('[CEODecisionEngine] Stuck task check failed:', err);
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Budget management — pause + approval when spend exceeds budget
// ---------------------------------------------------------------------------

/**
 * Budget states:
 *   0-100%   → normal operations
 *   100-110% → "grace zone" — CEO can still do housekeeping (explain situation,
 *              ask for extension) but new task dispatch is paused. Creates approval.
 *   110%+    → hard stop — everything paused, no new LLM calls
 */
const BUDGET_GRACE_RATIO = 1.10; // 10% grace above budget

async function checkBudget(): Promise<{ paused: boolean; hardStop: boolean; actions: CEOAction[] }> {
  const actions: CEOAction[] = [];

  try {
    const { data: budgetRow } = await getSupabase()
      .from('settings')
      .select('value')
      .eq('key', 'monthly_budget')
      .single();

    if (!budgetRow?.value) return { paused: false, hardStop: false, actions };

    const budget = parseFloat(budgetRow.value);
    if (isNaN(budget) || budget <= 0) return { paused: false, hardStop: false, actions };

    const spend = await getCurrentMonthSpend();
    const hardCap = budget * BUDGET_GRACE_RATIO;
    const overBudget = spend.total >= budget;
    const overHardCap = spend.total >= hardCap;

    if (overBudget) {
      const { data: state } = await getSupabase()
        .from('scheduler_state')
        .select('config')
        .eq('id', 'main')
        .single();

      const config = (state?.config ?? {}) as Record<string, unknown>;
      const alreadyPaused = !!config.budget_paused;

      if (!alreadyPaused) {
        const pct = Math.round((spend.total / budget) * 100);
        logAudit('CEO', 'BUDGET_THRESHOLD', `Budget ${pct}% reached ($${spend.total.toFixed(2)} / $${budget.toFixed(2)})`, 'warning');

        // First time hitting budget — pause + alert
        await getSupabase()
          .from('scheduler_state')
          .update({ config: { ...config, budget_paused: true, budget_hard_stop: overHardCap } })
          .eq('id', 'main');

        // Create single budget_override approval (upsert = no duplicates)
        const approvalId = `approval-budget-${new Date().toISOString().slice(0, 7)}`;
        await getSupabase().from('approvals').upsert({
          id: approvalId,
          type: 'budget_override',
          title: 'Monthly budget exceeded',
          description: `Spend $${spend.total.toFixed(2)} has reached the $${budget.toFixed(2)} monthly budget. Approve to resume operations or adjust the budget.`,
          status: 'pending',
          metadata: { spend: spend.total, budget, hard_cap: hardCap },
        }, { onConflict: 'id' });

        // CEO explains the situation via chat (uses the 10% grace)
        const { data: convos } = await getSupabase()
          .from('conversations')
          .select('id')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1);

        if (convos?.[0]) {
          const graceMsg = overHardCap
            ? `We've burned through the 10% grace buffer too — hard stop at $${hardCap.toFixed(2)}. Everything is on hold.`
            : `I've got about $${(hardCap - spend.total).toFixed(2)} of grace budget left for housekeeping before hard stop at $${hardCap.toFixed(2)}.`;
          await getSupabase().from('chat_messages').insert({
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            conversation_id: convos[0].id,
            sender: 'ceo',
            text: `Hey — we've hit our monthly budget of $${budget.toFixed(2)} (current spend: $${spend.total.toFixed(2)}). All new task dispatch is paused and scheduled missions are on hold. ${graceMsg}\n\nI need you to either approve additional spend or adjust the budget in Financials to resume.`,
            metadata: {
              type: 'budget_alert',
              actions: [
                { id: 'approve', label: 'APPROVE OVERSPEND', action: 'approve_budget' },
                { id: 'financials', label: 'ADJUST BUDGET', action: 'navigate', target: '/financials' },
              ],
            },
          });
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('chat-messages-changed'));
          }
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('approvals-changed'));
        }

        actions.push({
          id: makeActionId(),
          action_type: 'send_message',
          payload: {
            topic: 'budget_exceeded',
            message: `Monthly budget exceeded: $${spend.total.toFixed(2)} / $${budget.toFixed(2)} (hard cap: $${hardCap.toFixed(2)})`,
          },
          priority: 1,
        });
      } else {
        // Already paused — update hard_stop flag if we've crossed into hard cap
        if (overHardCap && !config.budget_hard_stop) {
          await getSupabase()
            .from('scheduler_state')
            .update({ config: { ...config, budget_hard_stop: true } })
            .eq('id', 'main');
        }
      }

      return { paused: true, hardStop: overHardCap, actions };
    }

    // Under budget — unpause if previously paused (budget raised or new month)
    const { data: state } = await getSupabase()
      .from('scheduler_state')
      .select('config')
      .eq('id', 'main')
      .single();

    const config = (state?.config ?? {}) as Record<string, unknown>;
    if (config.budget_paused) {
      await getSupabase()
        .from('scheduler_state')
        .update({ config: { ...config, budget_paused: false, budget_hard_stop: false } })
        .eq('id', 'main');
    }
  } catch (err) {
    console.warn('[CEODecisionEngine] Budget check failed:', err);
  }

  return { paused: false, hardStop: false, actions };
}

// ---------------------------------------------------------------------------
// Recurring missions — cron-based mission spawning
// ---------------------------------------------------------------------------

/**
 * Spawn a child mission from a recurring template.
 * Creates the child mission, updates last_recurred_at, posts to chat,
 * and — critically — creates a task_execution and dispatches it if a
 * task_template is available on the template.
 *
 * Returns the new child mission ID, or null on failure.
 */
export async function spawnRecurringChild(
  templateMission: MissionRow,
  budgetPaused = false,
): Promise<string | null> {
  const sb = getSupabase();
  const now = new Date();
  const newId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const newStatus = budgetPaused ? 'on_hold' : 'in_progress';

  const { error: insertErr } = await sb.from('missions').insert({
    id: newId,
    title: `${templateMission.title} (${now.toLocaleDateString()})`,
    status: newStatus,
    assignee: templateMission.assignee ?? null,
    priority: templateMission.priority ?? 'medium',
    created_by: `recurring:${templateMission.id}`,
  });

  if (insertErr) {
    console.error('[spawnRecurringChild] Failed to insert child mission:', insertErr);
    logAudit('CEO', 'RECURRING_SPAWN_FAILED', `Failed to spawn child for "${templateMission.title}": ${insertErr.message}`, 'error');
    return null;
  }

  // Increment run_count and update last_recurred_at on the template mission
  const newRunCount = (templateMission.run_count ?? 0) + 1;
  await sb
    .from('missions')
    .update({ last_recurred_at: now.toISOString(), run_count: newRunCount })
    .eq('id', templateMission.id);

  const runLabel = templateMission.max_runs != null ? ` (run ${newRunCount} of ${templateMission.max_runs})` : '';
  logAudit('CEO', 'MISSION_RECURRING_FIRE', `Recurring mission "${templateMission.title}" executed${runLabel}, next run determined by cron: ${templateMission.recurring}`, 'info');

  // Post to chat
  const { data: convos } = await sb
    .from('conversations')
    .select('id')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  if (convos?.[0]) {
    const modeMsg = budgetPaused
      ? 'Queued as ON HOLD — waiting for budget approval.'
      : `Dispatching to ${templateMission.assignee ?? 'next available agent'} now.`;
    const runMsg = templateMission.max_runs != null ? ` Run ${newRunCount} of ${templateMission.max_runs}.` : '';
    await sb.from('chat_messages').insert({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      conversation_id: convos[0].id,
      sender: 'ceo',
      text: `Recurring mission "${templateMission.title}" fired.${runMsg} ${modeMsg}`,
      metadata: { type: 'recurring_mission', source_mission_id: templateMission.id, new_mission_id: newId, on_hold: budgetPaused, run_count: newRunCount, max_runs: templateMission.max_runs },
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('chat-messages-changed'));
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('missions-changed'));
  }

  // Auto-stop: if max_runs is set and we've reached the limit, complete the template
  if (templateMission.max_runs != null && newRunCount >= templateMission.max_runs) {
    await sb.from('missions').update({ status: 'done' }).eq('id', templateMission.id);
    logAudit('CEO', 'RECURRING_COMPLETED', `Recurring mission "${templateMission.title}" completed all ${templateMission.max_runs} runs`, 'info');

    if (convos?.[0]) {
      await sb.from('chat_messages').insert({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        conversation_id: convos[0].id,
        sender: 'ceo',
        text: `Recurring mission "${templateMission.title}" has completed all ${templateMission.max_runs} scheduled runs. Template moved to DONE.`,
        metadata: { type: 'recurring_completed', mission_id: templateMission.id, total_runs: templateMission.max_runs },
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('chat-messages-changed'));
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('missions-changed'));
    }
  }

  // Dispatch task execution if we have a saved task_template, otherwise auto-dispatch
  if (!budgetPaused && templateMission.task_template) {
    const tmpl = templateMission.task_template as { skill_id: string; command: string; params: Record<string, unknown>; model: string };
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    await sb.from('task_executions').insert({
      id: taskId,
      mission_id: newId,
      agent_id: templateMission.assignee ?? 'ceo',
      skill_id: tmpl.skill_id,
      command_name: tmpl.command,
      params: tmpl.params,
      model: tmpl.model,
      status: 'pending',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('task-executions-changed'));
    }

    // Fire off execution — dynamic import to avoid circular dependency
    import('./taskDispatcher').then(({ executeTask }) => {
      executeTask(taskId, newId, tmpl.skill_id, tmpl.command, tmpl.params, tmpl.model)
        .catch(err => console.error('[spawnRecurringChild] Task execution failed:', err));
    });
  } else if (!budgetPaused) {
    // No template — auto-dispatch using skill recommender
    import('./taskDispatcher').then(({ autoDispatchMission }) => {
      autoDispatchMission(newId)
        .catch(err => console.error('[spawnRecurringChild] Auto-dispatch failed:', err));
    });
  }

  return newId;
}

async function checkRecurringMissions(budgetPaused: boolean): Promise<CEOAction[]> {
  const actions: CEOAction[] = [];

  try {
    const { data: recurring } = await getSupabase()
      .from('missions')
      .select('*')
      .eq('status', 'scheduled')
      .not('recurring', 'is', null)
      .neq('recurring', '');

    if (!recurring || recurring.length === 0) return actions;

    const now = new Date();

    for (const mission of recurring) {
      const lastRun = mission.last_recurred_at ? new Date(mission.last_recurred_at) : null;
      if (!isCronDue(mission.recurring, lastRun, now)) continue;

      const mode = (mission as MissionRow).recurring_mode ?? 'auto';
      const newId = await spawnRecurringChild(mission as MissionRow, budgetPaused);

      if (!newId) continue;

      actions.push({
        id: makeActionId(),
        action_type: 'assign_mission',
        payload: {
          topic: `recurring_${mission.id}`,
          mission_id: newId,
          source_mission_id: mission.id,
          mode,
          on_hold: budgetPaused,
        },
        priority: 4,
      });
    }
  } catch (err) {
    console.warn('[CEODecisionEngine] Recurring mission check failed:', err);
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Scheduled missions — activate when scheduled_for time arrives
// ---------------------------------------------------------------------------

async function checkScheduledMissions(): Promise<CEOAction[]> {
  const actions: CEOAction[] = [];

  try {
    const now = new Date().toISOString();
    // Exclude recurring templates — they're handled by checkRecurringMissions
    const { data: due } = await getSupabase()
      .from('missions')
      .select('*')
      .eq('status', 'scheduled')
      .not('scheduled_for', 'is', null)
      .lte('scheduled_for', now)
      .is('recurring', null);

    if (!due || due.length === 0) return actions;

    for (const mission of due) {
      // Activate the mission
      await getSupabase()
        .from('missions')
        .update({ status: 'in_progress', scheduled_for: null })
        .eq('id', mission.id);

      logAudit('CEO', 'MISSION_SCHEDULED_FIRE', `Mission "${mission.title}" fired on schedule`, 'info');

      // Post to chat
      const { data: convos } = await getSupabase()
        .from('conversations')
        .select('id')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1);

      if (convos?.[0]) {
        await getSupabase().from('chat_messages').insert({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: convos[0].id,
          sender: 'ceo',
          text: `Scheduled mission **"${mission.title}"** is now active.`,
          metadata: { type: 'mission_activated', mission_id: mission.id },
        });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('chat-messages-changed'));
        }
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('missions-changed'));
      }

      // Auto-dispatch tasks for the newly activated mission
      import('./taskDispatcher').then(({ autoDispatchMission }) => {
        autoDispatchMission(mission.id)
          .catch(err => console.warn('[checkScheduledMissions] Auto-dispatch failed:', err));
      });

      actions.push({
        id: makeActionId(),
        action_type: 'assign_mission',
        payload: { topic: `scheduled_${mission.id}`, mission_id: mission.id },
        priority: 3,
      });
    }
  } catch (err) {
    console.warn('[CEODecisionEngine] Scheduled mission check failed:', err);
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Skill schedules — run skills on user-defined schedules
// ---------------------------------------------------------------------------

async function checkSkillSchedules(): Promise<CEOAction[]> {
  const actions: CEOAction[] = [];

  try {
    const dueSchedules = await getDueSkillSchedules();
    if (dueSchedules.length === 0) return actions;

    // Commands that must NEVER run via skill_schedules — they need params from LLM drafting
    const SCHEDULE_BLOCKED = new Set(['forum:reply', 'forum:vote', 'forum:poll_vote', 'forum:create_post', 'forum:introduce']);

    for (const schedule of dueSchedules) {
      // Skip commands that can't work without LLM-drafted params
      if (SCHEDULE_BLOCKED.has(`${schedule.skill_id}:${schedule.command_name}`)) {
        console.warn(`[checkSkillSchedules] Skipping blocked command "${schedule.skill_id}:${schedule.command_name}"`);
        continue;
      }

      const now = new Date();
      const missionId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Create a system mission for this scheduled execution
      const sb = getSupabase();
      const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      await sb.from('missions').insert({
        id: missionId,
        title: `[System] ${schedule.skill_id} (${dateStr})`,
        status: 'in_progress',
        assignee: 'ceo',
        priority: 'low',
        created_by: 'scheduler',
      });

      // Create task execution with stored params
      await sb.from('task_executions').insert({
        id: taskId,
        mission_id: missionId,
        agent_id: 'ceo',
        skill_id: schedule.skill_id,
        command_name: schedule.command_name,
        params: schedule.params ?? {},
        model: 'Claude Haiku 4.5',  // Use cheap model for maintenance tasks
        status: 'pending',
      });

      // Update schedule timestamps
      const nextRun = computeNextRun(
        schedule.frequency as 'hourly' | 'every_4h' | 'daily' | 'weekly' | 'monthly',
        schedule.run_at_time,
        schedule.run_on_day,
        now,
      );
      await updateSkillScheduleRun(schedule.id, now.toISOString(), nextRun.toISOString());

      // Fire off execution — dynamic import to avoid circular dependency
      import('./taskDispatcher').then(({ executeTask }) => {
        executeTask(taskId, missionId, schedule.skill_id, schedule.command_name, schedule.params ?? {}, 'Claude Haiku 4.5')
          .catch(err => console.error('[checkSkillSchedules] Execution failed:', err));
      }).catch(err => console.error('[checkSkillSchedules] Import failed:', err));

      logAudit('CEO', 'SKILL_SCHEDULE_FIRE', `Scheduled ${schedule.skill_id}/${schedule.command_name} (${schedule.frequency}) executed`, 'info');

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('missions-changed'));
        window.dispatchEvent(new Event('task-executions-changed'));
      }

      actions.push({
        id: makeActionId(),
        action_type: 'send_message',
        payload: {
          topic: `skill_schedule_${schedule.id}`,
          message: `Scheduled skill ${schedule.skill_id} executed (${schedule.frequency})`,
          mission_id: missionId,
        },
        priority: 7,
      });
    }
  } catch (err) {
    console.warn('[CEODecisionEngine] Skill schedule check failed:', err);
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Forum socialize program
// ---------------------------------------------------------------------------

let lastForumCheckTime = 0;
const DEFAULT_FORUM_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Forum only runs during business hours (8am-6pm local) */
function isForumBusinessHours(): boolean {
  const hour = new Date().getHours();
  return hour >= 8 && hour < 18;
}

// Marketplace forum config — cached for 30 minutes
interface MarketplaceForumConfig {
  post_limit_per_day: number;
  vote_limit_per_day: number;
  title_max_chars: number;
  body_max_chars: number;
  max_reply_depth: number;
  recommended_check_interval_ms: number;
}

let cachedForumConfig: MarketplaceForumConfig | null = null;
let forumConfigFetchedAt = 0;
const FORUM_CONFIG_CACHE_MS = 30 * 60 * 1000; // 30 minutes

async function fetchForumConfig(): Promise<MarketplaceForumConfig | null> {
  const now = Date.now();
  if (cachedForumConfig && now - forumConfigFetchedAt < FORUM_CONFIG_CACHE_MS) {
    return cachedForumConfig;
  }
  try {
    const res = await fetch('https://jarvisinc.app/api/forum/config');
    if (!res.ok) return cachedForumConfig;
    const data = await res.json();
    cachedForumConfig = data as MarketplaceForumConfig;
    forumConfigFetchedAt = now;
    return cachedForumConfig;
  } catch {
    return cachedForumConfig; // Return stale cache on failure
  }
}

export async function triggerForumCheckNow(): Promise<CEOAction[]> {
  lastForumCheckTime = 0;
  return checkForumActivity();
}

export async function refreshMarketplaceProfile(): Promise<void> {
  const { getMarketplaceStatus, signedMarketplacePost } = await import('./marketplaceClient');
  const mktStatus = getMarketplaceStatus();
  if (!mktStatus.registered || !mktStatus.instanceId) throw new Error('Not registered');

  const { getSetting: gs, loadSkills: ls, loadAgents: la, loadCEO } = await import('./database');
  const orgName = (await gs('org_name')) ?? 'Jarvis Instance';
  const ceo = await loadCEO();
  const ceoName = ceo?.name;
  const primaryMission = (await gs('primary_mission')) ?? '';
  const founderName = (await gs('founder_name')) ?? 'Unknown';
  // Custom marketplace description takes priority over primary_mission
  const mktDescription = await gs('marketplace_description');

  const allSkills = await ls();
  const enabled = allSkills.filter(s => s.enabled);
  const featuredSkills = enabled.map(s => s.id).slice(0, 20);
  const skillNames = enabled.map(s => {
    const def = s.definition as Record<string, unknown> | null;
    return (def?.name as string) ?? s.id;
  });

  // Showcase skills — extra skills to display on the marketplace profile
  // (stored as comma-separated string in settings, merged into featured + writeup)
  const showcaseRaw = await gs('marketplace_showcase_skills');
  const showcaseSkills = showcaseRaw
    ? showcaseRaw.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const allAgents = await la();
  const agentNames = allAgents.map(a => a.name);

  const description = mktDescription
    ?? (primaryMission ? primaryMission.substring(0, 180) : `${founderName}'s Jarvis instance — ${orgName}`);

  // Merge real skill IDs + showcase IDs for featured_skills badge array
  const allFeatured = [...featuredSkills, ...showcaseSkills].slice(0, 40);
  // Merge real skill names + showcase names for the writeup
  const allSkillNames = [...skillNames, ...showcaseSkills];

  const writeupParts: string[] = [];
  // Use marketplace description for mission line, fall back to primary_mission
  const missionLine = mktDescription || primaryMission;
  if (missionLine) writeupParts.push(`Mission: ${missionLine}`);
  if (allSkillNames.length > 0) writeupParts.push(`Skills: ${allSkillNames.join(', ')}`);
  if (agentNames.length > 0) writeupParts.push(`Agents: ${agentNames.join(', ')}`);
  const skillsWriteup = writeupParts.join('\n') || `${founderName}'s autonomous AI workforce`;

  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
  const payload = {
    nickname: (ceoName || orgName).substring(0, 24),
    org_name: orgName.substring(0, 100),
    description: description.substring(0, 200),
    featured_skills: allFeatured,
    skills_writeup: skillsWriteup.substring(0, 1000),
    app_version: appVersion,
  };
  console.log('[refreshMarketplaceProfile] Sending:', JSON.stringify(payload));
  const result = await signedMarketplacePost(`/api/profile/${mktStatus.instanceId}`, payload);
  console.log('[refreshMarketplaceProfile] Result:', JSON.stringify(result));

  // Auto-recovery: if marketplace says "Instance not found", re-register and retry once
  if (!result.success && result.error && /not found/i.test(result.error)) {
    console.log('[refreshMarketplaceProfile] Instance not found — attempting re-registration...');
    const { registerOnMarketplace, getCachedRawPrivateKey: getRawKey, getPublicKeyData } = await import('./marketplaceClient');
    const keyData = getPublicKeyData();
    const rawKey = getRawKey();
    if (keyData && rawKey) {
      const regResult = await registerOnMarketplace(rawKey, keyData.publicKey);
      if (regResult.success) {
        console.log('[refreshMarketplaceProfile] Re-registered. Retrying profile update...');
        const newStatus = getMarketplaceStatus();
        if (newStatus.registered && newStatus.instanceId) {
          const retry = await signedMarketplacePost(`/api/profile/${newStatus.instanceId}`, payload);
          if (!retry.success) throw new Error(retry.error || 'Profile update failed after re-registration');
          return; // Success on retry
        }
      }
    }
    throw new Error('Profile update failed: instance not found and re-registration failed');
  }

  if (!result.success) throw new Error(result.error || 'Profile update failed');
}

// Post-activity burst schedule: check forum more frequently after posting
let forumBurstState = { active: false, startTime: 0, checksCompleted: 0 };
const BURST_INTERVALS_MS = [5 * 60000, 10 * 60000, 20 * 60000, 30 * 60000]; // 5, 10, 20, 30 min

export function activateForumBurst() {
  forumBurstState = { active: true, startTime: Date.now(), checksCompleted: 0 };
  lastForumCheckTime = 0; // Force next check soon
}

function parseCronToMs(cron: string): number {
  // Simple cron-to-interval: 0 */N * * * → every N hours
  const match = cron.match(/^\d+\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (match) return parseInt(match[1], 10) * 60 * 60 * 1000;
  // 0 0 * * * → daily
  if (/^\d+\s+\d+\s+\*\s+\*\s+\*$/.test(cron)) return 24 * 60 * 60 * 1000;
  return cachedForumConfig?.recommended_check_interval_ms ?? DEFAULT_FORUM_CHECK_INTERVAL_MS;
}

interface ForumPostSummary {
  id: string;
  channel_id: string;
  channel_name: string;
  title: string;
  body: string;
  instance_nickname: string;
  is_reply: boolean;
  parent_title: string;
  poll_options?: string[];
  poll_results?: { option: string; votes: number }[];
  poll_closed?: boolean;
  poll_total_votes?: number;
  image_url?: string;
}

interface ForumChannel {
  id: string;
  name: string;
  description: string;
  post_count: number;
}

async function checkForumActivity(): Promise<CEOAction[]> {
  const actions: CEOAction[] = [];

  try {
    const skills = await loadSkills();
    const forumSkill = skills.find(s => s.id === 'forum' && s.enabled);
    if (!forumSkill) return actions;

    // Load forum skill options (options_config from skills table)
    const forumOpts = await getSkillOptions('forum');
    const forum24h = forumOpts.forum_24h === true;

    // Forum only runs during business hours (8am-6pm local) unless 24h mode or burst
    if (!forum24h && !isForumBusinessHours() && !forumBurstState.active) {
      console.log(`[checkForumActivity] Skipped — outside business hours (${new Date().getHours()}:00). Set forum_24h option to enable 24/7.`);
      return actions;
    }

    const now = Date.now();
    const sb = getSupabase();

    // Fetch marketplace forum config (cached 30min) for recommended interval + limits
    const forumConfig = await fetchForumConfig();
    const defaultInterval = forumConfig?.recommended_check_interval_ms ?? DEFAULT_FORUM_CHECK_INTERVAL_MS;

    const forumFreq = (forumOpts.forum_check_frequency as string) || null;
    const forumAutoPostRaw = (forumOpts.forum_auto_post as string) ?? 'normal';

    // Burst mode: use shorter intervals after posting/replying
    let intervalMs: number;
    if (forumBurstState.active) {
      const idx = forumBurstState.checksCompleted;
      if (idx >= BURST_INTERVALS_MS.length) {
        // Burst exhausted, revert to normal
        forumBurstState.active = false;
        intervalMs = forumFreq ? parseCronToMs(forumFreq) : defaultInterval;
      } else {
        intervalMs = BURST_INTERVALS_MS[idx];
      }
    } else {
      // Normal cron-based interval — skill option overrides marketplace recommendation
      intervalMs = forumFreq ? parseCronToMs(forumFreq) : defaultInterval;
    }

    if (now - lastForumCheckTime < intervalMs) {
      const remainMs = intervalMs - (now - lastForumCheckTime);
      console.log(`[checkForumActivity] Waiting — next check in ${Math.round(remainMs / 1000)}s (interval: ${Math.round(intervalMs / 1000)}s)`);
      return actions;
    }
    lastForumCheckTime = now;
    console.log(`[checkForumActivity] Running forum check (activity window: ${forum24h ? '24h' : 'business hours'}, interval: ${Math.round(intervalMs / 1000)}s)`);

    if (forumBurstState.active) forumBurstState.checksCompleted++;

    const MARKETPLACE_URL = 'https://jarvisinc.app';

    // Forum auto-post level — graduated risk tiers (off/safe/normal/all)
    const autoPostLevel =
      forumAutoPostRaw === 'true' ? 'all' :
      forumAutoPostRaw === 'false' ? 'off' :
      (['off', 'safe', 'normal', 'all'].includes(forumAutoPostRaw) ? forumAutoPostRaw : 'normal');
    const autoPost = autoPostLevel !== 'off';

    const { data: lastCheckRow } = await sb
      .from('settings')
      .select('value')
      .eq('key', 'last_forum_check')
      .maybeSingle();
    const lastCheck = lastCheckRow?.value || new Date(0).toISOString();

    // Get org name for filtering own posts
    const { data: orgRow } = await sb
      .from('settings')
      .select('value')
      .eq('key', 'org_name')
      .maybeSingle();
    const orgName = orgRow?.value || '';

    // 1. Fetch channels WITH descriptions (so CEO knows what each channel is for)
    let channels: ForumChannel[] = [];
    let newPosts: ForumPostSummary[] = [];

    try {
      const channelsRes = await fetch(`${MARKETPLACE_URL}/api/forum/channels`);
      if (!channelsRes.ok) return actions;
      const channelsData = await channelsRes.json();
      channels = (channelsData.channels || []).map((c: Record<string, unknown>) => ({
        id: String(c.id || ''),
        name: String(c.name || c.id || ''),
        description: String(c.description || ''),
        post_count: Number(c.post_count || 0),
      }));

      // 2. Fetch new posts from each channel since last check
      for (const channel of channels) {
        try {
          const postsRes = await fetch(
            `${MARKETPLACE_URL}/api/forum/channels/${channel.id}/posts?since=${encodeURIComponent(lastCheck)}&limit=10`
          );
          if (postsRes.ok) {
            const postsData = await postsRes.json();
            const posts = (postsData.posts || []).map((p: Record<string, unknown>) => ({
              id: String(p.id),
              channel_id: String(p.channel_id),
              channel_name: channel.name,
              title: String(p.title || ''),
              body: String(p.body || '').substring(0, 500),
              instance_nickname: String(p.instance_nickname || 'Unknown'),
              is_reply: false,
              parent_title: '',
              poll_options: Array.isArray(p.poll_options) ? p.poll_options as string[] : undefined,
              poll_results: Array.isArray(p.poll_results) ? p.poll_results as { option: string; votes: number }[] : undefined,
              poll_closed: p.poll_closed === true,
              poll_total_votes: typeof p.poll_total_votes === 'number' ? p.poll_total_votes : undefined,
              image_url: typeof p.image_url === 'string' ? p.image_url : undefined,
            }));
            newPosts.push(...posts);
          }
        } catch { /* skip channel */ }
      }

      // 2b. Check replies on our own recent posts (so we can respond to questions)
      const { data: recentOwnTasks } = await sb
        .from('task_executions')
        .select('result')
        .eq('skill_id', 'forum')
        .in('command_name', ['create_post', 'reply', 'introduce'])
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(10);

      // Extract post IDs we've created from task results
      const ownPostIds: string[] = [];
      for (const task of recentOwnTasks || []) {
        const output = (task.result as Record<string, unknown>)?.output as string ?? '';
        // Match post IDs from output like "post/p-xxxx" or "thread p-xxxx"
        const idMatches = output.match(/(?:post\/|thread\s+)(p-[a-z0-9]+)/gi);
        if (idMatches) {
          for (const m of idMatches) {
            const id = m.replace(/^(?:post\/|thread\s+)/i, '');
            if (id && !ownPostIds.includes(id)) ownPostIds.push(id);
          }
        }
      }

      // Fetch threads for our own posts to find new replies from others
      for (const postId of ownPostIds.slice(0, 5)) {
        try {
          const threadRes = await fetch(`${MARKETPLACE_URL}/api/forum/posts/${postId}`);
          if (threadRes.ok) {
            const threadData = await threadRes.json();
            const parentTitle = String(threadData.post?.title || '');
            const replies = (threadData.replies || []) as Record<string, unknown>[];
            for (const r of replies) {
              const createdAt = String(r.created_at || '');
              // Only new replies since last check, from OTHER instances
              if (createdAt > lastCheck && String(r.instance_nickname || '') !== orgName) {
                newPosts.push({
                  id: String(r.id),
                  channel_id: String(threadData.post?.channel_id || ''),
                  channel_name: '',
                  title: '',
                  body: String(r.body || '').substring(0, 500),
                  instance_nickname: String(r.instance_nickname || 'Unknown'),
                  is_reply: true,
                  parent_title: parentTitle,
                });
              }
            }
          }
        } catch { /* skip */ }
      }
    } catch { return actions; }

    // Update last check timestamp
    await sb.from('settings').upsert({
      key: 'last_forum_check',
      value: new Date().toISOString(),
    }, { onConflict: 'key' });

    // 3. Check if we need to introduce ourselves (first-time forum engagement)
    const { data: introRow } = await sb
      .from('settings')
      .select('value')
      .eq('key', 'forum_intro_posted')
      .maybeSingle();
    const introPosted = introRow?.value === 'true';

    if (!introPosted) {
      // Auto-introduce: create a mission to post an introduction
      const introMissionId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const introTaskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      await sb.from('missions').insert({
        id: introMissionId,
        title: '[Forum] Post Introduction',
        status: 'in_progress',
        assignee: 'ceo',
        priority: 'medium',
        created_by: 'scheduler',
      });

      await sb.from('task_executions').insert({
        id: introTaskId,
        mission_id: introMissionId,
        agent_id: 'ceo',
        skill_id: 'forum',
        command_name: 'introduce',
        params: {},
        model: 'Claude Haiku 4.5',
        status: 'pending',
      });

      // Mark as posted (even before execution completes — prevents duplicate intros)
      await sb.from('settings').upsert({
        key: 'forum_intro_posted',
        value: 'true',
      }, { onConflict: 'key' });

      // Execute the introduction
      import('./taskDispatcher').then(({ executeTask }) => {
        executeTask(introTaskId, introMissionId, 'forum', 'introduce', {}, 'Claude Haiku 4.5')
          .catch(err => console.error('[checkForumActivity] Introduction failed:', err));
      }).catch(err => console.error('[checkForumActivity] Import failed:', err));

      await logAudit('CEO', 'FORUM_INTRO', `Forum introduction posted for ${orgName}`, 'info');

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('missions-changed'));
        window.dispatchEvent(new Event('task-executions-changed'));
      }

      actions.push({
        id: makeActionId(),
        action_type: 'send_message',
        payload: {
          topic: 'forum_introduction',
          message: `I just introduced us on the Marketplace Forum! Posted in #Introductions with our org info, skills, and team.`,
        },
        priority: 5,
      });
    }

    // 4. Separate own posts from others (don't bail — we engage proactively)
    const newPostsFromOthers = newPosts.filter(p => p.instance_nickname !== orgName);

    // 5. Forum Activity Scorecard — drives engagement intensity
    const totalChannelPosts = channels.reduce((sum, c) => sum + c.post_count, 0);
    const recentActivityCount = newPosts.length;
    let forumActivityLevel: 'dead' | 'quiet' | 'moderate' | 'active' | 'busy';
    if (totalChannelPosts < 5) forumActivityLevel = 'dead';
    else if (recentActivityCount === 0 && totalChannelPosts < 20) forumActivityLevel = 'quiet';
    else if (recentActivityCount <= 2) forumActivityLevel = 'quiet';
    else if (recentActivityCount <= 5) forumActivityLevel = 'moderate';
    else if (recentActivityCount <= 15) forumActivityLevel = 'active';
    else forumActivityLevel = 'busy';

    // 6. Load org memories for proactive topic mining
    let orgMemoryContext = '';
    try {
      const { getMemories } = await import('./memory');
      const memories = await getMemories(30);
      const relevantMemories = memories
        .filter(m => ['insight', 'decision', 'fact', 'preference'].includes(m.category))
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 15);
      if (relevantMemories.length > 0) {
        orgMemoryContext = relevantMemories
          .map(m => `- [${m.category}] ${m.content}`)
          .join('\n');
      }
    } catch { /* memories unavailable */ }

    // 7. Fetch existing feature requests for deduplication
    let existingFeatures = '';
    try {
      const featRes = await fetch(`${MARKETPLACE_URL}/api/feature-requests?limit=30`);
      if (featRes.ok) {
        const featData = await featRes.json();
        const features = (featData.feature_requests || []) as Array<{ title: string; votes: number; id: string }>;
        if (features.length > 0) {
          existingFeatures = features
            .map(f => `- "${f.title}" (${f.votes ?? 0} votes) [ID: ${f.id}]`)
            .join('\n');
        }
      }
    } catch { /* features unavailable */ }

    // 7b. Load installed skills so CEO doesn't suggest features that already exist
    let installedSkillsSummary = '';
    try {
      const { loadSkills } = await import('./database');
      const allSkills = await loadSkills();
      const enabledSkills = allSkills.filter(s => s.enabled);
      if (enabledSkills.length > 0) {
        installedSkillsSummary = enabledSkills
          .map(s => {
            const def = typeof s.definition === 'string' ? JSON.parse(s.definition) : s.definition;
            return `- ${def?.name || s.id} (${s.id})`;
          })
          .join('\n');
      }
    } catch { /* skills unavailable */ }

    await logAudit('CEO', 'FORUM_CHECK',
      `Forum: ${newPostsFromOthers.length} new from others, activity=${forumActivityLevel} (${totalChannelPosts} total). Memories: ${orgMemoryContext ? 'loaded' : 'none'}. Features: ${existingFeatures ? 'loaded' : 'none'}.`,
      'info');

    // 8. Socialize Program — proactive LLM-driven engagement
    if (autoPost) {
      // Check marketplace registration — check DB settings directly (sidecar cache may be stale)
      const regId = await getSetting('marketplace_instance_id');
      if (!regId) {
        await logAudit('CEO', 'FORUM_BLOCKED', 'Forum engagement blocked — not registered on marketplace', 'warning');
        actions.push({
          id: makeActionId(),
          action_type: 'send_message',
          payload: {
            topic: 'forum_blocked',
            message: `Forum check complete (${forumActivityLevel}) but I can't engage — we're not registered on the marketplace yet. Head to Skills → Marketplace to register, or I can do it if you enable the skill.`,
          },
          priority: 7,
        });
        return actions;
      }

      // Pre-flight rate limit check — skip expensive LLM call if already at post limit
      let postsRemainingToday = 999; // default: assume unlimited if check fails
      try {
        const configData = await fetchForumConfig();
        const postLimit = configData?.post_limit_per_day ?? 5;
        const rlRes = await fetch(`https://jarvisinc.app/api/forum/rate-limit?instance_id=${regId}`);
        if (rlRes.ok) {
          const rlData = await rlRes.json();
          postsRemainingToday = Math.max(0, postLimit - (rlData.posts_today ?? 0));
        }
      } catch { /* rate limit pre-check failed — proceed anyway */ }

      if (postsRemainingToday <= 0) {
        await logAudit('CEO', 'FORUM_SKIP', 'Forum engagement skipped — daily post rate limit already reached', 'info');
        return actions;
      }

      // Draft replies using LLM directly (no skill execution, just content generation)
      // Try Anthropic first, then fall back to OpenAI
      const { getVaultEntryByService } = await import('./database');
      const anthropicEntry = await getVaultEntryByService('Anthropic');
      const openaiEntry = !anthropicEntry ? await getVaultEntryByService('OpenAI') : null;
      const vaultEntry = anthropicEntry || openaiEntry;
      const forumLlmService = anthropicEntry ? 'anthropic' : 'openai';
      if (!vaultEntry) {
        await logAudit('CEO', 'FORUM_BLOCKED', 'Forum engagement blocked — no Anthropic or OpenAI API key in vault', 'warning');
        actions.push({
          id: makeActionId(),
          action_type: 'send_message',
          payload: {
            topic: 'forum_blocked',
            message: `Forum check complete (${forumActivityLevel}) but I need an API key (Anthropic or OpenAI) to engage. Add one in the Vault.`,
          },
          priority: 7,
        });
        return actions;
      }

      // Load CEO personality for deep voice-matching
      const ceo = await loadCEO();
      const ceoName = ceo?.name ?? 'CEO';
      const ceoPhilosophy = ceo?.philosophy ?? '';
      const ceoArchetype = ceo?.archetype ?? '';

      // Check if image generation is available + enabled
      let imageGenAvailable = false;
      try {
        const imageGenEnabled = forumOpts.forum_image_gen === true;
        if (imageGenEnabled) {
          const { isImageGenAvailable } = await import('./imageGen');
          imageGenAvailable = await isImageGenAvailable();
        }
      } catch { /* image gen check failed */ }

      // Archetype voice guide — compact version for forum context
      const ARCHETYPE_VOICES: Record<string, string> = {
        wharton_mba: 'You speak like a management consultant — frameworks, ROI, competitive advantage. Structured and strategic.',
        wall_street: 'You speak like a Wall Street trader — direct, numbers-focused, zero fluff. Everything is risk/reward.',
        mit_engineer: 'You speak like a systems engineer — precise, technical, probabilistic. Architecture and trade-offs.',
        sv_founder: 'You speak like a startup CEO — "ship it", "iterate", "10x". Big thinking, fast moving.',
        beach_bum: 'You speak with laid-back wisdom — chill, nature metaphors, no rush. Sustainable pace beats burnout.',
        military_cmd: 'You speak with military precision — SitReps, objectives, mission-focused. Brief and authoritative.',
        creative_dir: 'You speak with creative sensibility — quality, craft, visual language. Trust instincts.',
        professor: 'You speak with academic rigor — evidence-based, structured arguments, acknowledge uncertainty.',
      };
      const personaVoice = ARCHETYPE_VOICES[ceoArchetype] || 'You have a helpful, genuine, personality-driven voice.';

      // Build post summaries — include OUR posts too (we can reply to them)
      const postSummaries = newPosts.length > 0
        ? newPosts
            .map(p => {
              const isOurs = p.instance_nickname === orgName;
              const prefix = p.is_reply
                ? `[Reply ID: ${p.id}]${isOurs ? ' [YOURS]' : ''} (reply to "${p.parent_title}") by ${p.instance_nickname}`
                : `[Post ID: ${p.id}]${isOurs ? ' [YOURS]' : ''} [#${p.channel_name}] "${p.title}" by ${p.instance_nickname}`;
              let pollInfo = '';
              if (p.poll_options && p.poll_options.length > 0) {
                const status = p.poll_closed ? 'CLOSED' : 'OPEN';
                const results = p.poll_results
                  ? p.poll_results.map((r, i) => `  ${i}: "${r.option}" (${r.votes} votes)`).join('\n')
                  : p.poll_options.map((o, i) => `  ${i}: "${o}" (0 votes)`).join('\n');
                pollInfo = `\n[POLL - ${status}, ${p.poll_total_votes ?? 0} total votes]\n${results}`;
              }
              return `${prefix}\n${p.body}${pollInfo}`;
            })
            .join('\n---\n')
        : '(No new posts since last check)';

      // Include channel IDs so LLM can reference them for create_post
      const channelList = channels.map(c => `- #${c.name} (id: ${c.id}): ${c.description || 'General'}`).join('\n');

      // Engagement intensity guidance based on activity level
      const activityGuidance =
        forumActivityLevel === 'dead' || forumActivityLevel === 'quiet'
          ? `The forum is ${forumActivityLevel.toUpperCase()}. YOU should be MORE active — create posts, share thoughts, start discussions. Memes, hot takes, and casual banter are WELCOME to liven things up. Be the spark that gets conversations going.`
          : forumActivityLevel === 'moderate'
            ? 'The forum has moderate activity. Engage with others, reply to interesting threads, contribute when you have something to add.'
            : 'The forum is active/busy. Be selective — only engage where you add real value. No need to force posts.';

      const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      const draftPrompt = `You are ${ceoName}, an AI CEO on a community forum for AI bot instances.
Your org: ${orgName}
Today's date: ${currentDate}

## YOUR PERSONALITY
${personaVoice}
Philosophy: ${ceoPhilosophy || 'Be helpful, concise, and genuine.'}
IMPORTANT: Let your personality shine through EVERYTHING you write. Your voice should be distinctive and consistent.

## FORUM ACTIVITY SCORECARD
Activity level: ${forumActivityLevel.toUpperCase()}
Posts since last check: ${recentActivityCount} (${newPostsFromOthers.length} from others, ${newPosts.length - newPostsFromOthers.length} from you)
Total forum posts all-time: ${totalChannelPosts}
REMAINING POSTS TODAY: ${postsRemainingToday} (do NOT plan more posts+replies than this number — they will be rejected by the rate limiter)
${activityGuidance}

## AVAILABLE ACTIONS
1. "reply" — Reply to any post (including your OWN threads — add more info, be contrarian, share a follow-up thought). Appropriate length, max 500 chars. Reddit-style: witty, real, personality-driven. Not forced short — say what needs saying.
2. "vote" — Upvote (value: 1) or downvote (value: -1). Upvote good content. Downvote spam or misinformation. IMPORTANT: Do NOT vote on posts marked [YOURS] — voting on your own posts will fail.
3. "create_post" — Start a NEW forum thread. ${forumActivityLevel === 'dead' || forumActivityLevel === 'quiet' ? 'The forum NEEDS content — strongly consider posting something interesting.' : 'Use when you have a genuine topic.'} Requires channel_id and title. Can include poll_options (array of 2-6 strings) to create a poll.${imageGenAvailable ? ' Can include "image_prompt" (description of image to generate). Generate images SPARINGLY — only when a meme, diagram, or visual genuinely enhances the post. Maybe 1 in 5 posts gets an image, if that.' : ''}
4. "poll_vote" — Vote on a poll option. Requires post_id and option_index (0-based). Vote on polls when you have an informed opinion. Cannot vote on your own polls.
5. "suggest_feature" — Suggest a feature for the Jarvis Inc PLATFORM (the marketplace/app itself). Max 1 per check.${existingFeatures ? ' CHECK EXISTING FEATURES BELOW — if a similar one exists, skip it (do NOT use "vote" action on feature requests — feature IDs start with "fr-" and are NOT forum posts).' : ''}

## FEATURE SUGGESTION RULES
- ONLY suggest features that are genuinely MISSING from the Jarvis platform
- Do NOT suggest features that already exist as installed skills (see YOUR INSTALLED SKILLS below)
- Do NOT suggest internal workflow improvements for your own org — features are for the shared platform
- If a skill exists but is read-only and you want write access, that IS a valid feature suggestion
- If a capability exists in your skills list, DO NOT suggest it as a feature request
${installedSkillsSummary ? `
## YOUR INSTALLED SKILLS (do NOT suggest features that duplicate these)
${installedSkillsSummary}` : ''}

## ENGAGEMENT RULES
- You CAN reply to your own posts (add more info, be contrarian, share a follow-up thought)
- You CAN combine multiple actions (e.g., reply + upvote)
- Reply to questions directed at you — be helpful and conversational
- If nothing new: look at YOUR MEMORIES below for topics worth posting about
- ${forumActivityLevel === 'dead' || forumActivityLevel === 'quiet' ? 'Quiet forum = memes, hot takes, fun observations, "what if" scenarios, contrarian opinions are ALL fair game. Be the life of the party.' : 'Be genuine — skip "nice!" or "I agree" with nothing to add'}
- You can disagree respectfully — having opinions makes you interesting
- Never reveal private org details (API keys, passwords, credentials, financial figures)
- Vote on polls when you have an informed opinion. Create polls to gather community input on interesting questions.
- Max 3 replies, max 5 votes, max 1 new post, max 1 feature suggestion per check

## CHANNELS (for create_post — use the id value)
${channelList}
${newPosts.length > 0 ? `
## RECENT POSTS
${postSummaries}` : `
## NO NEW POSTS
Nothing new since last check. Mine your memories below for something worth discussing. Start a conversation.`}
${orgMemoryContext ? `
## YOUR MEMORIES (use for inspiration, topics, context, or things worth sharing)
${orgMemoryContext}` : ''}
${existingFeatures ? `
## EXISTING FEATURE REQUESTS (check before suggesting duplicates — vote for existing ones instead)
${existingFeatures}` : ''}

Respond with ONLY a valid JSON object with two keys:
1. "reasoning" — a brief summary (2-4 sentences) of your overall assessment: what you noticed, why you're engaging or not, your strategy
2. "actions" — array of actions to take

Return {"reasoning":"...","actions":[]} if you truly have nothing worth saying — but with a ${forumActivityLevel} forum, you should almost always have something.

Example:
{"reasoning":"Forum is quiet with only 3 posts total. I see a new post about AI workflows that aligns with our app-building mission — worth replying to share our perspective. Also starting a thread about competitive analysis since that's our specialty. There's a poll about deployment strategies I have an opinion on.","actions":[
  {"action":"reply","post_id":"...","body":"your reply text"},
  {"action":"vote","post_id":"...","value":1},
  {"action":"poll_vote","post_id":"...","option_index":0},
  {"action":"create_post","channel_id":"...","title":"...","body":"your post content","poll_options":["Option A","Option B","Option C"]},
  {"action":"suggest_feature","title":"...","description":"feature description"}
]}`;

      let draftActions: { action: string; post_id?: string; body?: string; value?: number; channel_id?: string; title?: string; description?: string; option_index?: number; poll_options?: string[]; poll_duration_days?: number; image_prompt?: string }[] = [];
      let llmReasoning = '';

      try {
        const { MODEL_API_IDS } = await import('./models');

        // Pick provider + model based on available key
        let provider: { stream: (msgs: unknown[], key: string, model: string, cb: unknown) => unknown };
        let modelId: string;
        if (forumLlmService === 'anthropic') {
          const { anthropicProvider } = await import('./llm/providers/anthropic');
          provider = anthropicProvider as unknown as typeof provider;
          modelId = MODEL_API_IDS['Claude Haiku 4.5'];
        } else {
          const { openaiProvider } = await import('./llm/providers/openai');
          provider = openaiProvider as unknown as typeof provider;
          modelId = MODEL_API_IDS['o4-mini'] || 'o4-mini';
        }
        console.log(`[checkForumActivity] Using ${forumLlmService} (${modelId}) for forum engagement`);

        const draftResult = await new Promise<string | null>((resolve) => {
          let fullText = '';
          provider.stream(
            [{ role: 'user', content: draftPrompt }],
            vaultEntry.key_value,
            modelId,
            {
              onToken: (token: string) => { fullText += token; },
              onDone: (text: string) => { resolve(text || fullText); },
              onError: (err: Error) => {
                console.warn('[checkForumActivity] Draft LLM failed:', err);
                resolve(null);
              },
            },
          );
        });

        if (draftResult) {
          // Try new format: {"reasoning":"...","actions":[...]}
          const objMatch = draftResult.match(/\{[\s\S]*"reasoning"[\s\S]*"actions"[\s\S]*\}/);
          if (objMatch) {
            try {
              const parsed = JSON.parse(objMatch[0]);
              llmReasoning = parsed.reasoning || '';
              draftActions = Array.isArray(parsed.actions) ? parsed.actions : [];
            } catch {
              // Fall back to array-only format
              const jsonMatch = draftResult.match(/\[[\s\S]*\]/);
              if (jsonMatch) draftActions = JSON.parse(jsonMatch[0]);
            }
          } else {
            // Legacy format: just a JSON array
            const jsonMatch = draftResult.match(/\[[\s\S]*\]/);
            if (jsonMatch) draftActions = JSON.parse(jsonMatch[0]);
          }
        }

        // Log structured decision to A2A audit with full reasoning
        const decisionLog = {
          activity_level: forumActivityLevel,
          posts_from_others: newPostsFromOthers.length,
          total_posts: totalChannelPosts,
          reasoning: llmReasoning || '(no reasoning provided)',
          actions: draftActions.map(da => ({
            action: da.action,
            target: da.post_id || da.channel_id || da.title || '—',
            ...(da.body ? { body_preview: (da.body as string).slice(0, 80) } : {}),
            ...(da.value !== undefined ? { value: da.value } : {}),
          })),
        };
        console.log('[checkForumActivity] Decision:', JSON.stringify(decisionLog));
        await logAudit('CEO', 'FORUM_DECISION', JSON.stringify(decisionLog), 'info');

        if (draftActions.length > 0) {
          const actionSummary = draftActions.map(da => {
            if (da.action === 'reply') return `reply→${da.post_id?.slice(0, 8)}`;
            if (da.action === 'vote') return `vote(${da.value ?? 1})→${da.post_id?.slice(0, 8)}`;
            if (da.action === 'poll_vote') return `poll_vote(${da.option_index})→${da.post_id?.slice(0, 8)}`;
            if (da.action === 'create_post') return `post:"${da.title?.slice(0, 30)}"${da.poll_options ? ' [poll]' : ''}`;
            if (da.action === 'suggest_feature') return `feature:"${da.title?.slice(0, 30)}"`;
            return da.action;
          }).join(', ');
          console.log(`[checkForumActivity] Reasoning: ${llmReasoning}`);
          console.log(`[checkForumActivity] Actions: ${actionSummary}`);
        }
      } catch (err) {
        console.warn('[checkForumActivity] Draft generation failed:', err);
        await logAudit('CEO', 'FORUM_ERROR', `LLM draft generation failed: ${err instanceof Error ? err.message : String(err)}`, 'warning');
      }

      if (draftActions.length === 0) {
        await logAudit('CEO', 'FORUM_SKIP', `Forum ${forumActivityLevel}: LLM decided no action needed (${newPostsFromOthers.length} new from others)`, 'info');
        actions.push({
          id: makeActionId(),
          action_type: 'send_message',
          payload: {
            topic: 'forum_activity',
            message: newPostsFromOthers.length > 0
              ? `Checked ${newPostsFromOthers.length} new forum post(s) — nothing that needs a reply right now.`
              : `Forum is ${forumActivityLevel} — checked in but nothing to add right now.`,
          },
          priority: 3,
        });
        return actions;
      }

      // Create mission for tracking
      const missionId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await sb.from('missions').insert({
        id: missionId,
        title: `[Forum] Engage with ${draftActions.length} post(s)`,
        status: 'in_progress',
        assignee: 'ceo',
        priority: 'low',
        created_by: 'scheduler',
      });

      // Execute each action directly via BROWSER_HANDLERS (no LLM fallback possible)
      const { executeSkill } = await import('./skillExecutor');
      const results: string[] = [];

      for (const da of draftActions) {
        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        // Map action type to skill/command/params
        let skillId = 'forum';
        let commandName: string;
        let params: Record<string, unknown>;
        let actionLabel: string;

        // Pre-validate body for reply/create_post to avoid wasting API calls
        if ((da.action === 'reply' || da.action === 'create_post') && (!da.body || typeof da.body !== 'string' || da.body.trim().length === 0 || da.body.length > 5000)) {
          const reason = !da.body || da.body.trim().length === 0 ? 'empty body' : `body too long (${String(da.body).length} chars, max 5000)`;
          await logAudit('CEO', 'FORUM_SKIP', `Skipped ${da.action}: ${reason}`, 'warning');
          continue;
        }

        switch (da.action) {
          case 'reply':
            commandName = 'reply';
            params = { post_id: da.post_id, body: da.body };
            actionLabel = `Replied to "${newPosts.find(p => p.id === da.post_id)?.title || da.post_id}"`;
            break;
          case 'vote': {
            // Skip votes with feature request IDs — LLM sometimes confuses fr-* with post IDs
            if (da.post_id && da.post_id.startsWith('fr-')) {
              await logAudit('CEO', 'FORUM_VOTE_SKIP', `Skipped vote on feature request "${da.post_id}" — use suggest_feature action instead`, 'info');
              continue;
            }
            // Skip self-votes (own posts) — the API would reject anyway, but save the call
            const targetPost = newPosts.find(p => p.id === da.post_id);
            if (targetPost && targetPost.instance_nickname === orgName) {
              await logAudit('CEO', 'FORUM_SELF_VOTE_SKIP', `Skipped self-vote on own post "${targetPost.title || da.post_id}"`, 'info');
              continue;
            }
            commandName = 'vote';
            params = { post_id: da.post_id, value: da.value ?? 1 };
            actionLabel = `${(da.value ?? 1) > 0 ? 'Upvoted' : 'Downvoted'} "${targetPost?.title || da.post_id}"`;
            break;
          }
          case 'poll_vote': {
            commandName = 'poll_vote';
            params = { post_id: da.post_id, option_index: da.option_index };
            const pollPost = newPosts.find(p => p.id === da.post_id);
            const optLabel = pollPost?.poll_options?.[da.option_index ?? 0] ?? `option ${da.option_index}`;
            actionLabel = `Poll vote: "${optLabel}" on "${pollPost?.title || da.post_id}"`;
            break;
          }
          case 'create_post':
            commandName = 'create_post';
            params = { channel_id: da.channel_id, title: da.title, body: da.body };
            if (da.poll_options && Array.isArray(da.poll_options) && da.poll_options.length >= 2) {
              params.poll_options = da.poll_options;
              params.poll_duration_days = da.poll_duration_days ?? 3;
            }
            if (da.image_prompt) {
              params.image_prompt = da.image_prompt;
            }
            actionLabel = `Created post "${da.title}" in #${channels.find(c => c.id === da.channel_id)?.name || da.channel_id}${da.poll_options ? ' [with poll]' : ''}`;
            break;
          case 'suggest_feature':
            skillId = 'marketplace';
            commandName = 'submit_feature';
            params = { title: da.title, description: da.description };
            actionLabel = `Suggested feature: "${da.title}"`;
            break;
          default:
            continue; // Skip unknown actions
        }

        await sb.from('task_executions').insert({
          id: taskId,
          mission_id: missionId,
          agent_id: 'ceo',
          skill_id: skillId,
          command_name: commandName,
          params,
          model: 'none',
          status: 'running',
          started_at: new Date().toISOString(),
        });

        // Risk check for content-generating actions (reply, create_post)
        if ((da.action === 'reply' || da.action === 'create_post') && da.body) {
          const { assessForumPostRisk, isAutoPostAllowed } = await import('./skillExecutor');
          const assessment = await assessForumPostRisk(
            da.body as string,
            da.action === 'create_post' ? da.title as string : undefined,
          );
          if (!isAutoPostAllowed(autoPostLevel as 'off' | 'safe' | 'normal' | 'all', assessment.risk_level)) {
            await sb.from('task_executions').update({
              status: 'failed',
              result: { output: '', error: `Blocked by ${autoPostLevel} safety: ${assessment.reason}` },
              completed_at: new Date().toISOString(),
            }).eq('id', taskId);
            results.push(`Blocked (${assessment.risk_level}): ${actionLabel}`);
            continue;
          }
        }

        try {
          const result = await executeSkill(skillId, commandName, params, { missionId });

          await sb.from('task_executions').update({
            status: result.success ? 'completed' : 'failed',
            result: { output: result.output || result.error, summary: (result.output || result.error || '').slice(0, 200) },
            completed_at: new Date().toISOString(),
          }).eq('id', taskId);

          results.push(result.success ? actionLabel : `Failed: ${result.error}`);

          // Auto-upvote posts we reply to (increases engagement visibility)
          if (da.action === 'reply' && result.success && da.post_id) {
            try {
              await executeSkill('forum', 'vote', { post_id: da.post_id, value: 1 }, { missionId });
            } catch { /* vote failed — non-critical */ }
          }

          // Log each action for A2A audit trail
          await logAudit('CEO', 'FORUM_ACTION',
            `${result.success ? 'OK' : 'FAIL'}: ${actionLabel}${da.body ? ` — "${(da.body as string).slice(0, 80)}..."` : ''}`,
            result.success ? 'info' : 'warning');
        } catch (err) {
          await sb.from('task_executions').update({
            status: 'failed',
            result: { output: '', error: String(err) },
            completed_at: new Date().toISOString(),
          }).eq('id', taskId);
          results.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
          await logAudit('CEO', 'FORUM_ACTION', `ERROR: ${actionLabel} — ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
      }

      // Complete mission
      const allOk = results.every(r => !r.startsWith('Failed') && !r.startsWith('Error'));
      await sb.from('missions').update({
        status: allOk ? 'completed' : 'review',
      }).eq('id', missionId);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('missions-changed'));
        window.dispatchEvent(new Event('task-executions-changed'));
      }

      actions.push({
        id: makeActionId(),
        action_type: 'send_message',
        payload: {
          topic: 'forum_activity',
          message: `Forum engagement complete (${autoPostLevel.toUpperCase()} mode):\n${results.map(r => `• ${r}`).join('\n')}`,
          results,
          mission_id: missionId,
        },
        priority: 6,
      });
    } else if (newPostsFromOthers.length > 0) {
      // Approval mode: create approval with full context for founder review
      for (const post of newPostsFromOthers.slice(0, 3)) {
        const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        try {
          await sb.from('approvals').insert({
            id: approvalId,
            type: 'forum_post',
            title: `Reply to "${post.title || 'post'}" by ${post.instance_nickname}`,
            description: `CEO wants to engage with a forum post in #${post.channel_name}.\n\nPost content:\n${post.body.substring(0, 300)}`,
            status: 'pending',
            metadata: {
              channel_id: post.channel_id,
              channel_name: post.channel_name,
              parent_id: post.id,
              parent_title: post.title,
              parent_body: post.body,
              parent_author: post.instance_nickname,
              action: 'reply',
            },
          });
          await logAudit('CEO', 'FORUM_APPROVAL', `Created forum reply approval for post "${post.title}"`, 'info');
        } catch (err) {
          console.warn('[CEODecisionEngine] Failed to create forum approval:', err);
        }
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('approvals-changed'));
      }

      actions.push({
        id: makeActionId(),
        action_type: 'send_message',
        payload: {
          topic: 'forum_activity',
          message: `I found ${newPostsFromOthers.length} new forum post(s). Auto-posting is OFF — I've created ${Math.min(newPostsFromOthers.length, 3)} approval(s) for your review on the Approvals page.`,
          new_post_count: newPostsFromOthers.length,
          posts: newPostsFromOthers.slice(0, 3).map(p => ({ id: p.id, title: p.title, channel: p.channel_name })),
        },
        priority: 6,
      });
    }
  } catch (err) {
    console.warn('[CEODecisionEngine] Forum activity check failed:', err);
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Peer awareness — marketplace + LAN discovery
// ---------------------------------------------------------------------------

async function checkPeerInstances(): Promise<void> {
  const now = Date.now();
  if (now - lastPeerCheckTime < PEER_CHECK_INTERVAL_MS) return;
  lastPeerCheckTime = now;

  const sb = getSupabase();

  // 1. Marketplace peers (same public IP = same LAN/household)
  try {
    const { fetchPeers } = await import('./marketplaceClient');
    const result = await fetchPeers();
    if (result.success && result.peers) {
      const peerData = result.peers.map(p => ({
        id: p.id,
        nickname: p.nickname,
        online: p.online,
        last_heartbeat: p.last_heartbeat,
        featured_skills: p.featured_skills?.slice(0, 10) ?? [],
        lan_hostname: p.lan_hostname,
      }));
      await sb.from('settings').upsert({
        key: 'peer_instances',
        value: JSON.stringify(peerData),
      }, { onConflict: 'key' });
      if (peerData.length > 0) {
        console.log(`[CEODecisionEngine] Marketplace peers: ${peerData.map(p => p.nickname).join(', ')}`);
      }
    }
  } catch (err) {
    console.warn('[CEODecisionEngine] Marketplace peer check failed:', err);
  }

  // 2. LAN peers (mDNS — only available in browser/Vite dev mode)
  try {
    if (typeof window !== 'undefined') {
      // Browser environment — mDNS runs on the Vite server, not here.
      // LAN peers are fetched via the Vite dev server's peerDiscovery module.
      // In the sidecar, we skip this.
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Auto-update check — notifies founder when a new version is available
// ---------------------------------------------------------------------------

async function checkForUpdates(): Promise<CEOAction[]> {
  const actions: CEOAction[] = [];
  const now = Date.now();
  if (now - lastVersionCheckTime < VERSION_CHECK_INTERVAL_MS) return actions;
  lastVersionCheckTime = now;

  try {
    const localVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
    const res = await fetch('https://jarvisinc.app/api/version');
    if (!res.ok) return actions;
    const data = await res.json();
    const remoteVersion = data.latest_app_version as string | undefined;
    if (!remoteVersion) return actions;

    // Simple semver comparison: split on dots and compare numerically
    const parseVer = (v: string) => v.replace(/^v/, '').split('.').map(Number);
    const local = parseVer(localVersion);
    const remote = parseVer(remoteVersion);

    let updateAvailable = false;
    for (let i = 0; i < Math.max(local.length, remote.length); i++) {
      const l = local[i] ?? 0;
      const r = remote[i] ?? 0;
      if (r > l) { updateAvailable = true; break; }
      if (r < l) break;
    }

    if (updateAvailable) {
      const sb = getSupabase();

      // Check if we already notified about this version (don't spam)
      const { data: notifiedRow } = await sb
        .from('settings')
        .select('value')
        .eq('key', 'last_update_notified_version')
        .maybeSingle();

      if (notifiedRow?.value === remoteVersion) return actions;

      // Mark as notified
      await sb.from('settings').upsert({
        key: 'last_update_notified_version',
        value: remoteVersion,
      }, { onConflict: 'key' });

      await logAudit('CEO', 'UPDATE_AVAILABLE',
        `New version available: v${remoteVersion} (current: v${localVersion})${data.changelog ? ` — ${String(data.changelog).slice(0, 100)}` : ''}`,
        'info');

      const changelogSnippet = data.changelog
        ? `\n\nWhat's new:\n${String(data.changelog).slice(0, 300)}`
        : '';

      actions.push({
        id: makeActionId(),
        action_type: 'send_message',
        payload: {
          topic: 'update_available',
          message: `A new version of Jarvis Inc is available: **v${remoteVersion}** (you're on v${localVersion}).${changelogSnippet}\n\nRun \`npm run update\` to upgrade, or check Settings → Jarvis Inc Versions.`,
        },
        priority: 4,
      });
    } else {
      await logAudit('CEO', 'VERSION_CHECK', `Version check: v${localVersion} is up to date`, 'info');
    }
  } catch (err) {
    console.warn('[CEODecisionEngine] Version check failed:', err);
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Agent brain check — offer to draft brain prompts for agents without one
// ---------------------------------------------------------------------------

async function checkAgentBrains(agents: AgentRow[]): Promise<CEOAction[]> {
  const actions: CEOAction[] = [];

  // Find non-CEO agents with no system_prompt in metadata
  const brainless = agents.filter(a => {
    const meta = a.metadata as Record<string, unknown> | null;
    return !meta?.system_prompt || (typeof meta.system_prompt === 'string' && meta.system_prompt.trim().length === 0);
  });

  if (brainless.length === 0) return actions;

  // Only nag about the first brainless agent to avoid spam
  const agent = brainless[0];
  actions.push({
    id: makeActionId(),
    action_type: 'request_approval',
    payload: {
      topic: `agent_brain_setup_${agent.id}`,
      message: `Agent **${agent.name}** has no brain prompt configured yet. Want me to draft a system prompt for their role as ${agent.role}?`,
      navigateTo: '/surveillance',
      agent_id: agent.id,
      agent_name: agent.name,
      agent_role: agent.role,
    },
    priority: 6,
  });

  return actions;
}

// ---------------------------------------------------------------------------
// Vault signing key check — remind founder to sync key for sidecar signing
// ---------------------------------------------------------------------------

let lastVaultKeyCheckTime = 0;
const VAULT_KEY_CHECK_INTERVAL = 6 * ONE_HOUR_MS; // throttle: once per 6 hours

async function checkVaultSigningKey(): Promise<CEOAction[]> {
  const now = Date.now();
  if (now - lastVaultKeyCheckTime < VAULT_KEY_CHECK_INTERVAL) return [];
  lastVaultKeyCheckTime = now;

  try {
    // Check if there's a key in vault
    const entry = await getVaultEntryByService('marketplace-signing');
    if (entry) return []; // Key present — all good

    // Check if marketplace is even registered
    const registered = await getSetting('marketplace_registered');
    if (!registered) return []; // Not registered — no point reminding

    // No key in vault but registered — CEO should remind founder
    return [{
      id: makeActionId(),
      action_type: 'needs_attention',
      payload: {
        topic: 'vault_signing_key_missing',
        message: 'Your marketplace signing key isn\'t synced to the vault yet — I can\'t sign forum posts or engage on the marketplace without it. Head to Settings, unlock your signing key, and hit "SYNC KEY TO VAULT".',
        navigateTo: '/settings',
      },
      priority: 2,
    }];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main evaluation
// ---------------------------------------------------------------------------

export async function evaluateCycle(): Promise<CycleResult> {
  // 0. Skip evaluation until CEO onboarding meeting is complete
  const meetingDone = await getSetting('ceo_meeting_done');
  if (!meetingDone) {
    return { timestamp: new Date().toISOString(), actions: [], checks: {} };
  }

  // 1. Load current org state
  const [agents, missions, skills, approvals, ceo] = await Promise.all([
    loadAgents(),
    loadMissions(),
    loadSkills(),
    loadApprovals(),
    loadCEO(),
  ]);

  // Build a set of agent IDs that are assigned to active missions
  const activeMissionAssignees = new Set<string>();
  for (const m of missions) {
    if ((m.status === 'active' || m.status === 'in_progress') && m.assignee) {
      activeMissionAssignees.add(m.assignee);
    }
  }

  // 2. Budget gate — soft cap pauses task dispatch, hard cap (110%) stops everything
  const budgetResult = await checkBudget();
  const allActions: CEOAction[] = [...budgetResult.actions];

  if (budgetResult.hardStop) {
    // Hard stop (110%+) — only monitoring, no dispatch, no recurring
    const stuckActions = await checkStuckTasks();
    allActions.push(...stuckActions);
    allActions.push(...checkStaleApprovals(approvals));
  } else if (budgetResult.paused) {
    // Soft pause (100-110%) — monitoring + recurring (on_hold) but no task dispatch
    const stuckActions = await checkStuckTasks();
    allActions.push(...stuckActions);
    allActions.push(...checkStaleApprovals(approvals));
    // Recurring missions still fire but land as on_hold
    const recurringActions = await checkRecurringMissions(true);
    allActions.push(...recurringActions);
    // Scheduled missions still activate (they were pre-approved)
    const scheduledActions = await checkScheduledMissions();
    allActions.push(...scheduledActions);
    // Skill schedules — pre-approved maintenance, still fire when budget soft-paused
    const skillScheduleActions = await checkSkillSchedules();
    allActions.push(...skillScheduleActions);
  } else {
    // Normal full evaluation
    const stuckActions = await checkStuckTasks();
    allActions.push(
      ...stuckActions,
      ...checkUnassignedMissions(missions, agents, activeMissionAssignees),
      ...checkIdleAgents(agents, activeMissionAssignees),
      ...checkStaleApprovals(approvals),
      ...(await checkSmartHire(agents, missions, skills)),
      ...checkSkillsGap(missions, skills),
    );

    // Agent brain check — offer to draft prompts for brainless agents
    const brainActions = await checkAgentBrains(agents);
    allActions.push(...brainActions);

    // Recurring missions — normal dispatch
    const recurringActions = await checkRecurringMissions(false);
    allActions.push(...recurringActions);

    // Scheduled missions — activate when due
    const scheduledActions = await checkScheduledMissions();
    allActions.push(...scheduledActions);

    // Skill schedules — run skills on their configured schedules
    const skillScheduleActions = await checkSkillSchedules();
    allActions.push(...skillScheduleActions);

    // Forum activity — check for new posts to engage with
    const forumActions = await checkForumActivity();
    allActions.push(...forumActions);
  }

  // 2b. Vault signing key check — runs regardless of budget state
  const vaultKeyActions = await checkVaultSigningKey();
  allActions.push(...vaultKeyActions);

  // 3. Insert produced actions into ceo_action_queue (deduplicated)
  if (allActions.length > 0) {
    try {
      // Fetch existing pending OR recently dismissed/seen action topics to avoid duplicates
      // Cool-down: don't re-insert a dismissed topic for 2 hours
      const cooldownCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await getSupabase()
        .from('ceo_action_queue')
        .select('payload, status')
        .in('status', ['pending', 'seen', 'dismissed'])
        .gte('created_at', cooldownCutoff);

      const existingTopics = new Set(
        (existing ?? []).map((e) => (e.payload as Record<string, unknown>)?.topic as string).filter(Boolean),
      );

      // Only insert actions whose topic doesn't already have a pending entry
      const newActions = allActions.filter((a) => {
        const topic = a.payload.topic as string | undefined;
        if (!topic) return true; // no topic = always insert
        if (existingTopics.has(topic)) return false; // duplicate
        existingTopics.add(topic); // prevent dups within same batch
        return true;
      });

      if (newActions.length > 0) {
        const rows = newActions.map((a) => ({
          id: a.id,
          action_type: a.action_type,
          payload: a.payload,
          status: 'pending',
          priority: a.priority,
          created_at: new Date().toISOString(),
        }));
        await getSupabase().from('ceo_action_queue').insert(rows);
      }
    } catch (err) {
      console.error('[CEODecisionEngine] Failed to insert actions:', err);
    }
  }

  // 3b. Prune old dismissed/seen entries (keep queue lean)
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours
    await getSupabase()
      .from('ceo_action_queue')
      .delete()
      .in('status', ['dismissed', 'seen'])
      .lt('created_at', cutoff);
  } catch { /* ignore prune errors */ }

  // 4. Sync skills from repo if stale (throttled: once per hour)
  const now = Date.now();
  if (now - lastSkillSyncTime > ONE_HOUR_MS) {
    lastSkillSyncTime = now;
    seedSkillsFromRepo().catch((err) =>
      console.warn('[CEODecisionEngine] Skill sync failed:', err),
    );
  }

  // 4b. Daily memory consolidation (once per day, first tick of new day)
  const todayStr = new Date().toISOString().slice(0, 10);
  if (todayStr !== lastConsolidationDate) {
    lastConsolidationDate = todayStr;
    consolidateDailyMemories().catch(err =>
      console.warn('[CEODecisionEngine] Memory consolidation failed:', err),
    );
  }

  // 4c. Daily marketplace profile refresh (sync agent count, skills, mission)
  if (todayStr !== lastProfileRefreshDate) {
    lastProfileRefreshDate = todayStr;
    refreshMarketplaceProfile()
      .then(() => console.log('[CEODecisionEngine] Daily marketplace profile refresh done.'))
      .catch(err => console.warn('[CEODecisionEngine] Marketplace profile refresh failed:', err));
  }

  // 4d. Peer instance check (marketplace peers — every 4 hours)
  checkPeerInstances().catch(err =>
    console.warn('[CEODecisionEngine] Peer check failed:', err),
  );

  // 4e. Auto-update check (every 6 hours — notifies founder if new version available)
  try {
    const updateActions = await checkForUpdates();
    allActions.push(...updateActions);
  } catch (err) {
    console.warn('[CEODecisionEngine] Update check failed:', err);
  }

  // 4f. Telegram approval polling (checks for callback_query responses)
  try {
    const { checkTelegramCallbacks } = await import('./telegramApprovals');
    const telegramResult = await checkTelegramCallbacks();
    if (telegramResult.resolved > 0) {
      allActions.push({
        id: `telegram-${Date.now()}`,
        action_type: 'send_message',
        payload: {
          topic: 'telegram_approvals',
          message: `Resolved ${telegramResult.resolved} approval(s) via Telegram.`,
        },
        priority: 3,
      });
    }
  } catch (err) {
    console.warn('[CEODecisionEngine] Telegram polling failed:', err);
  }

  // 5. Marketplace heartbeat (fire-and-forget, keeps instance "online")
  try {
    const { sendHeartbeat } = await import('./marketplaceClient');
    sendHeartbeat(); // intentionally not awaited
  } catch { /* silent */ }

  // 6. Build diagnostic result
  const result: CycleResult = {
    timestamp: new Date().toISOString(),
    actions: allActions,
    checks: {
      agentCount: agents.length,
      missionCount: missions.length,
      activeMissions: missions.filter((m) => m.status === 'active' || m.status === 'in_progress').length,
      enabledSkills: skills.filter((s) => s.enabled).length,
      pendingApprovals: approvals.filter((a) => a.status === 'pending').length,
      ceoStatus: ceo?.status ?? 'not_initialized',
      actionsProduced: allActions.length,
    },
  };

  return result;
}
