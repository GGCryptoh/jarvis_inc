-- Jarvis Inc — Consolidated Schema v0.1.1
-- ========================================
-- All tables, indexes, RLS policies, and Realtime publication.
-- Consolidates ALL migrations (001-011) into a single file.
-- Date: 2026-02-22
--
-- Tables (25):
--   settings, agents, ceo, missions, audit_log, vault, approvals, skills,
--   conversations, chat_messages, org_memory, conversation_summaries,
--   mission_memory, agent_skills, scheduler_state, ceo_action_queue,
--   task_executions, agent_stats, llm_usage, notification_channels, channel_usage,
--   archived_memories, skill_schedules, mission_rounds, agent_questions, test_runs

-- ─── Extensions ──────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector for semantic search
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid()

-- ═════════════════════════════════════════════════════════════════════
-- TABLES
-- ═════════════════════════════════════════════════════════════════════

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
  metadata   JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CEO
CREATE TABLE IF NOT EXISTS public.ceo (
  id                  TEXT PRIMARY KEY DEFAULT 'ceo',
  name                TEXT NOT NULL,
  model               TEXT NOT NULL,
  philosophy          TEXT NOT NULL,
  risk_tolerance      TEXT NOT NULL DEFAULT 'moderate',
  status              TEXT NOT NULL DEFAULT 'nominal',
  archetype           TEXT DEFAULT NULL,
  color               TEXT DEFAULT '#f1fa8c',
  skin_tone           TEXT DEFAULT '#ffcc99',
  desk_x              REAL DEFAULT NULL,
  desk_y              REAL DEFAULT NULL,
  backup_model        TEXT DEFAULT NULL,
  primary_failures    INTEGER NOT NULL DEFAULT 0,
  last_primary_check  TIMESTAMPTZ DEFAULT NULL,
  fallback_active     BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
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
  created_by       TEXT DEFAULT NULL,
  created_at       TIMESTAMPTZ DEFAULT now(),
  recurring_mode   TEXT DEFAULT NULL,         -- 'auto' or 'evaluate'
  last_recurred_at TIMESTAMPTZ DEFAULT NULL,
  scheduled_for    TIMESTAMPTZ DEFAULT NULL,
  task_template    JSONB DEFAULT NULL,
  current_round    INTEGER NOT NULL DEFAULT 1,
  description      TEXT DEFAULT NULL,
  max_runs         INTEGER DEFAULT NULL,
  run_count        INTEGER NOT NULL DEFAULT 0
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

-- Skills (with full definition from repo)
CREATE TABLE IF NOT EXISTS public.skills (
  id         TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  model      TEXT DEFAULT NULL,
  definition JSONB DEFAULT NULL,
  category   TEXT DEFAULT NULL,
  status     TEXT NOT NULL DEFAULT 'available',
  source     TEXT NOT NULL DEFAULT 'seed',    -- seed, github, marketplace
  version    TEXT DEFAULT NULL,
  checksum   TEXT DEFAULT NULL,
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

-- Organizational Memory
CREATE TABLE IF NOT EXISTS public.org_memory (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL DEFAULT 'fact',
  content     TEXT NOT NULL,
  source      TEXT DEFAULT NULL,
  tags        TEXT[] DEFAULT '{}',
  importance  INTEGER NOT NULL DEFAULT 5,
  embedding   VECTOR(1536) DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ DEFAULT NULL
);

-- Conversation Summaries
CREATE TABLE IF NOT EXISTS public.conversation_summaries (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  summary         TEXT NOT NULL,
  message_range   JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mission Memory
CREATE TABLE IF NOT EXISTS public.mission_memory (
  id          TEXT PRIMARY KEY,
  mission_id  TEXT NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  lesson      TEXT NOT NULL,
  outcome     TEXT NOT NULL DEFAULT 'neutral',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agent Skills (CEO assigns specific skills per agent)
CREATE TABLE IF NOT EXISTS public.agent_skills (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  skill_id    TEXT NOT NULL,
  assigned_by TEXT NOT NULL DEFAULT 'ceo',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, skill_id)
);

-- Scheduler State
CREATE TABLE IF NOT EXISTS public.scheduler_state (
  id                TEXT PRIMARY KEY DEFAULT 'main',
  status            TEXT NOT NULL DEFAULT 'stopped',
  interval_ms       INTEGER NOT NULL DEFAULT 30000,
  last_heartbeat    TIMESTAMPTZ DEFAULT NULL,
  last_cycle_result JSONB DEFAULT NULL,
  config            JSONB NOT NULL DEFAULT '{}',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CEO Action Queue
CREATE TABLE IF NOT EXISTS public.ceo_action_queue (
  id          TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  payload     JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  priority    INTEGER NOT NULL DEFAULT 5,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ DEFAULT NULL
);

-- Task Executions (no FK on agent_id — CEO tasks use agent_id='ceo')
CREATE TABLE IF NOT EXISTS public.task_executions (
  id              TEXT PRIMARY KEY,
  mission_id      TEXT REFERENCES public.missions(id) ON DELETE SET NULL,
  agent_id        TEXT DEFAULT NULL,
  skill_id        TEXT DEFAULT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  conversation    JSONB NOT NULL DEFAULT '[]',
  result          JSONB DEFAULT NULL,
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  command_name    TEXT DEFAULT NULL,
  params          JSONB DEFAULT '{}',
  model           TEXT DEFAULT NULL,
  context         JSONB DEFAULT '{}',
  started_at      TIMESTAMPTZ DEFAULT NULL,
  completed_at    TIMESTAMPTZ DEFAULT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agent Stats (performance tracking)
CREATE TABLE IF NOT EXISTS public.agent_stats (
  agent_id              TEXT PRIMARY KEY REFERENCES public.agents(id) ON DELETE CASCADE,
  rank_level            INTEGER NOT NULL DEFAULT 1,
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

-- LLM Usage (token tracking for all LLM calls)
CREATE TABLE IF NOT EXISTS public.llm_usage (
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

-- Notification Channels
CREATE TABLE IF NOT EXISTS public.notification_channels (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN ('email', 'telegram', 'sms', 'voice')),
  enabled       BOOLEAN NOT NULL DEFAULT false,
  config        JSONB NOT NULL DEFAULT '{}',
  cost_per_unit REAL NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Channel Usage
CREATE TABLE IF NOT EXISTS public.channel_usage (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT REFERENCES public.notification_channels(id),
  type        TEXT NOT NULL,
  recipient   TEXT,
  cost        REAL NOT NULL DEFAULT 0,
  mission_id  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Mission Rounds (multi-round scoring)
CREATE TABLE IF NOT EXISTS public.mission_rounds (
  id              TEXT PRIMARY KEY,
  mission_id      TEXT NOT NULL,
  round_number    INTEGER NOT NULL DEFAULT 1,
  agent_id        TEXT DEFAULT NULL,
  status          TEXT NOT NULL DEFAULT 'in_progress',
  quality_score       INTEGER DEFAULT NULL,
  completeness_score  INTEGER DEFAULT NULL,
  efficiency_score    INTEGER DEFAULT NULL,
  overall_score       INTEGER DEFAULT NULL,
  grade               TEXT DEFAULT NULL,
  ceo_review          TEXT DEFAULT NULL,
  ceo_recommendation  TEXT DEFAULT NULL,
  rejection_feedback  TEXT DEFAULT NULL,
  redo_strategy       TEXT DEFAULT NULL,
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  duration_ms     INTEGER DEFAULT NULL,
  task_count      INTEGER NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ DEFAULT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agent Questions (agents flag questions during task execution)
CREATE TABLE IF NOT EXISTS public.agent_questions (
  id                TEXT PRIMARY KEY,
  task_execution_id TEXT NOT NULL,
  mission_id        TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  question          TEXT NOT NULL,
  context           TEXT DEFAULT NULL,
  answer            TEXT DEFAULT NULL,
  answered_by       TEXT DEFAULT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at       TIMESTAMPTZ DEFAULT NULL
);

-- Test Runs (test lab results)
CREATE TABLE IF NOT EXISTS public.test_runs (
  id           TEXT PRIMARY KEY,
  test_id      TEXT NOT NULL,
  category     TEXT NOT NULL,
  label        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  mode         TEXT NOT NULL DEFAULT 'auto',
  duration_ms  INTEGER,
  output       JSONB,
  verified_by  TEXT,
  run_by       TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ═════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_chat_messages_convo     ON public.chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_org_memory_category     ON public.org_memory(category);
CREATE INDEX IF NOT EXISTS idx_org_memory_importance   ON public.org_memory(importance DESC);
CREATE INDEX IF NOT EXISTS idx_org_memory_tags         ON public.org_memory USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_org_memory_updated      ON public.org_memory(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_convo_summaries_convo   ON public.conversation_summaries(conversation_id);
CREATE INDEX IF NOT EXISTS idx_mission_memory_mission  ON public.mission_memory(mission_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_agent      ON public.agent_skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_skill      ON public.agent_skills(skill_id);
CREATE INDEX IF NOT EXISTS idx_ceo_actions_status      ON public.ceo_action_queue(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_task_exec_mission       ON public.task_executions(mission_id);
CREATE INDEX IF NOT EXISTS idx_task_exec_agent         ON public.task_executions(agent_id);
CREATE INDEX IF NOT EXISTS idx_task_exec_status        ON public.task_executions(status);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created       ON public.llm_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_context       ON public.llm_usage(context);
CREATE INDEX IF NOT EXISTS idx_llm_usage_mission       ON public.llm_usage(mission_id) WHERE mission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channel_usage_created   ON public.channel_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_usage_channel   ON public.channel_usage(channel_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_test_id       ON public.test_runs(test_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_runs_category      ON public.test_runs(category);

-- ═════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═════════════════════════════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE public.settings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ceo                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_memory             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_memory         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_skills           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduler_state        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ceo_action_queue       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_executions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_stats            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_usage              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_channels  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_usage          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_rounds         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_questions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_runs              ENABLE ROW LEVEL SECURITY;

-- Single-tenant: both anon and authenticated get full access
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'settings', 'agents', 'ceo', 'missions', 'audit_log',
    'vault', 'approvals', 'skills', 'conversations', 'chat_messages',
    'org_memory', 'conversation_summaries', 'mission_memory',
    'agent_skills', 'scheduler_state', 'ceo_action_queue',
    'task_executions', 'agent_stats', 'llm_usage',
    'notification_channels', 'channel_usage',
    'mission_rounds', 'agent_questions', 'test_runs'
  ])
  LOOP
    EXECUTE format('
      CREATE POLICY "%1$s_anon_all" ON public.%1$I
        FOR ALL TO anon USING (true) WITH CHECK (true);
    ', t);
    EXECUTE format('
      CREATE POLICY "%1$s_auth_all" ON public.%1$I
        FOR ALL TO authenticated USING (true) WITH CHECK (true);
    ', t);
  END LOOP;
END $$;

-- Audit log: extra INSERT-only policy for safety
CREATE POLICY "audit_log_insert_only" ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- ═════════════════════════════════════════════════════════════════════
-- REALTIME PUBLICATION
-- ═════════════════════════════════════════════════════════════════════

-- Enable Supabase Realtime on tables that need live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.approvals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.missions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ceo;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ceo_action_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_executions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mission_rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_questions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.test_runs;

-- ═════════════════════════════════════════════════════════════════════
-- STORAGE BUCKETS
-- ═════════════════════════════════════════════════════════════════════

-- Bucket for AI-generated images (public read, any role can write)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'generated-images',
  'generated-images',
  true,
  52428800,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
) ON CONFLICT (id) DO NOTHING;

-- RLS policies: allow upload and read for the generated-images bucket
CREATE POLICY "Allow public upload to generated-images"
  ON storage.objects FOR INSERT
  TO anon, authenticated, service_role
  WITH CHECK (bucket_id = 'generated-images');

CREATE POLICY "Allow public read from generated-images"
  ON storage.objects FOR SELECT
  TO anon, authenticated, service_role
  USING (bucket_id = 'generated-images');

-- Bucket for AI-generated documents (public read, any role can write)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'generated-documents',
  'generated-documents',
  true,
  10485760,
  ARRAY['text/markdown', 'text/plain', 'application/json']
) ON CONFLICT (id) DO NOTHING;

-- RLS policies: allow upload and read for the generated-documents bucket
CREATE POLICY "Allow public upload to generated-documents"
  ON storage.objects FOR INSERT
  TO anon, authenticated, service_role
  WITH CHECK (bucket_id = 'generated-documents');

CREATE POLICY "Allow public read from generated-documents"
  ON storage.objects FOR SELECT
  TO anon, authenticated, service_role
  USING (bucket_id = 'generated-documents');

-- ═════════════════════════════════════════════════════════════════════
-- Archived Memories (daily consolidation of org_memory)
-- ═════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.archived_memories (
  id              TEXT PRIMARY KEY,
  day             DATE NOT NULL,
  topic           TEXT DEFAULT NULL,
  consolidated    TEXT NOT NULL,
  source_count    INTEGER NOT NULL DEFAULT 0,
  source_ids      TEXT[] DEFAULT '{}',
  importance      INTEGER NOT NULL DEFAULT 7,
  tags            TEXT[] DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_archived_memories_day ON public.archived_memories (day DESC);
CREATE INDEX IF NOT EXISTS idx_archived_memories_topic ON public.archived_memories (topic);

ALTER TABLE public.archived_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to archived_memories"
  ON public.archived_memories FOR ALL
  TO anon, authenticated, service_role
  USING (true) WITH CHECK (true);

-- ═════════════════════════════════════════════════════════════════════
-- Skill Schedules (recurring skill execution)
-- ═════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS skill_schedules (
  id           TEXT PRIMARY KEY,
  skill_id     TEXT NOT NULL,
  command_name TEXT NOT NULL,
  frequency    TEXT NOT NULL CHECK (frequency IN ('hourly', 'every_4h', 'daily', 'weekly', 'monthly')),
  run_at_time  TEXT NOT NULL DEFAULT '03:00',
  run_on_day   INTEGER DEFAULT NULL,
  params       JSONB DEFAULT '{}',
  enabled      BOOLEAN NOT NULL DEFAULT true,
  last_run_at  TIMESTAMPTZ DEFAULT NULL,
  next_run_at  TIMESTAMPTZ DEFAULT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE skill_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "skill_schedules_anon_all" ON skill_schedules FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "skill_schedules_auth_all" ON skill_schedules FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_skill_schedules_next_run ON skill_schedules(next_run_at) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_skill_schedules_skill ON skill_schedules(skill_id);
