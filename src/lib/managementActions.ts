/**
 * Management Actions — CEO Full Command Authority
 * =================================================
 * 11 handler functions that let the CEO autonomously manage missions,
 * agents, budget, and approvals via structured action objects.
 *
 * Each handler:
 *  - Performs the DB mutation(s)
 *  - Posts a chat message with metadata type for UI rendering
 *  - Dispatches window events for cross-component sync
 *  - Logs to audit
 *  - Returns ActionResult { success, message, metadata? }
 */

import {
  saveAgent,
  deleteAgent,
  loadAgents,
  loadCEO,
  loadMissions,
  saveMission,
  updateMission,
  updateMissionStatus,
  saveChatMessage,
  saveApproval,
  logAudit,
  assignSkillToAgent,
  removeSkillFromAgent,
} from './database';
import { getRoomTier, TIER_DESK_PRESETS } from './positionGenerator';
import { getSupabase } from './supabase';

// ---------------------------------------------------------------------------
// Constants — mirrors HireAgentModal.tsx palettes
// ---------------------------------------------------------------------------

const COLOR_PALETTE = [
  '#ff6b9d', '#50fa7b', '#bd93f9', '#ffb86c', '#8be9fd',
  '#f1fa8c', '#ff5555', '#6272a4', '#ff79c6', '#f8f8f2',
];

const SKIN_TONES = [
  '#ffcc99', '#f0b88a', '#e8a872', '#c8956c', '#a0704e', '#6b4226',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Safely dispatch a window event (no-op in Node/sidecar). */
function dispatchEvent(event: Event): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(event);
  }
}

/** Resolve a mission ID from either a direct ID or a fuzzy title match.
 *  Handles CEO-hallucinated IDs that don't match our `mission-*` format. */
