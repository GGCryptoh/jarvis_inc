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
  const allActions: CEOAction[] = [
    ...checkUnassignedMissions(missions, agents, activeMissionAssignees),
    ...checkIdleAgents(agents, activeMissionAssignees),
    ...checkStaleApprovals(approvals),
    ...checkNoAgentsHired(agents, missions),
    ...checkSkillsGap(missions, skills),
  ];

  // 3. Insert produced actions into ceo_action_queue
  if (allActions.length > 0) {
    const rows = allActions.map((a) => ({
      id: a.id,
      action_type: a.action_type,
      payload: a.payload,
      status: 'pending',
      priority: a.priority,
      created_at: new Date().toISOString(),
    }));

    try {
      await getSupabase().from('ceo_action_queue').insert(rows);
    } catch (err) {
      console.error('[CEODecisionEngine] Failed to insert actions:', err);
    }
  }

  // 4. Build diagnostic result
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
