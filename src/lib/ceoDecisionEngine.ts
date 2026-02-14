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
  type AgentRow,
  type MissionRow,
  type SkillRow,
  type ApprovalRow,
  type CEORow,
} from './database';
import { seedSkillsFromRepo } from './skillResolver';
import { synthesizeMissionSummary } from './taskDispatcher';

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
      .select('id, mission_id, skill_id, status, created_at')
      .in('status', ['pending', 'running'])
      .lt('created_at', cutoff);

    if (!stuckTasks || stuckTasks.length === 0) return actions;

    // Group by mission
    const byMission = new Map<string, typeof stuckTasks>();
    for (const task of stuckTasks) {
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
          window.dispatchEvent(new Event('chat-messages-changed'));
        }

        window.dispatchEvent(new Event('missions-changed'));
        window.dispatchEvent(new Event('task-executions-changed'));
      }
    }
  } catch (err) {
    console.warn('[CEODecisionEngine] Stuck task check failed:', err);
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

  // 2. Run heuristic checks
  const stuckActions = await checkStuckTasks();
  const allActions: CEOAction[] = [
    ...stuckActions,
    ...checkUnassignedMissions(missions, agents, activeMissionAssignees),
    ...checkIdleAgents(agents, activeMissionAssignees),
    ...checkStaleApprovals(approvals),
    ...checkNoAgentsHired(agents, missions),
    ...checkSkillsGap(missions, skills),
  ];

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
