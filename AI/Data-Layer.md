# Data Layer — Design Reference

> Committed project documentation. Defines the database schema, persistence model,
> Supabase client architecture, realtime subscriptions, and migration history.

### Implementation Status (2026-02-13)
- **Shipped**: Supabase (self-hosted Docker) as sole backend — no sql.js, no IndexedDB, no dual-mode
- **Shipped**: `src/lib/supabase.ts` — Supabase client singleton (74 lines)
- **Shipped**: `src/lib/database.ts` — 44+ exported async functions, all backed by Supabase/PostgREST (1031 lines)
- **Shipped**: 21 tables across 7 migration files in `docker/supabase/migrations/`
- **Shipped**: Supabase Realtime subscriptions via `useRealtimeSubscriptions` hook (7 tables)
- **Shipped**: RLS policies — `anon` full access (single-tenant, anon key acts as service key)
- **Shipped**: 12 LLM models across 6 services with per-model cost tracking

---

## Overview

The data layer is **Supabase (self-hosted Docker)** backed by Postgres. There is no client-side database — all reads and writes go through the Supabase JS client to PostgREST. Components import functions directly from `src/lib/database.ts`; there is no DataService interface, DataContext, or dual-mode.

---

## Architecture

### Supabase Client Singleton

```typescript
// src/lib/supabase.ts
let client: SupabaseClient | null = null;

export function initSupabase(url?: string, anonKey?: string): SupabaseClient {
  // Priority: explicit args → VITE_ env vars → localStorage fallback
  const supabaseUrl = url || import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('jarvis_supabase_url');
  const supabaseKey = anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('jarvis_supabase_anon_key');

  client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },  // No auth yet — single-tenant
    realtime: { params: { eventsPerSecond: 10 } },
  });

  // Persist to localStorage for page reload survival
  localStorage.setItem('jarvis_supabase_url', supabaseUrl);
  localStorage.setItem('jarvis_supabase_anon_key', supabaseKey);
  return client;
}

export function getSupabase(): SupabaseClient {
  if (!client) throw new Error('Supabase not initialized — call initSupabase() first');
  return client;
}
```

**Other exports**: `hasSupabaseConfig()`, `pingSupabase()`, `clearSupabaseConfig()`

### Data Access Pattern

All data access is through exported async functions in `src/lib/database.ts`. Components import them directly:

```typescript
import { loadAgents, saveAgent, deleteAgent } from '../../lib/database';
```

Every function calls `getSupabase()` internally. There is no abstraction layer, no DataService interface, no React context. Key differences from the original sql.js version:

| Aspect | Current (Supabase) |
|--------|-------------------|
| **Persistence** | Postgres handles it; `persist()` is a no-op |
| **Booleans** | Postgres `BOOLEAN` (`true`/`false`), not `INTEGER` (`0`/`1`) |
| **JSON** | Postgres `JSONB` — native objects, not stringified JSON |
| **Timestamps** | `TIMESTAMPTZ` with `now()` default |
| **IDs** | `TEXT PRIMARY KEY` (except `audit_log` which uses `BIGSERIAL`) |
| **Reset** | Truncates all tables via individual DELETE statements |

### Boot Sequence

```
useDatabase() hook
  ├─ hasSupabaseConfig()?
  │   └─ NO  → error: "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY"
  │   └─ YES → initSupabase()
  ├─ pingSupabase()
  │   └─ FAIL → error: "Cannot reach Supabase. Is Docker running?"
  │   └─ OK   → continue
  ├─ isFounderInitialized()  (checks settings table for founder_name)
  ├─ isCEOInitialized()      (checks ceo table for any row)
  ├─ setState({ ready, initialized, ceoInitialized })
  └─ Background: seedSkillsFromRepo()  (sync skills from GitHub)
```

The hook returns `{ ready, initialized, ceoInitialized, error, reset, reinit }`. App.tsx gates on these:
- `!ready` → "LOADING SYSTEMS..." spinner (or error screen)
- `!initialized` → FounderCeremony
- `!ceoInitialized` → CEOCeremony
- All ready → AppLayout with routes

### Realtime Subscriptions

`src/hooks/useRealtimeSubscriptions.ts` subscribes to Postgres changes and re-broadcasts them as window events:

| Table | Window Event |
|-------|-------------|
| `approvals` | `approvals-changed` |
| `agents` | `agents-changed` |
| `missions` | `missions-changed` |
| `chat_messages` | `chat-messages-changed` |
| `ceo` | `ceo-changed` |
| `ceo_action_queue` | `ceo-actions-changed` |
| `task_executions` | `task-executions-changed` |

