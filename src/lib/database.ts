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
