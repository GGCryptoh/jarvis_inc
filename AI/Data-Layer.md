# Data Layer — Design Reference

> Committed project documentation. Defines the database schema, persistence model,
> dual-mode architecture (sql.js demo vs Supabase full), and migration path.

### Implementation Status (2026-02-12)
- **Shipped**: sql.js singleton (`src/lib/database.ts`, ~870 lines), IndexedDB persistence, **10 tables** (settings, agents, ceo, missions, audit_log, vault, approvals, skills, conversations, chat_messages)
- **Shipped**: Postgres migrations in `docker/supabase/migrations/` (001 schema + 002 RLS)
- **Not yet built**: DataService interface, SqliteDataService wrapper, SupabaseDataService, DataContext + useData() hook, dual-mode boot screen
- **Note**: Doc below references 8 tables; actual schema now has 10 (conversations + chat_messages added for chat persistence)

---

## Overview

The data layer is currently a **single-file SQLite database** running entirely in the browser via sql.js (WebAssembly). It persists to IndexedDB. This is the "demo mode" — zero dependencies, works offline.

The planned "full mode" adds Supabase (self-hosted Docker) as the production backend, with the same schema but real Postgres, auth, realtime subscriptions, and server-side execution.

---

## Current Architecture (Demo Mode)

### Singleton Pattern

```typescript
// src/lib/database.ts
let db: Database | null = null;

export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  const saved = await loadFromIndexedDB();
  db = saved ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();
  // Run schema creation...
  await persist();
  return db;
}

export function getDB(): Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}
```

### Persistence

- Every write operation calls `persist()` (fire-and-forget async)
- `persist()` exports the full DB binary via `db.export()` and saves to IndexedDB
- On boot, `initDatabase()` tries to restore from IndexedDB first
- Key: `jarvis_inc_db` in IndexedDB store `kv`

### Limitations

| Limitation | Impact |
|-----------|--------|
| Main-thread only | sql.js can't run in Web Workers |
| Single-tab | Two tabs = two separate DB instances, writes conflict |
| Browser-only | No server-side access, no cron jobs |
| No auth | Anyone with browser access has full control |
| No realtime | Other tabs/devices can't see changes |
| Full export on every write | Performance degrades with large DB |

---

## Schema (8 Tables)

### settings
```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```
Key settings: `founder_name`, `org_name`, `ceo_walked_in`, `ceo_meeting_done`, `primary_mission`

### agents
```sql
CREATE TABLE agents (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  color      TEXT NOT NULL,
  skin_tone  TEXT NOT NULL,
  model      TEXT NOT NULL,
  desk_x     REAL DEFAULT NULL,
  desk_y     REAL DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```
Future columns: `system_prompt`, `description`, `skills` (JSON array), `hired_by`, `tasks_assigned`, `tokens_used`, `cost_total`, `current_task_id`

### ceo
```sql
CREATE TABLE ceo (
  id              TEXT PRIMARY KEY DEFAULT 'ceo',
  name            TEXT NOT NULL,
  model           TEXT NOT NULL,
  philosophy      TEXT NOT NULL,
  risk_tolerance  TEXT NOT NULL DEFAULT 'moderate',
  status          TEXT NOT NULL DEFAULT 'nominal',
  desk_x          REAL DEFAULT NULL,
  desk_y          REAL DEFAULT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```
Future columns: `token_budget_daily`, `tokens_used_today`, `cost_today`, `last_heartbeat`, `autonomous_mode`

### missions
```sql
CREATE TABLE missions (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'backlog',
  assignee  TEXT,
  priority  TEXT NOT NULL DEFAULT 'medium',
  due_date  TEXT
);
```

### audit_log
```sql
CREATE TABLE audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  agent     TEXT,
  action    TEXT NOT NULL,
  details   TEXT,
  severity  TEXT NOT NULL DEFAULT 'info'
);
```