Components that already used `window.addEventListener` for cross-component sync now get live updates from Postgres without refactoring.

---

## Schema (21 Tables)

### Migration 001: Initial Schema (`001_initial_schema.sql`)

10 tables — the core application tables.

#### settings
```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```
Key settings: `founder_name`, `org_name`, `ceo_walked_in`, `ceo_meeting_done`, `primary_mission`

#### agents
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### ceo
```sql
CREATE TABLE ceo (
  id              TEXT PRIMARY KEY DEFAULT 'ceo',
  name            TEXT NOT NULL,
  model           TEXT NOT NULL,
  philosophy      TEXT NOT NULL,
  risk_tolerance  TEXT NOT NULL DEFAULT 'moderate',
  status          TEXT NOT NULL DEFAULT 'nominal',
  archetype       TEXT DEFAULT NULL,
  desk_x          REAL DEFAULT NULL,
  desk_y          REAL DEFAULT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Added by 003:
  backup_model    TEXT DEFAULT NULL,
  primary_failures INTEGER NOT NULL DEFAULT 0,
  last_primary_check TIMESTAMPTZ DEFAULT NULL,
  fallback_active BOOLEAN NOT NULL DEFAULT false,
  -- Added by 007:
  color           TEXT DEFAULT '#f1fa8c',
  skin_tone       TEXT DEFAULT '#ffcc99'
);
```

