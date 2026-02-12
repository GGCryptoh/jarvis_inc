-- Jarvis Inc — Initial Schema (mirrors sql.js client-side tables)
-- ================================================================

-- Settings (key-value store)
CREATE TABLE IF NOT EXISTS public.settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Agents
CREATE TABLE IF NOT EXISTS public.agents (
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

-- CEO
CREATE TABLE IF NOT EXISTS public.ceo (
  id              TEXT PRIMARY KEY DEFAULT 'ceo',
  name            TEXT NOT NULL,
  model           TEXT NOT NULL,
  philosophy      TEXT NOT NULL,
  risk_tolerance  TEXT NOT NULL DEFAULT 'moderate',
  status          TEXT NOT NULL DEFAULT 'nominal',
  archetype       TEXT DEFAULT NULL,
  desk_x          REAL DEFAULT NULL,
  desk_y          REAL DEFAULT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Missions
CREATE TABLE IF NOT EXISTS public.missions (
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

-- Audit log (append-only)
CREATE TABLE IF NOT EXISTS public.audit_log (
  id        BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent     TEXT,
  action    TEXT NOT NULL,
  details   TEXT,
  severity  TEXT NOT NULL DEFAULT 'info'
);

-- Vault (API keys & secrets)
CREATE TABLE IF NOT EXISTS public.vault (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'api_key',
  service    TEXT NOT NULL,
  key_value  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Approvals
CREATE TABLE IF NOT EXISTS public.approvals (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  metadata    JSONB DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Skills
CREATE TABLE IF NOT EXISTS public.skills (
  id         TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  model      TEXT DEFAULT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversations
CREATE TABLE IF NOT EXISTS public.conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'general',
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chat messages
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender          TEXT NOT NULL,
  text            TEXT NOT NULL,
  metadata        JSONB DEFAULT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_convo ON public.chat_messages(conversation_id, created_at);