async function resolveMissionId(
  rawId: string | undefined,
  title: string | undefined,
): Promise<string | null> {
  if (rawId?.startsWith('mission-')) {
    return rawId; // Looks like a real ID
  }

  const missions = await loadMissions();

  // If rawId was provided but doesn't match format, try it as title text
  if (rawId) {
    const match = missions.find(
      m => m.id === rawId
        || (m.status !== 'cancelled' && m.status !== 'done'
          && m.title.toLowerCase().includes(rawId.toLowerCase())),
    );
    if (match) return match.id;
  }

  // Fall back to explicit title param
  if (title) {
    const match = missions.find(
      m => m.status !== 'cancelled' && m.status !== 'done'
        && m.title.toLowerCase().includes(title.toLowerCase()),
    );
    if (match) return match.id;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionResult {
  success: boolean;
  message: string;
  metadata?: Record<string, unknown>;
}

type ActionHandler = (
  args: Record<string, unknown>,
  conversationId?: string,
) => Promise<ActionResult>;

// ---------------------------------------------------------------------------
// Action registry
// ---------------------------------------------------------------------------

export const MANAGEMENT_ACTIONS = new Set<string>([
  'create_mission',
  'schedule_mission',
  'create_recurring_mission',
  'cancel_mission',
  'reassign_mission',
  'update_mission',
  'hire_agent',
  'fire_agent',
  'update_agent_skills',
  'request_budget_extension',
  'create_approval',
  'create_skill',
]);

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  create_mission: handleCreateMission,
  schedule_mission: handleScheduleMission,
  create_recurring_mission: handleCreateRecurringMission,
  cancel_mission: handleCancelMission,
  reassign_mission: handleReassignMission,
  update_mission: handleUpdateMission,
  hire_agent: handleHireAgent,
  fire_agent: handleFireAgent,
  update_agent_skills: handleUpdateAgentSkills,
  request_budget_extension: handleRequestBudgetExtension,
  create_approval: handleCreateApproval,
  create_skill: handleCreateSkill,
};

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function handleManagementAction(
  actionName: string,
  args: Record<string, unknown>,
  conversationId?: string,
): Promise<ActionResult> {
  const handler = ACTION_HANDLERS[actionName];
  if (!handler) {
    return { success: false, message: `Unknown management action: ${actionName}` };
  }

  try {
    const result = await handler(args, conversationId);

    // Audit every management action
    const ceo = await loadCEO();
    await logAudit(
      ceo?.name ?? 'CEO',
      `MGMT_${actionName.toUpperCase()}`,
      result.message,
      result.success ? 'info' : 'warning',
    );

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAudit('CEO', `MGMT_${actionName.toUpperCase()}_ERROR`, message, 'error');
    return { success: false, message: `Action ${actionName} failed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// Chat message helper
// ---------------------------------------------------------------------------

async function postChatMessage(
  conversationId: string | undefined,
  text: string,
  metadataType: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!conversationId) return;
  await saveChatMessage({
    id: makeId('msg'),
    conversation_id: conversationId,
    sender: 'ceo',
    text,
    metadata: { type: metadataType, ...extra },
  });
  dispatchEvent(new Event('chat-messages-changed'));
}

// ===========================================================================
// MISSION HANDLERS
// ===========================================================================

async function handleCreateMission(
  args: Record<string, unknown>,
  conversationId?: string,
): Promise<ActionResult> {
  const title = args.title as string | undefined;
  if (!title?.trim()) {
    return { success: false, message: 'Mission title is required.' };
  }

  const missionId = makeId('mission');
  const priority = (args.priority as string) ?? 'medium';
  const assignee = (args.assignee as string) ?? null;

  await saveMission({
    id: missionId,
    title: title.trim(),
    status: 'backlog',
    assignee,
    priority,
    created_by: 'ceo',
  });

  dispatchEvent(new Event('missions-changed'));

  await postChatMessage(conversationId, `Created mission: **${title.trim()}** [${priority}]`, 'mission_created', {
    mission_id: missionId,
    priority,
    assignee,
  });

  return {
    success: true,
    message: `Mission "${title.trim()}" created.`,
    metadata: { mission_id: missionId },
  };
}

async function handleScheduleMission(
  args: Record<string, unknown>,
  conversationId?: string,
): Promise<ActionResult> {
  const title = args.title as string | undefined;
  if (!title?.trim()) {
    return { success: false, message: 'Mission title is required.' };
  }

  const scheduledFor = args.scheduled_for as string | undefined;
  if (!scheduledFor) {
    return { success: false, message: 'scheduled_for date is required.' };
  }

  const trimmedTitle = title.trim();
  const priority = (args.priority as string) ?? 'medium';
  const assignee = (args.assignee as string) ?? null;

  // Dedup: check for existing scheduled mission with the same title (case-insensitive)
  const existingMissions = await loadMissions();
  const duplicate = existingMissions.find(
    m => m.status === 'scheduled' && m.title.trim().toLowerCase() === trimmedTitle.toLowerCase(),
  );

  if (duplicate) {
    // Update the existing mission's scheduled_for instead of creating a new one
    await getSupabase()
      .from('missions')
      .update({ scheduled_for: scheduledFor })
      .eq('id', duplicate.id);

    dispatchEvent(new Event('missions-changed'));

    await postChatMessage(conversationId, `Updated scheduled time for: **${trimmedTitle}** → ${scheduledFor}`, 'mission_scheduled', {
      mission_id: duplicate.id,
      scheduled_for: scheduledFor,
      priority: duplicate.priority,
      updated: true,
    });

    return {
      success: true,
      message: `Updated scheduled time for: "${trimmedTitle}" → ${scheduledFor}.`,
      metadata: { mission_id: duplicate.id, scheduled_for: scheduledFor, updated: true },
    };
  }

  const missionId = makeId('mission');

  await saveMission({
    id: missionId,
    title: trimmedTitle,
    status: 'scheduled',
    assignee,
    priority,
    created_by: 'ceo',
  });

  // Set scheduled_for via direct Supabase update (saveMission doesn't pass it through)
  await getSupabase()
    .from('missions')
    .update({ scheduled_for: scheduledFor })
    .eq('id', missionId);

  dispatchEvent(new Event('missions-changed'));

  await postChatMessage(conversationId, `Scheduled mission: **${trimmedTitle}** for ${scheduledFor}`, 'mission_scheduled', {
    mission_id: missionId,
    scheduled_for: scheduledFor,
    priority,
  });

  return {
    success: true,
    message: `Mission "${trimmedTitle}" scheduled for ${scheduledFor}.`,
    metadata: { mission_id: missionId, scheduled_for: scheduledFor },
  };
}

async function handleCreateRecurringMission(
  args: Record<string, unknown>,
  conversationId?: string,
): Promise<ActionResult> {
  const title = args.title as string | undefined;
  if (!title?.trim()) {
    return { success: false, message: 'Mission title is required.' };
  }

  const cron = args.cron as string | undefined;
  if (!cron) {
    return { success: false, message: 'Cron expression is required for recurring missions.' };
  }

  // Validate cron has 5 fields
  const cronParts = cron.trim().split(/\s+/);
  if (cronParts.length !== 5) {
    return { success: false, message: `Invalid cron expression: "${cron}". Must have 5 fields: minute hour day-of-month month day-of-week.` };
  }

  const trimmedTitle = title.trim();
  const priority = (args.priority as string) ?? 'medium';
  const assignee = (args.assignee as string) ?? null;
  const recurringMode = (args.recurring_mode as string) ?? 'auto';

  // Parse max_runs: optional positive integer cap on how many times this recurs
  const rawMaxRuns = args.max_runs;
  const maxRuns = rawMaxRuns != null ? Number(rawMaxRuns) : null;
  if (maxRuns !== null && (!Number.isInteger(maxRuns) || maxRuns < 1)) {
    return { success: false, message: 'max_runs must be a positive integer.' };
  }

  // Dedup: check for existing recurring mission with same title (cancel old, create new)
  const existingMissions = await loadMissions();
  const duplicate = existingMissions.find(
    m => m.status === 'scheduled' && !!m.recurring && m.title.trim().toLowerCase() === trimmedTitle.toLowerCase(),
  );

  if (duplicate) {
    // Cancel the old one, proceed with new
    await updateMissionStatus(duplicate.id, 'cancelled');
    await logAudit('CEO', 'RECURRING_REPLACED', `Replaced recurring "${duplicate.title}" (${duplicate.recurring}) with new cron: ${cron}`, 'info');
    await postChatMessage(conversationId, `Replaced existing recurring mission: **${duplicate.title}** (was: \`${duplicate.recurring}\`) → now: \`${cron}\``, 'mission_recurring_replaced', { old_id: duplicate.id, old_cron: duplicate.recurring });
  }

  const missionId = makeId('mission');

  await saveMission({
    id: missionId,
    title: trimmedTitle,
    status: 'scheduled',
    assignee,
    priority,
    recurring: cron,
    recurring_mode: recurringMode,
    created_by: 'ceo',
    max_runs: maxRuns,
    run_count: 0,
  });

  dispatchEvent(new Event('missions-changed'));

  const maxRunsLabel = maxRuns != null ? ` (${maxRuns} runs)` : '';
  await postChatMessage(conversationId, `Created recurring mission: **${trimmedTitle}** [${cron}]${maxRunsLabel}`, 'mission_recurring', {
    mission_id: missionId,
    cron,
    recurring_mode: recurringMode,
    max_runs: maxRuns,
  });

  return {
    success: true,
    message: `Recurring mission "${trimmedTitle}" created with cron: ${cron}${maxRunsLabel}.`,
    metadata: { mission_id: missionId, cron, recurring_mode: recurringMode, max_runs: maxRuns },
  };
}

async function handleCancelMission(
  args: Record<string, unknown>,
  conversationId?: string,
): Promise<ActionResult> {
  const missionId = await resolveMissionId(args.mission_id as string | undefined, args.title as string | undefined);
  if (!missionId) {
    return { success: false, message: 'mission_id or title is required (mission not found).' };
  }

  // Fail pending task_executions for this mission
  await getSupabase()
    .from('task_executions')
    .update({ status: 'failed', result: { error: 'Mission cancelled by CEO' } })
    .eq('mission_id', missionId)
    .in('status', ['pending', 'running']);

  // Cancel the mission
  await updateMissionStatus(missionId, 'cancelled');

  dispatchEvent(new Event('missions-changed'));

  await postChatMessage(conversationId, `Cancelled mission \`${missionId}\`.`, 'mission_cancelled', {
    mission_id: missionId,
  });

  return {
    success: true,
    message: `Mission ${missionId} cancelled.`,
    metadata: { mission_id: missionId },
  };
}

async function handleReassignMission(
  args: Record<string, unknown>,
  conversationId?: string,
): Promise<ActionResult> {
  const missionId = await resolveMissionId(args.mission_id as string | undefined, args.title as string | undefined);
  const newAssignee = args.assignee as string | undefined;
  if (!missionId) {
    return { success: false, message: 'mission_id or title is required (mission not found).' };
  }
  if (!newAssignee) {
    return { success: false, message: 'assignee is required.' };
  }

  await updateMission(missionId, { assignee: newAssignee });

  // Update pending task_executions to the new agent
  await getSupabase()
    .from('task_executions')
    .update({ agent_id: newAssignee })
    .eq('mission_id', missionId)
    .in('status', ['pending']);

  dispatchEvent(new Event('missions-changed'));

  await postChatMessage(conversationId, `Reassigned mission \`${missionId}\` to **${newAssignee}**.`, 'mission_updated', {
    mission_id: missionId,
    assignee: newAssignee,
  });

  return {
    success: true,
    message: `Mission ${missionId} reassigned to ${newAssignee}.`,
    metadata: { mission_id: missionId, assignee: newAssignee },
  };
}

async function handleUpdateMission(
  args: Record<string, unknown>,
  conversationId?: string,
): Promise<ActionResult> {
  const missionId = await resolveMissionId(args.mission_id as string | undefined, args.title as string | undefined);
  if (!missionId) {
    return { success: false, message: 'mission_id or title is required (mission not found).' };
  }

  const fields: Record<string, unknown> = {};
  if (args.priority !== undefined) fields.priority = args.priority as string;
  if (args.status !== undefined) fields.status = args.status as string;
  if (args.title !== undefined) fields.title = args.title as string;
  if (args.assignee !== undefined) fields.assignee = args.assignee as string;

  if (Object.keys(fields).length === 0) {
    return { success: false, message: 'No fields to update.' };
  }

  await updateMission(missionId, fields as Parameters<typeof updateMission>[1]);

  dispatchEvent(new Event('missions-changed'));

  const changes = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(', ');
  await postChatMessage(conversationId, `Updated mission \`${missionId}\`: ${changes}`, 'mission_updated', {
    mission_id: missionId,
    ...fields,
  });

  return {
    success: true,
    message: `Mission ${missionId} updated: ${changes}.`,
    metadata: { mission_id: missionId, ...fields },
  };
}

// ===========================================================================
// AGENT HANDLERS
// ===========================================================================

async function handleHireAgent(
  args: Record<string, unknown>,
  conversationId?: string,
): Promise<ActionResult> {
  const rawName = args.name as string | undefined;
  if (!rawName?.trim()) {
    return { success: false, message: 'Agent name is required.' };
  }

  const name = rawName.trim().toUpperCase().slice(0, 12);
  const role = (args.role as string) ?? 'General Agent';
  const model = (args.model as string) ?? 'Claude Opus 4.6';
  const color = randomFrom(COLOR_PALETTE);
  const skinTone = randomFrom(SKIN_TONES);
  const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Find next free desk position
  const agents = await loadAgents();
  const agentCount = agents.length;
  const tier = getRoomTier(agentCount + 1);
  const presets = TIER_DESK_PRESETS[tier];

  // Find first preset not occupied by an existing agent
  const occupiedPositions = new Set(
    agents.map(a => `${a.desk_x},${a.desk_y}`),
  );
  const freeDesk = presets.find(
    p => !occupiedPositions.has(`${p.x},${p.y}`),
  ) ?? presets[agentCount % presets.length];

  // Build metadata with optional system/user prompts
  const metadata: Record<string, unknown> = {};
  if (args.system_prompt) metadata.system_prompt = args.system_prompt;
  if (args.user_prompt) metadata.user_prompt = args.user_prompt;

  await saveAgent({
    id: agentId,
    name,
    role,
    color,
    skin_tone: skinTone,
    model,
    desk_x: freeDesk.x,
    desk_y: freeDesk.y,
    metadata,
  });

  // Assign skills if provided
  const skills = args.skills as string[] | undefined;
  if (skills && Array.isArray(skills)) {
    for (const skillId of skills) {
      await assignSkillToAgent(agentId, skillId, 'ceo');
    }
  }

  // Dispatch events for UI sync
  dispatchEvent(new Event('agents-changed'));
  dispatchEvent(new CustomEvent('agent-hired', {
    detail: { agentId, name, color, skinTone, deskX: freeDesk.x, deskY: freeDesk.y },
  }));

  await postChatMessage(conversationId, `Hired agent **${name}** as ${role}.`, 'agent_hired', {
    agent_id: agentId,
    name,
    role,
    model,
    color,
    skinTone,
    skills: skills ?? [],
  });

  await logAudit('CEO', 'AGENT_HIRED', `Hired ${name} (${agentId}) as ${role}`, 'info');

  return {
    success: true,
    message: `Agent ${name} hired as ${role}.`,
    metadata: { agent_id: agentId, name, role, color, skinTone, desk: freeDesk },
  };
}

async function handleFireAgent(
  args: Record<string, unknown>,
  conversationId?: string,
): Promise<ActionResult> {
  const agentId = args.agent_id as string | undefined;
  const agentName = args.agent_name as string | undefined;

  if (!agentId && !agentName) {
    return { success: false, message: 'agent_id or agent_name is required.' };
  }

  const agents = await loadAgents();
  const agent = agentId
    ? agents.find(a => a.id === agentId)
    : agents.find(a => a.name.toLowerCase() === agentName!.toLowerCase());

  if (!agent) {
    return { success: false, message: `Agent not found: ${agentId ?? agentName}` };
  }

  // Move their in_progress/backlog missions to backlog with null assignee
  const missions = await loadMissions();
  for (const m of missions) {
    if (m.assignee === agent.id && (m.status === 'in_progress' || m.status === 'backlog')) {
      await updateMission(m.id, { assignee: undefined, status: 'backlog' });
    }
  }

  // Fail pending/running task_executions
  await getSupabase()
    .from('task_executions')
    .update({ status: 'failed', result: { error: 'Agent fired' } })
    .eq('agent_id', agent.id)
    .in('status', ['pending', 'running']);

  // Delete the agent
  await deleteAgent(agent.id);

  dispatchEvent(new Event('agents-changed'));
  dispatchEvent(new Event('missions-changed'));

  await postChatMessage(conversationId, `Fired agent **${agent.name}**.`, 'agent_fired', {
    agent_id: agent.id,
    name: agent.name,
  });

  await logAudit('CEO', 'AGENT_FIRED', `Fired ${agent.name} (${agent.id})`, 'warning');

  return {
    success: true,
    message: `Agent ${agent.name} fired.`,
    metadata: { agent_id: agent.id, name: agent.name },
  };
}

async function handleUpdateAgentSkills(
  args: Record<string, unknown>,
  conversationId?: string,
): Promise<ActionResult> {
  const agentId = args.agent_id as string | undefined;
  if (!agentId) {
    return { success: false, message: 'agent_id is required.' };
  }

  const addSkills = (args.add as string[]) ?? [];
  const removeSkills = (args.remove as string[]) ?? [];

  if (addSkills.length === 0 && removeSkills.length === 0) {
    return { success: false, message: 'Provide skills to add or remove.' };
  }

  for (const skillId of addSkills) {
    await assignSkillToAgent(agentId, skillId, 'ceo');
  }
  for (const skillId of removeSkills) {
    await removeSkillFromAgent(agentId, skillId);
  }

  dispatchEvent(new Event('agents-changed'));

  const parts: string[] = [];
  if (addSkills.length > 0) parts.push(`added: ${addSkills.join(', ')}`);
  if (removeSkills.length > 0) parts.push(`removed: ${removeSkills.join(', ')}`);

  await postChatMessage(conversationId, `Updated skills for agent \`${agentId}\`: ${parts.join('; ')}.`, 'agent_skills_updated', {
    agent_id: agentId,
    added: addSkills,
    removed: removeSkills,
  });

  return {
    success: true,
    message: `Agent ${agentId} skills updated: ${parts.join('; ')}.`,
    metadata: { agent_id: agentId, added: addSkills, removed: removeSkills },
  };
}

// ===========================================================================
// BUDGET / APPROVAL HANDLERS
// ===========================================================================

async function handleRequestBudgetExtension(
  args: Record<string, unknown>,
  conversationId?: string,
): Promise<ActionResult> {
  const amount = args.amount as number | undefined;
  const reason = (args.reason as string) ?? 'Budget extension requested by CEO';

  if (amount === undefined || amount <= 0) {
    return { success: false, message: 'A positive amount is required.' };
  }

  const approvalId = makeId('approval');

  await saveApproval({
    id: approvalId,
    type: 'budget_override',
    title: `Budget Extension: $${amount.toFixed(2)}`,
    description: reason,
    status: 'pending',
    metadata: { amount, reason },
  });

  dispatchEvent(new Event('approvals-changed'));

  await postChatMessage(conversationId, `Requesting budget extension of **$${amount.toFixed(2)}**: ${reason}`, 'budget_request', {
    approval_id: approvalId,
    amount,
    reason,
  });

  return {
    success: true,
    message: `Budget extension request of $${amount.toFixed(2)} submitted.`,
    metadata: { approval_id: approvalId, amount },
  };
}

async function handleCreateApproval(
  args: Record<string, unknown>,
  conversationId?: string,
): Promise<ActionResult> {
  const type = (args.type as string) ?? 'general';
  const title = args.title as string | undefined;
  if (!title?.trim()) {
    return { success: false, message: 'Approval title is required.' };
  }

  const description = (args.description as string) ?? null;
  const metadata = (args.metadata as Record<string, unknown>) ?? null;
  const approvalId = makeId('approval');

  await saveApproval({
    id: approvalId,
    type,
    title: title.trim(),
    description,
    status: 'pending',
    metadata,
  });

  dispatchEvent(new Event('approvals-changed'));

  await postChatMessage(conversationId, `Created approval request: **${title.trim()}** [${type}]`, 'approval_request', {
    approval_id: approvalId,
    type,
  });

  return {
    success: true,
    message: `Approval "${title.trim()}" created.`,
    metadata: { approval_id: approvalId, type },
  };
}

// ===========================================================================
// SKILL FACTORY HANDLER
// ===========================================================================

async function handleCreateSkill(
  args: Record<string, unknown>,
  conversationId?: string,
): Promise<ActionResult> {
  const id = args.id as string;
  const title = args.title as string;
  const description = args.description as string;
  const category = (args.category as string) || 'creation';
  const commands = args.commands as Record<string, unknown>[] | undefined;
  const handlerCode = args.handler_code as string | undefined;
  const connectionType = (args.connection_type as string) || 'none';
  const systemPrompt = args.system_prompt as string | undefined;
  const model = (args.model as string) || 'claude-sonnet-4-5-20250929';

  if (!id || !title || !description) {
    return { success: false, message: 'Missing required fields: id, title, description' };
  }

  // Gate: Skill Factory must be enabled by the founder
  const sb = getSupabase();
  const { data: factorySkill } = await sb.from('skills').select('enabled').eq('id', 'skill-factory').single();
  if (!factorySkill?.enabled) {
    return { success: false, message: 'The Skill Factory skill is not enabled. Ask the founder to enable it in /skills first.' };
  }

  // Build skill definition (stored as JSONB in the `definition` column)
  const skillDefinition: Record<string, unknown> = {
    id,
    name: title,
    description,
    category,
    icon: args.icon || 'Zap',
    connection_type: connectionType,
    commands: commands || [],
    ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
  };

  // Build skill package files and install to gateway
  const packageFiles: { path: string; content: string }[] = [];

  if (handlerCode) {
    // Determine file extension from runtime
    const runtime = (args.runtime as string) || 'typescript';
    const ext = runtime === 'python' ? '.py' : runtime === 'bash' ? '.sh' : '.ts';
    const cmdName = Array.isArray(commands) && commands[0]?.name
      ? String(commands[0].name)
      : 'default';
    const handlerPath = `handlers/${cmdName}${ext}`;

    // Set handler_file on first command
    if (Array.isArray(commands) && commands[0]) {
      (commands[0] as Record<string, unknown>).handler_file = handlerPath;
      // Update commands in the definition to reflect the handler_file
      skillDefinition.commands = commands;
    }

    // Add runtime info to skill definition
    skillDefinition.handler_runtime = runtime;
    skillDefinition.files = [handlerPath];

    packageFiles.push({ path: handlerPath, content: handlerCode });
  }

  // Always include skill.json in the package
  packageFiles.push({ path: 'skill.json', content: JSON.stringify(skillDefinition, null, 2) });

  // Install to gateway as a proper skill package
  const { installSkillToGateway } = await import('./skillResolver');
  const installed = await installSkillToGateway(id, packageFiles);
  if (installed) {
    console.log(`[ManagementActions] Installed skill package "${id}" to gateway`);
    // Clear execution_handler — handler_file on command is the new standard
    skillDefinition.execution_handler = null;
  } else {
    // Gateway unavailable — fall back to storing handler_code in definition
    if (handlerCode) {
      skillDefinition.handler_code = handlerCode;
      skillDefinition.execution_handler = `gateway:${id}`;
    }
  }

  const definition = skillDefinition;

  const autoEnable = connectionType !== 'api_key';

  // Upsert to skills table — columns match the actual schema
  const { error } = await sb.from('skills').upsert({
    id,
    enabled: autoEnable,
    model: model || null,
    definition,
    category,
    status: 'available',
    source: 'personal',
    version: '1.0.0',
    checksum: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) {
    return { success: false, message: `Failed to save skill: ${error.message}` };
  }

  dispatchEvent(new Event('skills-changed'));

  // If API key needed, create an approval
  if (connectionType === 'api_key') {
    const approvalId = makeId('approval');
    await saveApproval({
      id: approvalId,
      type: 'api_key_request',
      title: `API Key Required: ${args.service || 'unknown'}`,
      description: `Personal skill "${title}" requires a ${args.service || 'unknown'} API key.`,
      status: 'pending',
      metadata: { skill_id: id, skill_name: title, service: args.service || 'unknown' },
    });
    dispatchEvent(new Event('approvals-changed'));
  }

  const skillType = handlerCode ? 'code' : systemPrompt ? 'llm' : 'api';

  await postChatMessage(conversationId, `Created personal skill: **${title}**`, 'skill_created', {
    skill_id: id,
    skill_name: title,
    skill_category: category,
    skill_type: skillType,
    source: 'personal',
    enabled: autoEnable,
  });

  return {
    success: true,
    message: `Created personal skill: ${title}`,
    metadata: {
      type: 'skill_created',
      skill_id: id,
      skill_name: title,
      skill_category: category,
      skill_type: skillType,
      source: 'personal',
      enabled: autoEnable,
    },
  };
}
