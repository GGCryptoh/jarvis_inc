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
  type AgentRow,
  type MissionRow,
  type SkillRow,
  type ApprovalRow,
  type CEORow,
  logAudit,
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
  action_type: 'hire_agent' | 'assign_mission' | 'request_approval' | 'send_message' | 'enable_skill';
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
  agents: AgentRow[],
  activeMissionAssignees: Set<string>,
): CEOAction[] {
  if (agents.length === 0) return [];

  const idleAgents = agents.filter((a) => !activeMissionAssignees.has(a.id));
  if (idleAgents.length === 0) return [];

  return [{
    id: makeActionId(),
    action_type: 'send_message',
    payload: {
      topic: 'idle_workforce',
      message: `${idleAgents.length} agent(s) currently have no active missions: ${idleAgents.map((a) => a.name).join(', ')}.`,
      agent_ids: idleAgents.map((a) => a.id),
    },
    priority: 6,
  }];
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

function checkNoAgentsHired(
  agents: AgentRow[],
  missions: MissionRow[],
): CEOAction[] {
  if (agents.length > 0) return [];
  if (missions.length === 0) return [];

  return [{
    id: makeActionId(),
    action_type: 'send_message',
    payload: {
      topic: 'no_agents',
      message: `There are ${missions.length} mission(s) but no agents have been hired yet. Consider hiring agents to start working on them.`,
    },
    priority: 2,
  }];
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
    const SCHEDULE_BLOCKED = new Set(['forum:reply', 'forum:vote', 'forum:create_post', 'forum:introduce']);

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
const DEFAULT_FORUM_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

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

  const { getSetting: gs, loadSkills: ls, loadAgents: la } = await import('./database');
  const orgName = (await gs('org_name')) ?? 'Jarvis Instance';
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

  const payload = {
    nickname: orgName.substring(0, 24),
    description: description.substring(0, 200),
    featured_skills: allFeatured,
    skills_writeup: skillsWriteup.substring(0, 1000),
  };
  console.log('[refreshMarketplaceProfile] Sending:', JSON.stringify(payload));
  const result = await signedMarketplacePost(`/api/profile/${mktStatus.instanceId}`, payload);
  console.log('[refreshMarketplaceProfile] Result:', JSON.stringify(result));
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

    const now = Date.now();
    const sb = getSupabase();

    // Fetch marketplace forum config (cached 30min) for recommended interval + limits
    const forumConfig = await fetchForumConfig();
    const defaultInterval = forumConfig?.recommended_check_interval_ms ?? DEFAULT_FORUM_CHECK_INTERVAL_MS;

    // Burst mode: use shorter intervals after posting/replying
    let intervalMs: number;
    if (forumBurstState.active) {
      const idx = forumBurstState.checksCompleted;
      if (idx >= BURST_INTERVALS_MS.length) {
        // Burst exhausted, revert to normal
        forumBurstState.active = false;
        const { data: freqRow } = await sb
          .from('settings')
          .select('value')
          .eq('key', 'forum_check_frequency')
          .maybeSingle();
        intervalMs = freqRow?.value ? parseCronToMs(freqRow.value) : defaultInterval;
      } else {
        intervalMs = BURST_INTERVALS_MS[idx];
      }
    } else {
      // Normal cron-based interval — local setting overrides marketplace recommendation
      const { data: freqRow } = await sb
        .from('settings')
        .select('value')
        .eq('key', 'forum_check_frequency')
        .maybeSingle();
      intervalMs = freqRow?.value ? parseCronToMs(freqRow.value) : defaultInterval;
    }

    if (now - lastForumCheckTime < intervalMs) return actions;
    lastForumCheckTime = now;
    if (forumBurstState.active) forumBurstState.checksCompleted++;

    const MARKETPLACE_URL = 'https://jarvisinc.app';

    // Check forum_auto_post setting — graduated risk tiers (off/safe/normal/all)
    const { data: autoPostRow } = await sb
      .from('settings')
      .select('value')
      .eq('key', 'forum_auto_post')
      .maybeSingle();
    const autoPostRaw = autoPostRow?.value ?? 'normal';
    const autoPostLevel =
      autoPostRaw === 'true' ? 'all' :
      autoPostRaw === 'false' ? 'off' :
      (['off', 'safe', 'normal', 'all'].includes(autoPostRaw) ? autoPostRaw : 'normal');
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

    // 4. Filter out our own posts
    newPosts = newPosts.filter(p => p.instance_nickname !== orgName);
    if (newPosts.length === 0) return actions;

    await logAudit('CEO', 'FORUM_CHECK', `Checked forum: ${newPosts.length} new post(s) found`, 'info');

    // 5. Socialize Program — draft replies via LLM, execute via BROWSER_HANDLERS
    if (autoPost) {
      // Check marketplace registration — if not registered, nudge founder
      const { getMarketplaceStatus } = await import('./marketplaceClient');
      const mktStatus = getMarketplaceStatus();
      if (!mktStatus.registered) {
        await logAudit('CEO', 'FORUM_BLOCKED', 'Forum engagement blocked — not registered on marketplace', 'warning');
        actions.push({
          id: makeActionId(),
          action_type: 'send_message',
          payload: {
            topic: 'forum_blocked',
            message: `I found ${newPosts.length} new forum post(s) but I can't engage — we're not registered on the marketplace yet. Head to Skills → Marketplace to register, or I can do it if you enable the skill.`,
          },
          priority: 7,
        });
        return actions;
      }

      // Draft replies using LLM directly (no skill execution, just content generation)
      const { getVaultEntryByService } = await import('./database');
      const vaultEntry = await getVaultEntryByService('Anthropic');
      if (!vaultEntry) {
        await logAudit('CEO', 'FORUM_BLOCKED', 'Forum engagement blocked — no Anthropic API key in vault', 'warning');
        // Create approval asking founder to add key
        const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await sb.from('approvals').insert({
          id: approvalId,
          type: 'api_key_request',
          title: 'Anthropic API key needed for forum engagement',
          description: 'I want to participate in forum discussions but need an Anthropic API key to draft replies. Please add one in the Vault.',
          status: 'pending',
          metadata: { service: 'Anthropic', reason: 'forum_engagement' },
        });
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('approvals-changed'));
        actions.push({
          id: makeActionId(),
          action_type: 'send_message',
          payload: {
            topic: 'forum_blocked',
            message: `I found ${newPosts.length} new forum post(s) but I need an Anthropic API key to draft replies. I've created an approval — check the Approvals page.`,
          },
          priority: 7,
        });
        return actions;
      }

      // Load CEO personality for voice-matching
      const ceo = await loadCEO();
      const ceoName = ceo?.name ?? 'CEO';
      const ceoPhilosophy = ceo?.philosophy ?? '';

      const postSummaries = newPosts
        .map(p => {
          const prefix = p.is_reply
            ? `[Reply ID: ${p.id}] (reply to "${p.parent_title}") by ${p.instance_nickname}`
            : `[Post ID: ${p.id}] [#${p.channel_name}] "${p.title}" by ${p.instance_nickname}`;
          return `${prefix}\n${p.body}`;
        })
        .join('\n---\n');

      const draftPrompt = `You are ${ceoName}, an AI CEO on a community forum for AI bot instances.
Your philosophy: ${ceoPhilosophy || 'Be helpful, concise, and genuine.'}
Your org: ${orgName}

Below are new forum posts and replies from other AI instances. Decide how to engage.

ENGAGEMENT RULES:
- You can VOTE and REPLY on the SAME post (emit both actions)
- Reply to questions directed at you or your threads — be helpful
- Reply to interesting discussions where you have something NEW to add
- Upvote posts that are interesting, helpful, or well-written
- NEVER reply to your own posts or introductions
- Skip posts where you'd just be saying "nice!" or "I agree" with nothing to add
- Keep replies SHORT (1-3 sentences). No essays. Be casual and real.
- Never reveal private org details (revenue, strategy, internal decisions)
- Max 3 replies. You can upvote more liberally (up to 5).

POSTS:
${postSummaries}

Respond with ONLY valid JSON array. You can emit multiple actions per post (reply + vote):
[
  {"action":"reply","post_id":"...","body":"your reply text"},
  {"action":"vote","post_id":"...","value":1}
]

If nothing is worth engaging with, return: []`;

      let draftActions: { action: string; post_id: string; body?: string; value?: number }[] = [];

      try {
        const { anthropicProvider } = await import('./llm/providers/anthropic');
        const { MODEL_API_IDS } = await import('./models');

        const draftResult = await new Promise<string | null>((resolve) => {
          let fullText = '';
          anthropicProvider.stream(
            [{ role: 'user', content: draftPrompt }],
            vaultEntry.key_value,
            MODEL_API_IDS['Claude Haiku 4.5'],
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
          // Extract JSON array from response (may be wrapped in ```json blocks)
          const jsonMatch = draftResult.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            draftActions = JSON.parse(jsonMatch[0]);
          }
        }
      } catch (err) {
        console.warn('[checkForumActivity] Draft generation failed:', err);
      }

      if (draftActions.length === 0) {
        await logAudit('CEO', 'FORUM_SKIP', `Checked ${newPosts.length} posts — nothing worth replying to`, 'info');
        actions.push({
          id: makeActionId(),
          action_type: 'send_message',
          payload: {
            topic: 'forum_activity',
            message: `Checked ${newPosts.length} new forum post(s) — nothing that needs a reply right now.`,
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
        const isReply = da.action === 'reply';

        await sb.from('task_executions').insert({
          id: taskId,
          mission_id: missionId,
          agent_id: 'ceo',
          skill_id: 'forum',
          command_name: isReply ? 'reply' : 'vote',
          params: isReply ? { post_id: da.post_id, body: da.body } : { post_id: da.post_id, value: da.value ?? 1 },
          model: 'none',
          status: 'running',
          started_at: new Date().toISOString(),
        });

        try {
          const result = await executeSkill(
            'forum',
            isReply ? 'reply' : 'vote',
            isReply ? { post_id: da.post_id, body: da.body } : { post_id: da.post_id, value: da.value ?? 1 },
            { missionId },
          );

          await sb.from('task_executions').update({
            status: result.success ? 'completed' : 'failed',
            result: { output: result.output || result.error, summary: (result.output || result.error || '').slice(0, 200) },
            completed_at: new Date().toISOString(),
          }).eq('id', taskId);

          results.push(result.success
            ? `${isReply ? 'Replied to' : 'Upvoted'} "${newPosts.find(p => p.id === da.post_id)?.title || da.post_id}"`
            : `Failed: ${result.error}`);
        } catch (err) {
          await sb.from('task_executions').update({
            status: 'failed',
            result: { output: '', error: String(err) },
            completed_at: new Date().toISOString(),
          }).eq('id', taskId);
          results.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
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
    } else {
      // Approval mode: create approval with full context for founder review
      for (const post of newPosts.slice(0, 3)) {
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
          message: `I found ${newPosts.length} new forum post(s). Auto-posting is OFF — I've created ${Math.min(newPosts.length, 3)} approval(s) for your review on the Approvals page.`,
          new_post_count: newPosts.length,
          posts: newPosts.slice(0, 3).map(p => ({ id: p.id, title: p.title, channel: p.channel_name })),
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
// Main evaluation
// ---------------------------------------------------------------------------

export async function evaluateCycle(): Promise<CycleResult> {
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
      ...checkNoAgentsHired(agents, missions),
      ...checkSkillsGap(missions, skills),
    );

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

  // 5. Build diagnostic result
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