#### missions
```sql
CREATE TABLE missions (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'backlog',
  assignee   TEXT,
  priority   TEXT NOT NULL DEFAULT 'medium',
  due_date   TEXT,
  recurring  TEXT DEFAULT NULL,
  created_by TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### audit_log
```sql
CREATE TABLE audit_log (
  id        BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent     TEXT,
  action    TEXT NOT NULL,
  details   TEXT,
  severity  TEXT NOT NULL DEFAULT 'info'
);
```

#### vault
```sql
CREATE TABLE vault (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'api_key',
  service    TEXT NOT NULL,
  key_value  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### approvals
```sql
CREATE TABLE approvals (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  metadata    JSONB DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### skills
```sql
CREATE TABLE skills (
  id         TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  model      TEXT DEFAULT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Added by 003:
  definition JSONB DEFAULT NULL,
  category   TEXT DEFAULT NULL,
  status     TEXT NOT NULL DEFAULT 'available',
  source     TEXT NOT NULL DEFAULT 'seed'
);
```

#### conversations
```sql
CREATE TABLE conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'general',
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### chat_messages
```sql
CREATE TABLE chat_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender          TEXT NOT NULL,        -- 'ceo' | 'user' | 'system'
  text            TEXT NOT NULL,
  metadata        JSONB DEFAULT NULL,   -- action cards, skill cards, tool calls, etc.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_convo ON chat_messages(conversation_id, created_at);
```

### Migration 002: RLS Policies (`002_rls_policies.sql`)

Enables Row Level Security on all 10 initial tables. Creates `authenticated` full-access policies for each table, plus an `INSERT`-only policy on `audit_log` for extra safety.

### Migration 003: Memory & Autonomy (`003_memory_and_autonomy.sql`)

8 new tables + extensions to `ceo` and `skills` tables. Enables `pgvector` extension.

#### org_memory
```sql
CREATE TABLE org_memory (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL DEFAULT 'fact',    -- fact, decision, preference, insight, reminder
  content     TEXT NOT NULL,
  source      TEXT DEFAULT NULL,               -- conversation_id, mission_id, or 'system'
  tags        TEXT[] DEFAULT '{}',
  importance  INTEGER NOT NULL DEFAULT 5,      -- 1-10
  embedding   VECTOR(1536) DEFAULT NULL,       -- pgvector for semantic search
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ DEFAULT NULL
);
-- Indexes: category, importance DESC, tags (GIN), updated_at DESC
```

#### conversation_summaries
```sql
CREATE TABLE conversation_summaries (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  summary         TEXT NOT NULL,
  message_range   JSONB NOT NULL,              -- { "from_id", "to_id", "count" }
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### mission_memory
```sql
CREATE TABLE mission_memory (
  id          TEXT PRIMARY KEY,
  mission_id  TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  lesson      TEXT NOT NULL,
  outcome     TEXT NOT NULL DEFAULT 'neutral', -- success, failure, neutral
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### agent_skills
```sql
CREATE TABLE agent_skills (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id    TEXT NOT NULL,
  assigned_by TEXT NOT NULL DEFAULT 'ceo',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, skill_id)
);
-- Indexes: agent_id, skill_id
```

#### scheduler_state
```sql
CREATE TABLE scheduler_state (
  id                TEXT PRIMARY KEY DEFAULT 'main',
  status            TEXT NOT NULL DEFAULT 'stopped',   -- running, paused, stopped
  interval_ms       INTEGER NOT NULL DEFAULT 30000,
  last_heartbeat    TIMESTAMPTZ DEFAULT NULL,
  last_cycle_result JSONB DEFAULT NULL,
  config            JSONB NOT NULL DEFAULT '{}',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### ceo_action_queue
```sql
CREATE TABLE ceo_action_queue (
  id          TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,                   -- hire_agent, assign_mission, request_approval, send_message, enable_skill
  payload     JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending, executing, completed, failed
  priority    INTEGER NOT NULL DEFAULT 5,      -- 1-10
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ DEFAULT NULL
);
-- Index: status + priority DESC
```

#### task_executions
```sql
CREATE TABLE task_executions (
  id              TEXT PRIMARY KEY,
  mission_id      TEXT REFERENCES missions(id) ON DELETE SET NULL,
  agent_id        TEXT,                        -- FK dropped in 006 (CEO uses agent_id='ceo')
  skill_id        TEXT DEFAULT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  conversation    JSONB NOT NULL DEFAULT '[]',
  result          JSONB DEFAULT NULL,
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ DEFAULT NULL,
  completed_at    TIMESTAMPTZ DEFAULT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Added by 006:
  command_name    TEXT DEFAULT NULL,
  params          JSONB DEFAULT '{}',
  model           TEXT DEFAULT NULL,
  context         JSONB DEFAULT '{}'
);
-- Indexes: mission_id, agent_id, status
```

#### agent_stats
```sql
CREATE TABLE agent_stats (
  agent_id              TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  rank_level            INTEGER NOT NULL DEFAULT 1,      -- 1-8
  rank_title            TEXT NOT NULL DEFAULT 'Intern',
  tasks_completed       INTEGER NOT NULL DEFAULT 0,
  tasks_failed          INTEGER NOT NULL DEFAULT 0,
  coworker_assists      INTEGER NOT NULL DEFAULT 0,
  coworker_requests     INTEGER NOT NULL DEFAULT 0,
  ceo_special_missions  INTEGER NOT NULL DEFAULT 0,
  tokens_total          INTEGER NOT NULL DEFAULT 0,
  cost_total_usd        REAL NOT NULL DEFAULT 0,
  xp                    INTEGER NOT NULL DEFAULT 0,
  last_promotion_at     TIMESTAMPTZ DEFAULT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

This migration also:
- Adds `backup_model`, `primary_failures`, `last_primary_check`, `fallback_active` columns to `ceo`
- Adds `definition` (JSONB), `category`, `status`, `source` columns to `skills`
- Enables RLS + creates `anon` full-access policies on all 18 tables

### Migration 004: LLM Usage (`004_llm_usage.sql`)

#### llm_usage
```sql
CREATE TABLE llm_usage (
  id              TEXT PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT now(),
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  estimated_cost  REAL NOT NULL DEFAULT 0,
  context         TEXT NOT NULL CHECK (context IN ('ceo_chat', 'skill_execution', 'memory_extraction', 'conversation_summary')),
  mission_id      TEXT,
  agent_id        TEXT,
  conversation_id TEXT
);
-- Indexes: created_at DESC, context, mission_id (partial)
```

### Migration 005: Notification Channels (`005_channels.sql`)

#### notification_channels
```sql
CREATE TABLE notification_channels (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN ('email', 'telegram', 'sms', 'voice')),
  enabled       BOOLEAN NOT NULL DEFAULT false,
  config        JSONB NOT NULL DEFAULT '{}',
  cost_per_unit REAL NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
```

#### channel_usage
```sql
CREATE TABLE channel_usage (
  id         TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES notification_channels(id),
  type       TEXT NOT NULL,
  recipient  TEXT,
  cost       REAL NOT NULL DEFAULT 0,
  mission_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Indexes: created_at DESC, channel_id
```

### Migration 006: Task Execution Columns (`006_task_exec_columns.sql`)

Adds columns to `task_executions`: `command_name`, `params` (JSONB), `model`, `context` (JSONB). Drops the `agent_id` foreign key so CEO tasks (`agent_id='ceo'`) work without referencing the `agents` table.

### Migration 007: CEO Appearance (`007_ceo_appearance.sql`)

Adds `color` and `skin_tone` columns to `ceo` table for sprite customization.

---

## Exported Functions (database.ts)

### Settings
| Function | Signature |
|----------|-----------|
| `getSetting` | `(key: string) => Promise<string \| null>` |
| `setSetting` | `(key: string, value: string) => Promise<void>` |
| `isFounderInitialized` | `() => Promise<boolean>` |
| `getFounderInfo` | `() => Promise<{ founderName, orgName } \| null>` |

### Agents
| Function | Signature |
|----------|-----------|
| `loadAgents` | `() => Promise<AgentRow[]>` |
| `saveAgent` | `(agent) => Promise<void>` |
| `saveAgentDeskPosition` | `(id, x, y) => Promise<void>` |
| `seedAgentsIfEmpty` | `(agents) => Promise<void>` |
| `deleteAgent` | `(id) => Promise<void>` |
| `loadAgentActivity` | `(agentId) => Promise<AgentActivity>` |
| `getAgentConfidence` | `(agentId) => Promise<number>` |

### CEO
| Function | Signature |
|----------|-----------|
| `isCEOInitialized` | `() => Promise<boolean>` |
| `loadCEO` | `() => Promise<CEORow \| null>` |
| `saveCEO` | `(ceo) => Promise<void>` |
| `updateCEOStatus` | `(status) => Promise<void>` |
| `saveCEODeskPosition` | `(x, y) => Promise<void>` |
| `updateCEOFallback` | `(fallbackActive, primaryFailures) => Promise<void>` |
| `updateCEOAppearance` | `(color, skinTone, name?) => Promise<void>` |
| `fireCEO` | `() => Promise<void>` |

### Missions
| Function | Signature |
|----------|-----------|
| `loadMissions` | `() => Promise<MissionRow[]>` (client-side sorted) |
| `saveMission` | `(mission) => Promise<void>` |
| `updateMissionStatus` | `(id, status) => Promise<void>` |
| `updateMission` | `(id, fields) => Promise<void>` |
| `deleteMission` | `(id) => Promise<void>` |
| `getMissionReviewCount` | `() => Promise<number>` |
| `seedMissionsIfEmpty` | `(missions) => Promise<void>` |

### Vault
| Function | Signature |
|----------|-----------|
| `loadVaultEntries` | `() => Promise<VaultRow[]>` |
| `saveVaultEntry` | `(entry) => Promise<void>` |
| `updateVaultEntry` | `(id, fields) => Promise<void>` |
| `deleteVaultEntry` | `(id) => Promise<void>` |
| `getVaultEntryByService` | `(service) => Promise<VaultRow \| null>` |
| `getEntitiesUsingService` | `(service) => Promise<{ type, name, model }[]>` |

### Approvals
| Function | Signature |
|----------|-----------|
| `loadApprovals` | `() => Promise<ApprovalRow[]>` (pending only) |
| `loadAllApprovals` | `() => Promise<ApprovalRow[]>` |
| `saveApproval` | `(approval) => Promise<void>` |
| `updateApprovalStatus` | `(id, status) => Promise<void>` |
| `getPendingApprovalCount` | `() => Promise<number>` |

### Skills
| Function | Signature |
|----------|-----------|
| `loadSkills` | `() => Promise<SkillRow[]>` |
| `saveSkill` | `(id, enabled, model) => Promise<void>` |
| `updateSkillModel` | `(id, model) => Promise<void>` |
| `seedSkill` | `(id, definition, category) => Promise<void>` |
| `clearAllSkills` | `() => Promise<void>` |
| `upsertSkillDefinition` | `(id, definition, category, source?) => Promise<'created' \| 'updated' \| 'unchanged'>` |

### Conversations & Chat
| Function | Signature |
|----------|-----------|
| `loadConversations` | `() => Promise<ConversationRow[]>` |
| `getConversation` | `(id) => Promise<ConversationRow \| null>` |
| `saveConversation` | `(conv) => Promise<void>` |
| `updateConversation` | `(id, fields) => Promise<void>` |
| `deleteConversation` | `(id) => Promise<void>` |
| `getOnboardingConversation` | `() => Promise<ConversationRow \| null>` |
| `loadChatMessages` | `(conversationId) => Promise<ChatMessageRow[]>` |
| `saveChatMessage` | `(msg) => Promise<void>` |
| `deleteChatMessages` | `(conversationId) => Promise<void>` |
| `countChatMessages` | `(conversationId) => Promise<number>` |
| `getLastChatMessage` | `(conversationId) => Promise<ChatMessageRow \| null>` |
| `getUnreadConversationCount` | `() => Promise<number>` |
| `markConversationRead` | `(id, count) => void` (localStorage) |
| `getConversationReadCount` | `(id) => number` (localStorage) |

### Agent Skills (Assignment)
| Function | Signature |
|----------|-----------|
| `getAgentSkills` | `(agentId) => Promise<AgentSkillRow[]>` |
| `assignSkillToAgent` | `(agentId, skillId, assignedBy?) => Promise<void>` |
| `removeSkillFromAgent` | `(agentId, skillId) => Promise<void>` |
| `getAgentsWithSkill` | `(skillId) => Promise<AgentSkillRow[]>` |

### Task Executions
| Function | Signature |
|----------|-----------|
| `loadTaskExecutions` | `(missionId) => Promise<any[]>` |
| `getNewCollateralCount` | `() => Promise<number>` |

### Notification Channels
| Function | Signature |
|----------|-----------|
| `loadChannels` | `() => Promise<ChannelRow[]>` |
| `saveChannel` | `(channel) => Promise<void>` |
| `deleteChannel` | `(id) => Promise<void>` |

### Audit
| Function | Signature |
|----------|-----------|
| `logAudit` | `(agent, action, details, severity?) => Promise<void>` |
| `loadAuditLog` | `(limit?) => Promise<AuditLogRow[]>` |

### Utilities
| Function | Signature |
|----------|-----------|
| `exportDatabaseAsJSON` | `() => Promise<Record<string, unknown[]>>` |
| `resetDatabase` | `(options?: { keepMemory? }) => Promise<void>` |
| `persist` | `() => Promise<void>` (no-op) |

---

## Model Service Mapping

```typescript
// src/lib/models.ts — 12 models across 6 services
export const MODEL_OPTIONS = [
  'Claude Opus 4.6', 'Claude Opus 4.5', 'Claude Sonnet 4.5', 'Claude Haiku 4.5',
  'GPT-5.2', 'o3-pro', 'o4-mini',
  'Gemini 3 Pro', 'Gemini 2.5 Flash',
  'DeepSeek R1', 'Llama 3.3', 'Grok 4',
];

export const MODEL_SERVICE_MAP: Record<string, string> = {
  'Claude Opus 4.6': 'Anthropic',  'Claude Opus 4.5': 'Anthropic',
  'Claude Sonnet 4.5': 'Anthropic', 'Claude Haiku 4.5': 'Anthropic',
  'GPT-5.2': 'OpenAI', 'o3-pro': 'OpenAI', 'o4-mini': 'OpenAI',
  'Gemini 3 Pro': 'Google', 'Gemini 2.5 Flash': 'Google',
  'DeepSeek R1': 'DeepSeek', 'Llama 3.3': 'Meta', 'Grok 4': 'xAI',
};
```

Also exports: `MODEL_API_IDS` (display name to API model ID), `MODEL_COSTS` (per-1M-token rates `[input, output]`), `estimateCost()`, `getServiceForModel()`, `SERVICE_KEY_HINTS`, `SERVICE_KEY_VALIDATORS`, `validateApiKeyFormat()`.

---

## Key Files

| File | Role |
|------|------|
| `src/lib/supabase.ts` | Supabase client singleton — init, get, ping, config check, clear |
| `src/lib/database.ts` | All CRUD operations (44+ functions), all backed by Supabase PostgREST |
| `src/lib/models.ts` | 12 LLM models, 6 services, cost map, API ID map, key validators |
| `src/hooks/useDatabase.ts` | Boot hook: connect to Supabase, check founder/CEO init state, expose reset/reinit |
| `src/hooks/useRealtimeSubscriptions.ts` | Supabase Realtime → window events bridge (7 tables) |
| `src/lib/memory.ts` | Memory system: save/query/extract org memories, conversation summaries |
| `src/lib/llmUsage.ts` | LLM usage tracking: log, query totals, monthly spend |
| `src/lib/ceoScheduler.ts` | CEO scheduler: heartbeat, cycle evaluation, scheduler state |
| `src/lib/ceoDecisionEngine.ts` | CEO decision engine: evaluate state, produce actions |
| `src/lib/ceoActionQueue.ts` | Action queue: enqueue, dequeue, mark seen/dismissed |
| `src/types/index.ts` | TypeScript types for Agent, CEO, Mission, etc. |
| `docker/supabase/migrations/` | 7 migration files defining all 21 tables |
