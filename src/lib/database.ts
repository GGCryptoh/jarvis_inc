import initSqlJs, { type Database } from 'sql.js';
import { MODEL_SERVICE_MAP } from './models';

const DB_STORAGE_KEY = 'jarvis_inc_db';

let db: Database | null = null;

/** Initialize (or restore) the SQLite database. */
export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: () => '/sql-wasm.wasm',
  });

  // Try to restore a previously-persisted database from IndexedDB
  const saved = await loadFromIndexedDB();
  if (saved) {
    db = new SQL.Database(new Uint8Array(saved));
  } else {
    db = new SQL.Database();
  }

  // Ensure schema exists (idempotent)
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      role       TEXT NOT NULL,
      color      TEXT NOT NULL,
      skin_tone  TEXT NOT NULL,
      model      TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS missions (
      id        TEXT PRIMARY KEY,
      title     TEXT NOT NULL,
      status    TEXT NOT NULL DEFAULT 'backlog',
      assignee  TEXT,
      priority  TEXT NOT NULL DEFAULT 'medium',
      due_date  TEXT
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      agent     TEXT,
      action    TEXT NOT NULL,
      details   TEXT,
      severity  TEXT NOT NULL DEFAULT 'info'
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS ceo (
      id              TEXT PRIMARY KEY DEFAULT 'ceo',
      name            TEXT NOT NULL,
      model           TEXT NOT NULL,
      philosophy      TEXT NOT NULL,
      risk_tolerance  TEXT NOT NULL DEFAULT 'moderate',
      status          TEXT NOT NULL DEFAULT 'nominal',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS vault (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'api_key',
      service    TEXT NOT NULL,
      key_value  TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS approvals (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      metadata    TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS skills (
      id         TEXT PRIMARY KEY,
      enabled    INTEGER NOT NULL DEFAULT 0,
      model      TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrations — add columns to existing tables (idempotent)
  try { db.run('ALTER TABLE agents ADD COLUMN desk_x REAL DEFAULT NULL'); } catch { /* already exists */ }
  try { db.run('ALTER TABLE agents ADD COLUMN desk_y REAL DEFAULT NULL'); } catch { /* already exists */ }
  try { db.run('ALTER TABLE ceo ADD COLUMN desk_x REAL DEFAULT NULL'); } catch { /* already exists */ }
  try { db.run('ALTER TABLE ceo ADD COLUMN desk_y REAL DEFAULT NULL'); } catch { /* already exists */ }
  try { db.run('ALTER TABLE ceo ADD COLUMN archetype TEXT DEFAULT NULL'); } catch { /* already exists */ }
  try { db.run('ALTER TABLE missions ADD COLUMN recurring TEXT DEFAULT NULL'); } catch { /* already exists */ }
  try { db.run('ALTER TABLE missions ADD COLUMN created_by TEXT DEFAULT NULL'); } catch { /* already exists */ }
  try { db.run('ALTER TABLE missions ADD COLUMN created_at TEXT DEFAULT NULL'); } catch { /* already exists */ }

  await persist();
  return db;
}

/** Get the current database instance (must call initDatabase first). */
export function getDB(): Database {
  if (!db) throw new Error('Database not initialized — call initDatabase() first');
  return db;
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

export function getSetting(key: string): string | null {
  const stmt = getDB().prepare('SELECT value FROM settings WHERE key = ?');
  stmt.bind([key]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row.value as string;
  }
  stmt.free();
  return null;
}

export function setSetting(key: string, value: string): void {
  getDB().run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
  persist();
}

/** Returns true when the founder has completed the ceremony. */
export function isFounderInitialized(): boolean {
  return getSetting('founder_name') !== null;
}

/** Retrieve the founder / org names stored during the ceremony. */
export function getFounderInfo(): { founderName: string; orgName: string } | null {
  const founderName = getSetting('founder_name');
  const orgName = getSetting('org_name');
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

/** Load all agents from DB. Returns empty array if none. */
export function loadAgents(): AgentRow[] {
  const results: AgentRow[] = [];
  const stmt = getDB().prepare('SELECT id, name, role, color, skin_tone, model, desk_x, desk_y FROM agents ORDER BY created_at');
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as AgentRow);
  }
  stmt.free();
  return results;
}

/** Insert or update an agent. */
export function saveAgent(agent: Omit<AgentRow, 'desk_x' | 'desk_y'> & { desk_x?: number | null; desk_y?: number | null }): void {
  getDB().run(
    `INSERT INTO agents (id, name, role, color, skin_tone, model, desk_x, desk_y)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       role = excluded.role,
       color = excluded.color,
       skin_tone = excluded.skin_tone,
       model = excluded.model,
       desk_x = COALESCE(excluded.desk_x, agents.desk_x),
       desk_y = COALESCE(excluded.desk_y, agents.desk_y)`,
    [agent.id, agent.name, agent.role, agent.color, agent.skin_tone, agent.model, agent.desk_x ?? null, agent.desk_y ?? null],
  );
  persist();
}

/** Update only the desk position for an agent. */
export function saveAgentDeskPosition(id: string, x: number, y: number): void {
  getDB().run('UPDATE agents SET desk_x = ?, desk_y = ? WHERE id = ?', [x, y, id]);
  persist();
}

/** Save the initial fleet of agents (only if DB has none). */
export function seedAgentsIfEmpty(agents: AgentRow[]): void {
  const existing = loadAgents();
  if (existing.length > 0) return;
  for (const a of agents) {
    getDB().run(
      'INSERT OR IGNORE INTO agents (id, name, role, color, skin_tone, model) VALUES (?, ?, ?, ?, ?, ?)',
      [a.id, a.name, a.role, a.color, a.skin_tone, a.model],
    );
  }
  persist();
}

/** Delete an agent by ID. */
export function deleteAgent(id: string): void {
  getDB().run('DELETE FROM agents WHERE id = ?', [id]);
  persist();
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
}

/** Returns true when a CEO record exists. */
export function isCEOInitialized(): boolean {
  const stmt = getDB().prepare('SELECT id FROM ceo LIMIT 1');
  const exists = stmt.step();
  stmt.free();
  return exists;
}

/** Load the CEO record (null if none). */
export function loadCEO(): CEORow | null {
  const stmt = getDB().prepare('SELECT id, name, model, philosophy, risk_tolerance, status, desk_x, desk_y, archetype FROM ceo LIMIT 1');
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as CEORow;
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

/** Insert or update the CEO. */
export function saveCEO(ceo: Omit<CEORow, 'id' | 'desk_x' | 'desk_y'>): void {
  getDB().run(
    `INSERT INTO ceo (id, name, model, philosophy, risk_tolerance, status, archetype)
     VALUES ('ceo', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       model = excluded.model,
       philosophy = excluded.philosophy,
       risk_tolerance = excluded.risk_tolerance,
       status = excluded.status,
       archetype = excluded.archetype`,
    [ceo.name, ceo.model, ceo.philosophy, ceo.risk_tolerance, ceo.status, ceo.archetype ?? null],
  );
  persist();
}

/** Update only the CEO status field. */
export function updateCEOStatus(status: string): void {
  getDB().run("UPDATE ceo SET status = ? WHERE id = 'ceo'", [status]);
  persist();
}

/** Update only the CEO desk position. */
export function saveCEODeskPosition(x: number, y: number): void {
  getDB().run("UPDATE ceo SET desk_x = ?, desk_y = ? WHERE id = 'ceo'", [x, y]);
  persist();
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

/** Write to the immutable audit log. */
export function logAudit(agent: string | null, action: string, details: string | null, severity: 'info' | 'warning' | 'error' = 'info'): void {
  getDB().run(
    'INSERT INTO audit_log (agent, action, details, severity) VALUES (?, ?, ?, ?)',
    [agent, action, details, severity],
  );
  persist();
}

/** Load audit log entries (newest first). */
export function loadAuditLog(limit = 200): AuditLogRow[] {
  const results: AuditLogRow[] = [];
  const stmt = getDB().prepare('SELECT id, timestamp, agent, action, details, severity FROM audit_log ORDER BY id DESC LIMIT ?');
  stmt.bind([limit]);
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as AuditLogRow);
  }
  stmt.free();
  return results;
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

export function loadVaultEntries(): VaultRow[] {
  const results: VaultRow[] = [];
  const stmt = getDB().prepare('SELECT id, name, type, service, key_value, created_at, updated_at FROM vault ORDER BY created_at');
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as VaultRow);
  }
  stmt.free();
  return results;
}

export function saveVaultEntry(entry: Omit<VaultRow, 'created_at' | 'updated_at'>): void {
  getDB().run(
    `INSERT INTO vault (id, name, type, service, key_value)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       type = excluded.type,
       service = excluded.service,
       key_value = excluded.key_value,
       updated_at = datetime('now')`,
    [entry.id, entry.name, entry.type, entry.service, entry.key_value],
  );
  persist();
}

export function updateVaultEntry(id: string, fields: Partial<Pick<VaultRow, 'name' | 'key_value'>>): void {
  const sets: string[] = [];
  const vals: string[] = [];
  if (fields.name !== undefined) { sets.push('name = ?'); vals.push(fields.name); }
  if (fields.key_value !== undefined) { sets.push('key_value = ?'); vals.push(fields.key_value); }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  getDB().run(`UPDATE vault SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
  persist();
}

export function deleteVaultEntry(id: string): void {
  getDB().run('DELETE FROM vault WHERE id = ?', [id]);
  persist();
}

export function getVaultEntryByService(service: string): VaultRow | null {
  const stmt = getDB().prepare('SELECT id, name, type, service, key_value, created_at, updated_at FROM vault WHERE service = ? LIMIT 1');
  stmt.bind([service]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as VaultRow;
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

export function getEntitiesUsingService(service: string): { type: 'ceo' | 'agent'; name: string; model: string }[] {
  const modelsForService = Object.entries(MODEL_SERVICE_MAP)
    .filter(([, svc]) => svc === service)
    .map(([model]) => model);
  if (modelsForService.length === 0) return [];

  const results: { type: 'ceo' | 'agent'; name: string; model: string }[] = [];
  const placeholders = modelsForService.map(() => '?').join(', ');

  const ceoStmt = getDB().prepare(`SELECT name, model FROM ceo WHERE model IN (${placeholders})`);
  ceoStmt.bind(modelsForService);
  while (ceoStmt.step()) {
    const row = ceoStmt.getAsObject() as { name: string; model: string };
    results.push({ type: 'ceo', name: row.name, model: row.model });
  }
  ceoStmt.free();

  const agentStmt = getDB().prepare(`SELECT name, model FROM agents WHERE model IN (${placeholders})`);
  agentStmt.bind(modelsForService);
  while (agentStmt.step()) {
    const row = agentStmt.getAsObject() as { name: string; model: string };
    results.push({ type: 'agent', name: row.name, model: row.model });
  }
  agentStmt.free();

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
  metadata: string | null;
  created_at: string;
}

export function loadApprovals(): ApprovalRow[] {
  const results: ApprovalRow[] = [];
  const stmt = getDB().prepare("SELECT id, type, title, description, status, metadata, created_at FROM approvals WHERE status = 'pending' ORDER BY created_at");
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as ApprovalRow);
  }
  stmt.free();
  return results;
}

export function loadAllApprovals(): ApprovalRow[] {
  const results: ApprovalRow[] = [];
  const stmt = getDB().prepare('SELECT id, type, title, description, status, metadata, created_at FROM approvals ORDER BY created_at DESC');
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as ApprovalRow);
  }
  stmt.free();
  return results;
}

export function saveApproval(approval: Omit<ApprovalRow, 'created_at'>): void {
  getDB().run(
    'INSERT INTO approvals (id, type, title, description, status, metadata) VALUES (?, ?, ?, ?, ?, ?)',
    [approval.id, approval.type, approval.title, approval.description, approval.status, approval.metadata],
  );
  persist();
}

export function updateApprovalStatus(id: string, status: string): void {
  getDB().run('UPDATE approvals SET status = ? WHERE id = ?', [status, id]);
  persist();
}

export function getPendingApprovalCount(): number {
  const stmt = getDB().prepare("SELECT COUNT(*) as cnt FROM approvals WHERE status = 'pending'");
  stmt.step();
  const row = stmt.getAsObject() as { cnt: number };
  stmt.free();
  return row.cnt;
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
  recurring: string | null;   // cron expression or null
  created_by: string | null;  // founder name, CEO name, or agent name
  created_at: string | null;  // ISO timestamp
}

export function loadMissions(): MissionRow[] {
  const results: MissionRow[] = [];
  const stmt = getDB().prepare(
    `SELECT id, title, status, assignee, priority, due_date, recurring, created_by, created_at
     FROM missions
     ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'review' THEN 1 WHEN 'backlog' THEN 2 WHEN 'done' THEN 3 END,
              CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END`
  );
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as MissionRow);
  }
  stmt.free();
  return results;
}

export function saveMission(mission: Partial<MissionRow> & { id: string; title: string }): void {
  getDB().run(
    `INSERT INTO missions (id, title, status, assignee, priority, due_date, recurring, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       status = excluded.status,
       assignee = excluded.assignee,
       priority = excluded.priority,
       due_date = excluded.due_date,
       recurring = excluded.recurring,
       created_by = excluded.created_by`,
    [
      mission.id,
      mission.title,
      mission.status ?? 'backlog',
      mission.assignee ?? null,
      mission.priority ?? 'medium',
      mission.due_date ?? null,
      mission.recurring ?? null,
      mission.created_by ?? null,
      mission.created_at ?? new Date().toISOString(),
    ],
  );
  persist();
}

export function updateMissionStatus(id: string, status: string): void {
  getDB().run('UPDATE missions SET status = ? WHERE id = ?', [status, id]);
  persist();
}

/** Update multiple mission fields at once. */
export function updateMission(id: string, fields: Partial<Pick<MissionRow, 'title' | 'status' | 'assignee' | 'priority' | 'due_date' | 'recurring'>>): void {
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  if (fields.title !== undefined) { sets.push('title = ?'); vals.push(fields.title); }
  if (fields.status !== undefined) { sets.push('status = ?'); vals.push(fields.status); }
  if (fields.assignee !== undefined) { sets.push('assignee = ?'); vals.push(fields.assignee); }
  if (fields.priority !== undefined) { sets.push('priority = ?'); vals.push(fields.priority); }
  if (fields.due_date !== undefined) { sets.push('due_date = ?'); vals.push(fields.due_date); }
  if (fields.recurring !== undefined) { sets.push('recurring = ?'); vals.push(fields.recurring); }
  if (sets.length === 0) return;
  getDB().run(`UPDATE missions SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
  persist();
}

/** Delete a mission by ID. */
export function deleteMission(id: string): void {
  getDB().run('DELETE FROM missions WHERE id = ?', [id]);
  persist();
}

export function seedMissionsIfEmpty(missions: Array<Omit<MissionRow, 'recurring' | 'created_by' | 'created_at'> & Partial<Pick<MissionRow, 'recurring' | 'created_by' | 'created_at'>>>): void {
  const stmt = getDB().prepare('SELECT COUNT(*) as cnt FROM missions');
  stmt.step();
  const row = stmt.getAsObject() as { cnt: number };
  stmt.free();
  if (row.cnt > 0) return;
  for (const m of missions) {
    getDB().run(
      'INSERT OR IGNORE INTO missions (id, title, status, assignee, priority, due_date, recurring, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [m.id, m.title, m.status, m.assignee, m.priority, m.due_date, m.recurring ?? null, m.created_by ?? null, m.created_at ?? null],
    );
  }
  persist();
}

// ---------------------------------------------------------------------------
// Skills CRUD
// ---------------------------------------------------------------------------

export interface SkillRow {
  id: string;
  enabled: number;     // 0 or 1
  model: string | null;
  updated_at: string;
}

export function loadSkills(): SkillRow[] {
  const results: SkillRow[] = [];
  const stmt = getDB().prepare('SELECT id, enabled, model, updated_at FROM skills ORDER BY id');
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as SkillRow);
  }
  stmt.free();
  return results;
}

export function saveSkill(id: string, enabled: boolean, model: string | null): void {
  getDB().run(
    `INSERT INTO skills (id, enabled, model, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       enabled = excluded.enabled,
       model = excluded.model,
       updated_at = datetime('now')`,
    [id, enabled ? 1 : 0, model],
  );
  persist();
}

export function updateSkillModel(id: string, model: string | null): void {
  getDB().run(
    `INSERT INTO skills (id, enabled, model, updated_at)
     VALUES (?, 0, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       model = excluded.model,
       updated_at = datetime('now')`,
    [id, model],
  );
  persist();
}

// ---------------------------------------------------------------------------
// Fire CEO (preserves agents, vault, missions, etc.)
// ---------------------------------------------------------------------------

export function fireCEO(): void {
  getDB().run('DELETE FROM ceo');
  getDB().run("DELETE FROM settings WHERE key IN ('ceo_walked_in', 'ceo_meeting_done')");
  persist();
}

// ---------------------------------------------------------------------------
// Export full database as JSON
// ---------------------------------------------------------------------------

export function exportDatabaseAsJSON(): Record<string, unknown[]> {
  const tables = ['settings', 'agents', 'ceo', 'missions', 'audit_log', 'vault', 'approvals', 'skills'];
  const data: Record<string, unknown[]> = {};
  for (const table of tables) {
    const results: unknown[] = [];
    const stmt = getDB().prepare(`SELECT * FROM ${table}`);
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    data[table] = results;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/** Nuke the entire database and remove persisted copy. */
export async function resetDatabase(): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
  await deleteFromIndexedDB();
}

// ---------------------------------------------------------------------------
// Persistence via IndexedDB
// ---------------------------------------------------------------------------

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('jarvis_inc', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persist(): Promise<void> {
  if (!db) return;
  const data = db.export();
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(data.buffer, DB_STORAGE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadFromIndexedDB(): Promise<ArrayBuffer | null> {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(DB_STORAGE_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteFromIndexedDB(): Promise<void> {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(DB_STORAGE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
