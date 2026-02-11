import initSqlJs, { type Database } from 'sql.js';

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
}

/** Load all agents from DB. Returns empty array if none. */
export function loadAgents(): AgentRow[] {
  const results: AgentRow[] = [];
  const stmt = getDB().prepare('SELECT id, name, role, color, skin_tone, model FROM agents ORDER BY created_at');
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as AgentRow);
  }
  stmt.free();
  return results;
}

/** Insert or update an agent. */
export function saveAgent(agent: AgentRow): void {
  getDB().run(
    `INSERT INTO agents (id, name, role, color, skin_tone, model)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       role = excluded.role,
       color = excluded.color,
       skin_tone = excluded.skin_tone,
       model = excluded.model`,
    [agent.id, agent.name, agent.role, agent.color, agent.skin_tone, agent.model],
  );
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
  const stmt = getDB().prepare('SELECT id, name, model, philosophy, risk_tolerance, status FROM ceo LIMIT 1');
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as CEORow;
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

/** Insert or update the CEO. */
export function saveCEO(ceo: Omit<CEORow, 'id'>): void {
  getDB().run(
    `INSERT INTO ceo (id, name, model, philosophy, risk_tolerance, status)
     VALUES ('ceo', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       model = excluded.model,
       philosophy = excluded.philosophy,
       risk_tolerance = excluded.risk_tolerance,
       status = excluded.status`,
    [ceo.name, ceo.model, ceo.philosophy, ceo.risk_tolerance, ceo.status],
  );
  persist();
}

/** Update only the CEO status field. */
export function updateCEOStatus(status: string): void {
  getDB().run("UPDATE ceo SET status = ? WHERE id = 'ceo'", [status]);
  persist();
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