### vault
```sql
CREATE TABLE vault (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'api_key',
  service    TEXT NOT NULL,
  key_value  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### approvals
```sql
CREATE TABLE approvals (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  metadata    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### skills
```sql
CREATE TABLE skills (
  id         TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 0,
  model      TEXT DEFAULT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## Future Tables (Full Mode)

### chat_messages
```sql
CREATE TABLE chat_messages (
  id         TEXT PRIMARY KEY,
  sender     TEXT NOT NULL,        -- 'ceo' | 'user' | 'system'
  text       TEXT NOT NULL,
  metadata   TEXT DEFAULT NULL,    -- JSON: action cards, skill cards, etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### ceo_action_queue
```sql
CREATE TABLE ceo_action_queue (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  payload           TEXT NOT NULL,
  priority          INTEGER DEFAULT 0,
  requires_approval INTEGER DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at       TEXT DEFAULT NULL
);
```

### scheduler_state
```sql
CREATE TABLE scheduler_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### task_executions
```sql
CREATE TABLE task_executions (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running',
  conversation    TEXT NOT NULL DEFAULT '[]',
  assigned_skills TEXT NOT NULL DEFAULT '[]',
  tokens_used     INTEGER DEFAULT 0,
  cost            REAL DEFAULT 0.0,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  paused_at       TEXT DEFAULT NULL,
  completed_at    TEXT DEFAULT NULL,
  result          TEXT DEFAULT NULL,
  error           TEXT DEFAULT NULL
);
```

---

## Dual-Mode Architecture (Planned)

### DataService Interface

```typescript
// src/lib/dataService.ts
interface DataService {
  // Settings
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;

  // Agents
  loadAgents(): Promise<AgentRow[]>;
  saveAgent(agent: AgentRow): Promise<void>;
  deleteAgent(id: string): Promise<void>;

  // CEO
  loadCEO(): Promise<CEORow | null>;
  saveCEO(ceo: CEORow): Promise<void>;

  // Skills, Missions, Vault, Approvals, etc.
  // ... same pattern: async CRUD for each table
}
```

### Implementations

| | SqliteDataService | SupabaseDataService |
|---|---|---|
| **File** | `src/lib/sqliteDataService.ts` | `src/lib/supabaseDataService.ts` |
| **Backend** | sql.js WASM + IndexedDB | Supabase JS client + Postgres |
| **Auth** | None | Supabase Auth |
| **Realtime** | Window events | Supabase Realtime subscriptions |
| **Works offline** | Yes | No (needs Docker running) |

### Boot Sequence (AppBoot)

```
AppBoot
  ├─ Check localStorage for mode preference
  ├─ if (mode === 'full') → ping Supabase health endpoint
  │   ├─ if healthy → SupabaseDataService → AuthGate → App
  │   └─ if unreachable → ReconnectScreen (retry / switch to demo)
  ├─ if (mode === 'demo') → SqliteDataService → App
  └─ if (no preference) → ModeSelectionScreen ("DEMO" vs "FULL SETUP")
```

### DataContext

```typescript
// src/contexts/DataContext.tsx
const DataContext = createContext<DataService | null>(null);

export function useData(): DataService {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('DataContext not initialized');
  return ctx;
}
```

All components will migrate from direct `import { loadAgents } from '../../lib/database'` to `const data = useData(); await data.loadAgents()`.

---

## Model Service Mapping

```typescript
// src/lib/models.ts
export const MODEL_SERVICE_MAP: Record<string, string> = {
  'Claude Opus 4.6': 'Anthropic',
  'Claude Sonnet 4.5': 'Anthropic',
  'GPT-5.2': 'OpenAI',
  'Gemini 3 Pro': 'Google',
  'DeepSeek R1': 'DeepSeek',
  'Grok 4': 'xAI',
  // ... 12 models total
};
```

Used to determine which API key is needed for a given model selection.

---

## Key Files

| File | Role |
|------|------|
| `src/lib/database.ts` | SQLite singleton, schema creation, all CRUD operations, IndexedDB persistence |
| `src/lib/models.ts` | Model list, model→service mapping, service key hints |
| `src/hooks/useDatabase.ts` | Boot hook: ready/initialized/ceoInitialized/reset/reinit |
| `src/types/index.ts` | TypeScript types for Agent, CEO, Mission, etc. |
| `public/sql-wasm.wasm` | sql.js WebAssembly binary (served as static asset) |
