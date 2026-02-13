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
// Settings helpers
// ---------------------------------------------------------------------------

export async function getSetting(key: string): Promise<string | null> {
  const { data } = await getSupabase()
    .from('settings')
    .select('value')
    .eq('key', key)
    .single();
  return data?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getSupabase()
    .from('settings')
    .upsert({ key, value }, { onConflict: 'key' });
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
}

export async function loadAgents(): Promise<AgentRow[]> {
  const { data } = await getSupabase()
    .from('agents')
    .select('id, name, role, color, skin_tone, model, desk_x, desk_y')
    .order('created_at');
  return (data ?? []) as AgentRow[];
}

export async function saveAgent(agent: Omit<AgentRow, 'desk_x' | 'desk_y'> & { desk_x?: number | null; desk_y?: number | null }): Promise<void> {
  // Fetch existing to preserve desk position if not provided
  const { data: existing } = await getSupabase()
    .from('agents')
    .select('desk_x, desk_y')
    .eq('id', agent.id)
    .single();

  await getSupabase()
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
    }, { onConflict: 'id' });
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
}

export async function isCEOInitialized(): Promise<boolean> {
  const { data } = await getSupabase()
    .from('ceo')
    .select('id')
    .limit(1)
    .single();
  return !!data;
}

export async function loadCEO(): Promise<CEORow | null> {
  const { data } = await getSupabase()
    .from('ceo')
    .select('id, name, model, philosophy, risk_tolerance, status, desk_x, desk_y, archetype, backup_model, fallback_active, primary_failures')
    .limit(1)
    .single();
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
    .eq('service', service)
    .limit(1)
    .single();
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
  created_by: string | null;
  created_at: string | null;
}

export async function loadMissions(): Promise<MissionRow[]> {
  const { data } = await getSupabase()
    .from('missions')
    .select('id, title, status, assignee, priority, due_date, recurring, created_by, created_at')
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
  await getSupabase()
    .from('missions')
    .upsert({
      id: mission.id,
      title: mission.title,
      status: mission.status ?? 'backlog',
      assignee: mission.assignee ?? null,
      priority: mission.priority ?? 'medium',
      due_date: mission.due_date ?? null,
      recurring: mission.recurring ?? null,
      created_by: mission.created_by ?? null,
      created_at: mission.created_at ?? new Date().toISOString(),
    }, { onConflict: 'id', ignoreDuplicates: false });
}

export async function updateMissionStatus(id: string, status: string): Promise<void> {
  await getSupabase().from('missions').update({ status }).eq('id', id);
}

export async function updateMission(id: string, fields: Partial<Pick<MissionRow, 'title' | 'status' | 'assignee' | 'priority' | 'due_date' | 'recurring'>>): Promise<void> {
  const update: Record<string, unknown> = {};
  if (fields.title !== undefined) update.title = fields.title;
  if (fields.status !== undefined) update.status = fields.status;
  if (fields.assignee !== undefined) update.assignee = fields.assignee;
  if (fields.priority !== undefined) update.priority = fields.priority;
  if (fields.due_date !== undefined) update.due_date = fields.due_date;
  if (fields.recurring !== undefined) update.recurring = fields.recurring;
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

export async function loadTaskExecutions(missionId: string): Promise<any[]> {
  const { data } = await getSupabase()
    .from('task_executions')
    .select('*')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: true });
  return data ?? [];
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
}

export async function loadSkills(): Promise<SkillRow[]> {
  const { data } = await getSupabase()
    .from('skills')
    .select('id, enabled, model, updated_at, definition, category, status, source')
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

/** Seed a skill with its full definition from the repo JSON. */
export async function seedSkill(id: string, definition: Record<string, unknown>, category: string): Promise<void> {
  // Only insert if doesn't exist — don't overwrite user state
  const { data: existing } = await getSupabase()
    .from('skills')
    .select('id')
    .eq('id', id)
    .single();
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
    .single();
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
    .single();
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

export async function getLastChatMessage(conversationId: string): Promise<ChatMessageRow | null> {
  const { data } = await getSupabase()
    .from('chat_messages')
    .select('id, conversation_id, sender, text, metadata, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
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

export async function resetDatabase(): Promise<void> {
  // Truncate all tables in dependency order
  const tables = ['chat_messages', 'conversations', 'approvals', 'skills', 'vault', 'audit_log', 'missions', 'agents', 'ceo', 'settings',
    'org_memory', 'conversation_summaries', 'mission_memory', 'agent_skills', 'scheduler_state', 'ceo_action_queue', 'task_executions', 'agent_stats'];
  for (const table of tables) {
    try {
      await getSupabase().from(table).delete().neq('id', '');
    } catch {
      // Some tables may use different PK names (e.g., audit_log uses serial id)
    }
  }
  // Also clear audit_log (bigserial PK)
  try {
    await getSupabase().from('audit_log').delete().gte('id', 0);
  } catch { /* ignore */ }
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
// Persistence — no-op (Supabase handles it)
// ---------------------------------------------------------------------------

export async function persist(): Promise<void> {
  // No-op — Postgres persists automatically
}
