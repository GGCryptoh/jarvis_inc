/**
 * Jarvis Inc — Data Layer (Supabase Backend)
 * ===========================================
 * Same exported function signatures as the original sql.js version,
 * but all functions are now async and backed by Supabase/PostgREST.
 *
 * Key differences from sql.js version:
 * - All functions return Promises
 * - Boolean: Postgres BOOLEAN (true/false) instead of INTEGER (0/1)
 * - JSONB: Postgres native objects instead of JSON strings
 * - persist() is a no-op (Postgres handles persistence)
 * - resetDatabase() truncates all tables via RPC
 */

import { getSupabase } from './supabase';
import { MODEL_SERVICE_MAP } from './models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compare two semver strings: returns true if a > b */
function semverGt(a: string, b: string): boolean {
  const [a1, a2, a3] = a.split('.').map(Number);
  const [b1, b2, b3] = b.split('.').map(Number);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 > b3;
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

export async function getSetting(key: string): Promise<string | null> {
  const { data } = await getSupabase()
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  return data?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getSupabase()
    .from('settings')
    .upsert({ key, value }, { onConflict: 'key' });
}

// --- Intelligence prompt helpers ---

export async function getPrompt(name: string): Promise<string | null> {
  return getSetting(`prompt:${name}`);
}

export async function setPrompt(name: string, content: string): Promise<void> {
  return setSetting(`prompt:${name}`, content);
}

export async function getAllPrompts(): Promise<Array<{ key: string; value: string }>> {
  const { data } = await getSupabase()
    .from('settings')
    .select('key, value')
    .like('key', 'prompt:%')
    .order('key');
  return (data ?? []).map(row => ({
    key: row.key.replace('prompt:', ''),
    value: row.value,
  }));
}

export async function deletePrompt(name: string): Promise<void> {
  await getSupabase()
    .from('settings')
    .delete()
    .eq('key', `prompt:${name}`);
}

export async function isFounderInitialized(): Promise<boolean> {
  return (await getSetting('founder_name')) !== null;
}

export async function getFounderInfo(): Promise<{ founderName: string; orgName: string } | null> {
  const founderName = await getSetting('founder_name');
  const orgName = await getSetting('org_name');
  if (!founderName || !orgName) return null;
  return { founderName, orgName };
}

// ---------------------------------------------------------------------------
// Agent CRUD
// ---------------------------------------------------------------------------

export interface AgentRow {
  id: string;
  name: string;
  role: string;
  color: string;
  skin_tone: string;
  model: string;
  desk_x: number | null;
  desk_y: number | null;
  metadata: Record<string, unknown>;
}

export async function loadAgents(): Promise<AgentRow[]> {
  const { data } = await getSupabase()
    .from('agents')
    .select('id, name, role, color, skin_tone, model, desk_x, desk_y, metadata')
    .order('created_at');
  return (data ?? []) as AgentRow[];
}

export async function saveAgent(agent: Omit<AgentRow, 'desk_x' | 'desk_y' | 'metadata'> & { desk_x?: number | null; desk_y?: number | null; metadata?: Record<string, unknown> }): Promise<void> {
  // Fetch existing to preserve desk position if not provided
  const { data: existing } = await getSupabase()
    .from('agents')
    .select('desk_x, desk_y')
    .eq('id', agent.id)
    .maybeSingle();

  const { error } = await getSupabase()
    .from('agents')
    .upsert({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      color: agent.color,
      skin_tone: agent.skin_tone,
      model: agent.model,
      desk_x: agent.desk_x ?? existing?.desk_x ?? null,
      desk_y: agent.desk_y ?? existing?.desk_y ?? null,
      metadata: agent.metadata ?? {},
    }, { onConflict: 'id' });
  if (error) throw new Error(`saveAgent failed: ${error.message}`);
}

export async function saveAgentDeskPosition(id: string, x: number, y: number): Promise<void> {
  await getSupabase()
    .from('agents')
    .update({ desk_x: x, desk_y: y })
    .eq('id', id);
}

export async function seedAgentsIfEmpty(agents: AgentRow[]): Promise<void> {
  const existing = await loadAgents();
  if (existing.length > 0) return;
  for (const a of agents) {
    await getSupabase()
      .from('agents')
      .insert({
        id: a.id,
        name: a.name,
        role: a.role,
        color: a.color,
        skin_tone: a.skin_tone,
        model: a.model,
      });
  }
}

export async function deleteAgent(id: string): Promise<void> {
  await getSupabase().from('agents').delete().eq('id', id);
}

// ---------------------------------------------------------------------------
// CEO helpers
// ---------------------------------------------------------------------------

export interface CEORow {
  id: string;
  name: string;
  model: string;
  philosophy: string;
  risk_tolerance: string;
  status: string;
  desk_x: number | null;
  desk_y: number | null;
  archetype: string | null;
  backup_model: string | null;
  fallback_active: boolean;
  primary_failures: number;
  color: string;
  skin_tone: string;
}

export async function isCEOInitialized(): Promise<boolean> {
  const { data } = await getSupabase()
    .from('ceo')
    .select('id')
    .limit(1)
    .maybeSingle();
  return !!data;
}

export async function loadCEO(): Promise<CEORow | null> {
  const { data } = await getSupabase()
    .from('ceo')
    .select('id, name, model, philosophy, risk_tolerance, status, desk_x, desk_y, archetype, backup_model, fallback_active, primary_failures, color, skin_tone')
    .limit(1)
    .maybeSingle();
  return data as CEORow | null;
}

export async function saveCEO(ceo: Omit<CEORow, 'id' | 'desk_x' | 'desk_y' | 'backup_model' | 'fallback_active' | 'primary_failures'> & { backup_model?: string | null }): Promise<void> {
  await getSupabase()
    .from('ceo')
    .upsert({
      id: 'ceo',
      name: ceo.name,
      model: ceo.model,
      philosophy: ceo.philosophy,
      risk_tolerance: ceo.risk_tolerance,
      status: ceo.status,
      archetype: ceo.archetype ?? null,
      backup_model: ceo.backup_model ?? null,
    }, { onConflict: 'id' });
}

export async function updateCEOStatus(status: string): Promise<void> {
  await getSupabase()
    .from('ceo')
    .update({ status })
    .eq('id', 'ceo');
}

export async function saveCEODeskPosition(x: number, y: number): Promise<void> {
  await getSupabase()
    .from('ceo')
    .update({ desk_x: x, desk_y: y })
    .eq('id', 'ceo');
}

export async function updateCEOFallback(fallbackActive: boolean, primaryFailures: number): Promise<void> {
  await getSupabase()
    .from('ceo')
    .update({
      fallback_active: fallbackActive,
      primary_failures: primaryFailures,
      last_primary_check: new Date().toISOString(),
    })
    .eq('id', 'ceo');
}

export async function updateCEOAppearance(color: string, skinTone: string, name?: string): Promise<void> {
  const update: Record<string, unknown> = { color, skin_tone: skinTone };
  if (name) update.name = name;
  await getSupabase()
    .from('ceo')
    .update(update)
    .eq('id', 'ceo');
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

export interface AuditLogRow {
  id: number;
  timestamp: string;
  agent: string | null;
  action: string;
  details: string | null;
  severity: string;
}

export async function logAudit(agent: string | null, action: string, details: string | null, severity: 'info' | 'warning' | 'error' = 'info'): Promise<void> {
  await getSupabase()
    .from('audit_log')
    .insert({ agent, action, details, severity });
}

export async function loadAuditLog(limit = 200): Promise<AuditLogRow[]> {
  const { data } = await getSupabase()
    .from('audit_log')
    .select('id, timestamp, agent, action, details, severity')
    .order('id', { ascending: false })
    .limit(limit);
  return (data ?? []) as AuditLogRow[];
}

// ---------------------------------------------------------------------------
// Vault CRUD
// ---------------------------------------------------------------------------

export interface VaultRow {
  id: string;
  name: string;
  type: string;
  service: string;
  key_value: string;
  created_at: string;
  updated_at: string;
}

export async function loadVaultEntries(): Promise<VaultRow[]> {
  const { data } = await getSupabase()
    .from('vault')
    .select('id, name, type, service, key_value, created_at, updated_at')
    .order('created_at');
  return (data ?? []) as VaultRow[];
}

export async function saveVaultEntry(entry: Omit<VaultRow, 'created_at' | 'updated_at'>): Promise<void> {
  await getSupabase()
    .from('vault')
    .upsert({
      id: entry.id,
      name: entry.name,
      type: entry.type,
      service: entry.service,
      key_value: entry.key_value,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
}

export async function updateVaultEntry(id: string, fields: Partial<Pick<VaultRow, 'name' | 'key_value'>>): Promise<void> {
  const update: Record<string, string> = { updated_at: new Date().toISOString() };
  if (fields.name !== undefined) update.name = fields.name;
  if (fields.key_value !== undefined) update.key_value = fields.key_value;
  await getSupabase().from('vault').update(update).eq('id', id);
}

export async function deleteVaultEntry(id: string): Promise<void> {
  await getSupabase().from('vault').delete().eq('id', id);
}

export async function getVaultEntryByService(service: string): Promise<VaultRow | null> {
  const { data } = await getSupabase()
    .from('vault')
    .select('id, name, type, service, key_value, created_at, updated_at')
    .ilike('service', service)
    .limit(1)
    .maybeSingle();
  return data as VaultRow | null;
}

export async function getEntitiesUsingService(service: string): Promise<{ type: 'ceo' | 'agent'; name: string; model: string }[]> {
  const modelsForService = Object.entries(MODEL_SERVICE_MAP)
    .filter(([, svc]) => svc === service)
    .map(([model]) => model);
  if (modelsForService.length === 0) return [];

  const results: { type: 'ceo' | 'agent'; name: string; model: string }[] = [];

  const { data: ceos } = await getSupabase()
    .from('ceo')
    .select('name, model')
    .in('model', modelsForService);
  for (const row of ceos ?? []) {
    results.push({ type: 'ceo', name: row.name, model: row.model });
  }

  const { data: agents } = await getSupabase()
    .from('agents')
    .select('name, model')
    .in('model', modelsForService);
  for (const row of agents ?? []) {
    results.push({ type: 'agent', name: row.name, model: row.model });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Approvals CRUD
// ---------------------------------------------------------------------------

export interface ApprovalRow {
  id: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  metadata: Record<string, unknown> | null; // JSONB — native object, not string
  created_at: string;
}

export async function loadApprovals(): Promise<ApprovalRow[]> {
  const { data } = await getSupabase()
    .from('approvals')
    .select('id, type, title, description, status, metadata, created_at')
    .eq('status', 'pending')
    .order('created_at');
  return (data ?? []) as ApprovalRow[];
}

export async function loadAllApprovals(): Promise<ApprovalRow[]> {
  const { data } = await getSupabase()
    .from('approvals')
    .select('id, type, title, description, status, metadata, created_at')
    .order('created_at', { ascending: false });
  return (data ?? []) as ApprovalRow[];
}

export async function saveApproval(approval: Omit<ApprovalRow, 'created_at'>): Promise<void> {
  await getSupabase()
    .from('approvals')
    .insert({
      id: approval.id,
      type: approval.type,
      title: approval.title,
      description: approval.description,
      status: approval.status,
      metadata: approval.metadata,
    });
}

export async function updateApprovalStatus(id: string, status: string): Promise<void> {
  await getSupabase()
    .from('approvals')
    .update({ status })
    .eq('id', id);
}

export async function getPendingApprovalCount(): Promise<number> {
  const { count } = await getSupabase()
    .from('approvals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export interface MissionRow {
  id: string;
  title: string;
  status: string;
  assignee: string | null;
  priority: string;
  due_date: string | null;
  recurring: string | null;
  recurring_mode: string | null;
  scheduled_for: string | null;
  created_by: string | null;
  created_at: string | null;
  last_recurred_at: string | null;
  task_template: Record<string, unknown> | null;
  current_round: number;
  description: string | null;
  max_runs: number | null;
  run_count: number;
}

export async function loadMissions(): Promise<MissionRow[]> {
  const { data } = await getSupabase()
    .from('missions')
    .select('id, title, status, assignee, priority, due_date, recurring, recurring_mode, scheduled_for, created_by, created_at, last_recurred_at, task_template, current_round, description, max_runs, run_count')
    .order('created_at');
  // Client-side sort to match original sql.js ordering
  return ((data ?? []) as MissionRow[]).sort((a, b) => {
    const statusOrder: Record<string, number> = { in_progress: 0, review: 1, backlog: 2, done: 3 };
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const sd = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    if (sd !== 0) return sd;
    return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
  });
}

export async function saveMission(mission: Partial<MissionRow> & { id: string; title: string }): Promise<void> {
  const { error } = await getSupabase()
    .from('missions')
    .upsert({
      id: mission.id,
      title: mission.title,
      status: mission.status ?? 'backlog',
      assignee: mission.assignee ?? null,
      priority: mission.priority ?? 'medium',
      due_date: mission.due_date ?? null,
      recurring: mission.recurring ?? null,
      recurring_mode: mission.recurring_mode ?? null,
      created_by: mission.created_by ?? null,
      created_at: mission.created_at ?? new Date().toISOString(),
      task_template: mission.task_template ?? null,
      current_round: mission.current_round ?? 1,
      description: mission.description ?? null,
      max_runs: mission.max_runs ?? null,
      run_count: mission.run_count ?? 0,
    }, { onConflict: 'id', ignoreDuplicates: false });
  if (error) {
    console.error('[saveMission] PostgREST error:', error.message, error.details);
    throw new Error(`saveMission failed: ${error.message}`);
  }
}

export async function updateMissionStatus(id: string, status: string): Promise<void> {
  await getSupabase().from('missions').update({ status }).eq('id', id);
}

export async function updateMission(id: string, fields: Partial<Pick<MissionRow, 'title' | 'status' | 'assignee' | 'priority' | 'due_date' | 'recurring' | 'recurring_mode' | 'task_template' | 'current_round' | 'description' | 'max_runs' | 'run_count'>>): Promise<void> {
  const update: Record<string, unknown> = {};
  if (fields.title !== undefined) update.title = fields.title;
  if (fields.status !== undefined) update.status = fields.status;
  if (fields.assignee !== undefined) update.assignee = fields.assignee;
  if (fields.priority !== undefined) update.priority = fields.priority;
  if (fields.due_date !== undefined) update.due_date = fields.due_date;
  if (fields.recurring !== undefined) update.recurring = fields.recurring;
  if (fields.recurring_mode !== undefined) update.recurring_mode = fields.recurring_mode;
  if (fields.task_template !== undefined) update.task_template = fields.task_template;
  if (fields.current_round !== undefined) update.current_round = fields.current_round;
  if (fields.description !== undefined) update.description = fields.description;
  if (fields.max_runs !== undefined) update.max_runs = fields.max_runs;
  if (fields.run_count !== undefined) update.run_count = fields.run_count;
  if (Object.keys(update).length === 0) return;
  await getSupabase().from('missions').update(update).eq('id', id);
}

export async function deleteMission(id: string): Promise<void> {
  await getSupabase().from('missions').delete().eq('id', id);
}

export async function getMissionReviewCount(): Promise<number> {
  const { count } = await getSupabase()
    .from('missions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'review');
  return count ?? 0;
}

export async function getNewCollateralCount(): Promise<number> {
  const lastSeen = localStorage.getItem('jarvis_collateral_last_seen');
  let query = getSupabase()
    .from('task_executions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'completed')
    .not('result', 'is', null);
  if (lastSeen) {
    query = query.gt('completed_at', lastSeen);
  }
  const { count } = await query;
  return count ?? 0;
}

export async function loadTaskExecutions(missionId: string): Promise<any[]> {
  const { data } = await getSupabase()
    .from('task_executions')
    .select('*')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: true });
  return data ?? [];
}

export interface AgentActivity {
  mission?: { id: string; title: string; status: string; priority: string };
  taskExecution?: { id: string; skill_id: string; command_name: string; status: string; started_at: string | null };
  assignedSkills: string[];
}

export async function loadAgentActivity(agentId: string): Promise<AgentActivity> {
  const sb = getSupabase();

  // Active task executions for this agent
  const { data: tasks } = await sb
    .from('task_executions')
    .select('id, skill_id, command_name, status, started_at, mission_id')
    .eq('agent_id', agentId)
    .in('status', ['running', 'pending'])
    .order('created_at', { ascending: false })
    .limit(1);

  const activeTask = tasks?.[0] ?? null;

  // If there's an active task, load its mission
  let mission: AgentActivity['mission'] = undefined;
  if (activeTask?.mission_id) {
    const { data: m } = await sb
      .from('missions')
      .select('id, title, status, priority')
      .eq('id', activeTask.mission_id)
      .maybeSingle();
    if (m) mission = m;
  } else {
    // Check for any in_progress mission assigned to this agent
    const { data: m } = await sb
      .from('missions')
      .select('id, title, status, priority')
      .eq('assignee', agentId)
      .in('status', ['in_progress', 'review'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (m) mission = m;
  }

  // Assigned skills
  const { data: skills } = await sb
    .from('agent_skills')
    .select('skill_id')
    .eq('agent_id', agentId);

  return {
    mission,
    taskExecution: activeTask ? {
      id: activeTask.id,
      skill_id: activeTask.skill_id,
      command_name: activeTask.command_name,
      status: activeTask.status,
      started_at: activeTask.started_at,
    } : undefined,
    assignedSkills: (skills ?? []).map((s: { skill_id: string }) => s.skill_id),
  };
}

/**
 * Compute agent confidence score from task history.
 * Score = weighted success rate with recency bias.
 * New agents start at 70 (neutral), scores range 30-99.
 */
export async function getAgentConfidence(agentId: string): Promise<number> {
  const sb = getSupabase();

  // Load last 20 tasks for this agent
  const { data: tasks } = await sb
    .from('task_executions')
    .select('status, completed_at')
    .eq('agent_id', agentId)
    .in('status', ['completed', 'failed'])
    .order('completed_at', { ascending: false })
    .limit(20);

  if (!tasks || tasks.length === 0) return 70; // Default for new agents

  // Apply recency weighting: recent tasks matter more
  // Weight: most recent = 1.0, oldest = 0.3, linear interpolation
  let weightedSuccesses = 0;
  let totalWeight = 0;

  for (let i = 0; i < tasks.length; i++) {
    const recencyWeight = 1.0 - (i / tasks.length) * 0.7; // 1.0 → 0.3
    totalWeight += recencyWeight;
    if (tasks[i].status === 'completed') {
      weightedSuccesses += recencyWeight;
    }
  }

  const successRate = weightedSuccesses / totalWeight;

  // Map to score range: 0% success → 30, 100% success → 99
  // But bias slightly high (we're optimistic)
  const score = Math.round(30 + successRate * 69);

  return Math.max(30, Math.min(99, score));
}

export async function seedMissionsIfEmpty(missions: Array<Omit<MissionRow, 'recurring' | 'created_by' | 'created_at'> & Partial<Pick<MissionRow, 'recurring' | 'created_by' | 'created_at'>>>): Promise<void> {
  const { count } = await getSupabase()
    .from('missions')
    .select('id', { count: 'exact', head: true });
  if ((count ?? 0) > 0) return;
  for (const m of missions) {
    await getSupabase()
      .from('missions')
      .insert({
        id: m.id,
        title: m.title,
        status: m.status,
        assignee: m.assignee,
        priority: m.priority,
        due_date: m.due_date,
        recurring: m.recurring ?? null,
        created_by: m.created_by ?? null,
        created_at: m.created_at ?? null,
      });
  }
}

// ---------------------------------------------------------------------------
// Skills CRUD
// ---------------------------------------------------------------------------

export interface SkillRow {
  id: string;
  enabled: boolean;          // Postgres BOOLEAN (was INTEGER 0/1)
  model: string | null;
  updated_at: string;
  definition: Record<string, unknown> | null;  // full JSON from repo
  category: string | null;
  status: string;
  source: string;
  version: string | null;
  checksum: string | null;
}

export async function loadSkills(): Promise<SkillRow[]> {
  const { data } = await getSupabase()
    .from('skills')
    .select('id, enabled, model, updated_at, definition, category, status, source, version, checksum')
    .order('id');
  return (data ?? []) as SkillRow[];
}

export async function saveSkill(id: string, enabled: boolean, model: string | null): Promise<void> {
  await getSupabase()
    .from('skills')
    .upsert({
      id,
      enabled,
      model,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
}

export async function updateSkillModel(id: string, model: string | null): Promise<void> {
  await getSupabase()
    .from('skills')
    .upsert({
      id,
      enabled: false,
      model,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
}

/** Seed a skill with its full definition from the repo JSON (insert only). */
export async function seedSkill(id: string, definition: Record<string, unknown>, category: string): Promise<void> {
  const { data: existing } = await getSupabase()
    .from('skills')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (existing) return;

  await getSupabase()
    .from('skills')
    .insert({
      id,
      enabled: false,
      model: null,
      definition,
      category,
      status: (definition.status as string) ?? 'available',
      source: 'seed',
      updated_at: new Date().toISOString(),
    });
}

/**
 * Delete all skills from the DB. Used for clean sync from repo.
 */
export async function clearAllSkills(): Promise<void> {
  await getSupabase().from('skills').delete().neq('id', '');
}

/**
 * Upsert a skill definition from the repo — updates the definition, category,
 * status, and source while PRESERVING user state (enabled, model).
 * If the skill doesn't exist yet, creates it with defaults from the JSON.
 */
export async function upsertSkillDefinition(
  id: string,
  definition: Record<string, unknown>,
  category: string,
  source = 'github',
  checksum?: string,
): Promise<'created' | 'updated' | 'unchanged'> {
  const { data: existing } = await getSupabase()
    .from('skills')
    .select('id, definition, enabled, model, version')
    .eq('id', id)
    .maybeSingle();

  const now = new Date().toISOString();
  const status = (definition.status as string) ?? 'available';
  const version = (definition.version as string) ?? null;

  if (existing) {
    const colVersion = existing.version;
    const defVersion = (existing.definition as Record<string, unknown> | null)?.version;
    const newVersion = definition.version as string | undefined;
    // Skip update if version column matches AND definition version matches
    if (colVersion && newVersion && colVersion === newVersion && defVersion === newVersion) {
      return 'unchanged';
    }
    // Prevent version downgrades (legacy file-format entry overwriting newer directory entry)
    if (colVersion && newVersion && semverGt(colVersion, newVersion)) {
      return 'unchanged';
    }
  }

  // Use .upsert() for both create and update — proven reliable (same pattern as saveSkill).
  // Preserves user state (enabled, model) by reading existing values.
  const { error } = await getSupabase().from('skills').upsert({
    id,
    enabled: existing?.enabled ?? false,
    model: existing?.model ?? ((definition.default_model as string) ?? null),
    definition,
    category,
    status,
    source,
    version,
    checksum: checksum ?? null,
    updated_at: now,
  }, { onConflict: 'id' });

  if (error) {
    console.error(`[DB] Failed to upsert skill ${id}:`, error.message, error);
  }
  return existing ? 'updated' : 'created';
}

// ---------------------------------------------------------------------------
// Conversations CRUD
// ---------------------------------------------------------------------------

export interface ConversationRow {
  id: string;
  title: string;
  type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function loadConversations(): Promise<ConversationRow[]> {
  const { data } = await getSupabase()
    .from('conversations')
    .select('id, title, type, status, created_at, updated_at')
    .order('updated_at', { ascending: false });
  return (data ?? []) as ConversationRow[];
}

export async function getConversation(id: string): Promise<ConversationRow | null> {
  const { data } = await getSupabase()
    .from('conversations')
    .select('id, title, type, status, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data as ConversationRow | null;
}

export async function saveConversation(conv: Omit<ConversationRow, 'created_at' | 'updated_at'>): Promise<void> {
  await getSupabase()
    .from('conversations')
    .upsert({
      id: conv.id,
      title: conv.title,
      type: conv.type,
      status: conv.status,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
}

export async function updateConversation(id: string, fields: Partial<Pick<ConversationRow, 'title' | 'status'>>): Promise<void> {
  const update: Record<string, string> = { updated_at: new Date().toISOString() };
  if (fields.title !== undefined) update.title = fields.title;
  if (fields.status !== undefined) update.status = fields.status;
  await getSupabase().from('conversations').update(update).eq('id', id);
}

export async function deleteConversation(id: string): Promise<void> {
  // chat_messages cascade on FK, but delete explicitly for safety
  await getSupabase().from('chat_messages').delete().eq('conversation_id', id);
  await getSupabase().from('conversations').delete().eq('id', id);
}

export async function getOnboardingConversation(): Promise<ConversationRow | null> {
  const { data } = await getSupabase()
    .from('conversations')
    .select('id, title, type, status, created_at, updated_at')
    .eq('type', 'onboarding')
    .limit(1)
    .maybeSingle();
  return data as ConversationRow | null;
}

// ---------------------------------------------------------------------------
// Chat Messages CRUD
// ---------------------------------------------------------------------------

export interface ChatMessageRow {
  id: string;
  conversation_id: string;
  sender: string;
  text: string;
  metadata: Record<string, unknown> | null;  // JSONB
  created_at: string;
}

export async function loadChatMessages(conversationId: string): Promise<ChatMessageRow[]> {
  const { data } = await getSupabase()
    .from('chat_messages')
    .select('id, conversation_id, sender, text, metadata, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at');
  return (data ?? []) as ChatMessageRow[];
}

export async function saveChatMessage(msg: Omit<ChatMessageRow, 'created_at'>): Promise<void> {
  await getSupabase()
    .from('chat_messages')
    .insert({
      id: msg.id,
      conversation_id: msg.conversation_id,
      sender: msg.sender,
      text: msg.text,
      metadata: msg.metadata,
    });
  // Touch conversation updated_at
  await getSupabase()
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', msg.conversation_id);
}

export async function deleteChatMessages(conversationId: string): Promise<void> {
  await getSupabase().from('chat_messages').delete().eq('conversation_id', conversationId);
}

export async function countChatMessages(conversationId: string): Promise<number> {
  const { count } = await getSupabase()
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);
  return count ?? 0;
}

/** Mark a conversation as read (store current message count in localStorage) */
export function markConversationRead(conversationId: string, messageCount: number): void {
  localStorage.setItem(`jarvis_chat_read_${conversationId}`, String(messageCount));
}

/** Get stored read count for a conversation */
export function getConversationReadCount(conversationId: string): number {
  const stored = localStorage.getItem(`jarvis_chat_read_${conversationId}`);
  return stored ? parseInt(stored, 10) : 0;
}

/** Count conversations with unread messages */
export async function getUnreadConversationCount(): Promise<number> {
  const convos = await loadConversations();
  const active = convos.filter(c => c.status === 'active');
  let unread = 0;
  await Promise.all(active.map(async (c) => {
    const currentCount = await countChatMessages(c.id);
    const readCount = getConversationReadCount(c.id);
    if (currentCount > readCount) unread++;
  }));
  return unread;
}

export async function getLastChatMessage(conversationId: string): Promise<ChatMessageRow | null> {
  const { data } = await getSupabase()
    .from('chat_messages')
    .select('id, conversation_id, sender, text, metadata, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as ChatMessageRow | null;
}

// ---------------------------------------------------------------------------
// Fire CEO
// ---------------------------------------------------------------------------

export async function fireCEO(): Promise<void> {
  await getSupabase().from('ceo').delete().neq('id', '');
  await getSupabase().from('settings').delete().in('key', ['ceo_walked_in', 'ceo_meeting_done']);
  await getSupabase().from('chat_messages').delete().neq('id', '');
  await getSupabase().from('conversations').delete().neq('id', '');
}

// ---------------------------------------------------------------------------
// Export full database as JSON
// ---------------------------------------------------------------------------

export async function exportDatabaseAsJSON(): Promise<Record<string, unknown[]>> {
  const tables = ['settings', 'agents', 'ceo', 'missions', 'audit_log', 'vault', 'approvals', 'skills', 'conversations', 'chat_messages'];
  const data: Record<string, unknown[]> = {};
  for (const table of tables) {
    const { data: rows } = await getSupabase().from(table).select('*');
    data[table] = rows ?? [];
  }
  return data;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

export async function resetDatabase(options?: { keepMemory?: boolean; clearFinancials?: boolean }): Promise<void> {
  const sb = getSupabase();

  // Tables with standard `id` text PK
  const idTables = [
    'chat_messages', 'conversations', 'approvals', 'skills', 'vault',
    'missions', 'agents', 'ceo',
    'mission_memory', 'agent_skills', 'scheduler_state',
    'ceo_action_queue', 'task_executions', 'agent_stats',
    'mission_rounds', 'agent_questions', 'skill_schedules',
  ];

  // Optionally preserve org memory
  if (!options?.keepMemory) {
    idTables.push('org_memory', 'conversation_summaries', 'archived_memories');
  }

  for (const table of idTables) {
    try {
      await sb.from(table).delete().neq('id', '');
    } catch { /* table may not exist yet */ }
  }

  // Settings table uses `key` column, not `id`
  try {
    await sb.from('settings').delete().neq('key', '');
  } catch { /* ignore */ }

  // audit_log uses bigserial PK
  try {
    await sb.from('audit_log').delete().gte('id', 0);
  } catch { /* ignore */ }

  // Financial tables (llm_usage, channel_usage) — only clear if explicitly requested
  if (options?.clearFinancials) {
    try {
      await sb.from('llm_usage').delete().gte('id', 0);
    } catch { /* ignore */ }
    try {
      await sb.from('channel_usage').delete().gte('id', 0);
    } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Agent Skills (assignment)
// ---------------------------------------------------------------------------

export interface AgentSkillRow {
  id: string;
  agent_id: string;
  skill_id: string;
  assigned_by: string;
  created_at: string;
}

export async function getAgentSkills(agentId: string): Promise<AgentSkillRow[]> {
  const { data } = await getSupabase()
    .from('agent_skills')
    .select('id, agent_id, skill_id, assigned_by, created_at')
    .eq('agent_id', agentId)
    .order('created_at');
  return (data ?? []) as AgentSkillRow[];
}

export async function assignSkillToAgent(agentId: string, skillId: string, assignedBy: string = 'ceo'): Promise<void> {
  await getSupabase()
    .from('agent_skills')
    .upsert({
      id: `as-${agentId}-${skillId}`,
      agent_id: agentId,
      skill_id: skillId,
      assigned_by: assignedBy,
    }, { onConflict: 'agent_id,skill_id' });
}

export async function removeSkillFromAgent(agentId: string, skillId: string): Promise<void> {
  await getSupabase()
    .from('agent_skills')
    .delete()
    .eq('agent_id', agentId)
    .eq('skill_id', skillId);
}

export async function getAgentsWithSkill(skillId: string): Promise<AgentSkillRow[]> {
  const { data } = await getSupabase()
    .from('agent_skills')
    .select('id, agent_id, skill_id, assigned_by, created_at')
    .eq('skill_id', skillId)
    .order('created_at');
  return (data ?? []) as AgentSkillRow[];
}

// ---------------------------------------------------------------------------
// Notification Channels CRUD
// ---------------------------------------------------------------------------

export interface ChannelRow {
  id: string;
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
  cost_per_unit: number;
  created_at?: string;
}

export async function loadChannels(): Promise<ChannelRow[]> {
  const { data } = await getSupabase()
    .from('notification_channels')
    .select('*')
    .order('created_at', { ascending: true });
  return (data ?? []) as ChannelRow[];
}

export async function saveChannel(channel: Partial<ChannelRow>): Promise<void> {
  await getSupabase().from('notification_channels').upsert(channel);
}

export async function deleteChannel(id: string): Promise<void> {
  await getSupabase().from('notification_channels').delete().eq('id', id);
}

// ---------------------------------------------------------------------------
// Collateral Summaries (completed task_executions)
// ---------------------------------------------------------------------------

export interface CollateralSummary {
  id: string;
  mission_id: string;
  skill_id: string;
  summary: string;
  completed_at: string;
}

export async function getRecentCollateralSummaries(limit = 10): Promise<CollateralSummary[]> {
  const { data } = await getSupabase()
    .from('task_executions')
    .select('id, mission_id, skill_id, result, completed_at')
    .eq('status', 'completed')
    .not('result', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data
    .map((row: Record<string, unknown>) => {
      const result = row.result as Record<string, unknown> | null;
      const summary = (result?.summary as string) ?? (result?.output as string)?.slice(0, 200) ?? '';
      if (!summary) return null;
      return {
        id: row.id as string,
        mission_id: row.mission_id as string,
        skill_id: row.skill_id as string,
        summary,
        completed_at: row.completed_at as string,
      };
    })
    .filter((r): r is CollateralSummary => r !== null);
}

// ---------------------------------------------------------------------------
// Archived Memories CRUD
// ---------------------------------------------------------------------------

export interface ArchivedMemoryRow {
  id: string;
  day: string;
  topic: string | null;
  consolidated: string;
  source_count: number;
  source_ids: string[];
  importance: number;
  tags: string[];
  created_at: string;
}

export async function getArchivedMemories(limit = 20): Promise<ArchivedMemoryRow[]> {
  const { data } = await getSupabase()
    .from('archived_memories')
    .select('id, day, topic, consolidated, source_count, source_ids, importance, tags, created_at')
    .order('day', { ascending: false })
    .order('importance', { ascending: false })
    .limit(limit);
  return (data ?? []) as ArchivedMemoryRow[];
}

export async function saveArchivedMemory(row: Omit<ArchivedMemoryRow, 'created_at'>): Promise<void> {
  await getSupabase()
    .from('archived_memories')
    .insert(row);
}

// ---------------------------------------------------------------------------
// Mission Rounds
// ---------------------------------------------------------------------------

export interface MissionRoundRow {
  id: string;
  mission_id: string;
  round_number: number;
  agent_id: string | null;
  status: string;
  quality_score: number | null;
  completeness_score: number | null;
  efficiency_score: number | null;
  overall_score: number | null;
  grade: string | null;
  ceo_review: string | null;
  ceo_recommendation: string | null;
  rejection_feedback: string | null;
  redo_strategy: string | null;
  tokens_used: number;
  cost_usd: number;
  duration_ms: number | null;
  task_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export async function loadMissionRounds(missionId: string): Promise<MissionRoundRow[]> {
  const { data } = await getSupabase()
    .from('mission_rounds')
    .select('*')
    .eq('mission_id', missionId)
    .order('round_number', { ascending: true });
  return (data ?? []) as MissionRoundRow[];
}

export async function saveMissionRound(round: Partial<MissionRoundRow> & { id: string; mission_id: string }): Promise<void> {
  await getSupabase()
    .from('mission_rounds')
    .upsert({
      id: round.id,
      mission_id: round.mission_id,
      round_number: round.round_number ?? 1,
      agent_id: round.agent_id ?? null,
      status: round.status ?? 'in_progress',
      quality_score: round.quality_score ?? null,
      completeness_score: round.completeness_score ?? null,
      efficiency_score: round.efficiency_score ?? null,
      overall_score: round.overall_score ?? null,
      grade: round.grade ?? null,
      ceo_review: round.ceo_review ?? null,
      ceo_recommendation: round.ceo_recommendation ?? null,
      rejection_feedback: round.rejection_feedback ?? null,
      redo_strategy: round.redo_strategy ?? null,
      tokens_used: round.tokens_used ?? 0,
      cost_usd: round.cost_usd ?? 0,
      duration_ms: round.duration_ms ?? null,
      task_count: round.task_count ?? 0,
      started_at: round.started_at ?? null,
      completed_at: round.completed_at ?? null,
    }, { onConflict: 'id' });
}

export async function updateMissionRound(id: string, fields: Partial<MissionRoundRow>): Promise<void> {
  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) update[key] = value;
  }
  if (Object.keys(update).length === 0) return;
  await getSupabase().from('mission_rounds').update(update).eq('id', id);
}

// ---------------------------------------------------------------------------
// Agent Questions
// ---------------------------------------------------------------------------

export interface AgentQuestionRow {
  id: string;
  task_execution_id: string;
  mission_id: string;
  agent_id: string;
  question: string;
  context: string | null;
  answer: string | null;
  answered_by: string | null;
  status: string;
  created_at: string;
  answered_at: string | null;
}

export async function loadAgentQuestions(missionId: string): Promise<AgentQuestionRow[]> {
  const { data } = await getSupabase()
    .from('agent_questions')
    .select('*')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: true });
  return (data ?? []) as AgentQuestionRow[];
}

export async function saveAgentQuestion(question: Omit<AgentQuestionRow, 'created_at' | 'answered_at' | 'answer' | 'answered_by' | 'status'> & { status?: string }): Promise<void> {
  await getSupabase()
    .from('agent_questions')
    .insert({
      id: question.id,
      task_execution_id: question.task_execution_id,
      mission_id: question.mission_id,
      agent_id: question.agent_id,
      question: question.question,
      context: question.context ?? null,
      status: question.status ?? 'pending',
    });
}

export async function answerAgentQuestion(id: string, answer: string, answeredBy: string): Promise<void> {
  await getSupabase()
    .from('agent_questions')
    .update({
      answer,
      answered_by: answeredBy,
      status: 'answered',
      answered_at: new Date().toISOString(),
    })
    .eq('id', id);
}

export async function getPendingAgentQuestions(): Promise<AgentQuestionRow[]> {
  const { data } = await getSupabase()
    .from('agent_questions')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  return (data ?? []) as AgentQuestionRow[];
}

// ---------------------------------------------------------------------------
// Skill Schedules CRUD
// ---------------------------------------------------------------------------

export interface SkillScheduleRow {
  id: string;
  skill_id: string;
  command_name: string;
  frequency: 'hourly' | 'every_4h' | 'daily' | 'weekly' | 'monthly';
  run_at_time: string;
  run_on_day: number | null;
  params: Record<string, unknown>;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export async function loadSkillSchedules(): Promise<SkillScheduleRow[]> {
  const { data, error } = await getSupabase()
    .from('skill_schedules')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) { console.error('loadSkillSchedules failed:', error); return []; }
  return (data ?? []) as SkillScheduleRow[];
}

export async function getSkillSchedule(skillId: string): Promise<SkillScheduleRow | null> {
  const { data } = await getSupabase()
    .from('skill_schedules')
    .select('*')
    .eq('skill_id', skillId)
    .maybeSingle();
  return (data as SkillScheduleRow) ?? null;
}

export async function saveSkillSchedule(schedule: Partial<SkillScheduleRow> & { id: string }): Promise<void> {
  const { error } = await getSupabase()
    .from('skill_schedules')
    .upsert(schedule, { onConflict: 'id' });
  if (error) console.error('saveSkillSchedule failed:', error);
}

export async function deleteSkillSchedule(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('skill_schedules')
    .delete()
    .eq('id', id);
  if (error) console.error('deleteSkillSchedule failed:', error);
}

export async function getDueSkillSchedules(): Promise<SkillScheduleRow[]> {
  const now = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from('skill_schedules')
    .select('*')
    .eq('enabled', true)
    .not('next_run_at', 'is', null)
    .lte('next_run_at', now);
  if (error) { console.error('getDueSkillSchedules failed:', error); return []; }
  return (data ?? []) as SkillScheduleRow[];
}

export async function updateSkillScheduleRun(id: string, lastRun: string, nextRun: string): Promise<void> {
  const { error } = await getSupabase()
    .from('skill_schedules')
    .update({ last_run_at: lastRun, next_run_at: nextRun })
    .eq('id', id);
  if (error) console.error('updateSkillScheduleRun failed:', error);
}

// ---------------------------------------------------------------------------
// Persistence — no-op (Supabase handles it)
// ---------------------------------------------------------------------------

export async function persist(): Promise<void> {
  // No-op — Postgres persists automatically
}
