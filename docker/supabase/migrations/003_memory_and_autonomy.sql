-- Jarvis Inc — Memory, Autonomy & Extended Skills Schema
-- ======================================================
-- Sprint 1: Tables for organizational memory, CEO scheduler,
-- task execution, agent skill assignments, and full skill definitions.

-- Enable pgvector for semantic similarity search on memories
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Organizational Memory ─────────────────────────────────────────
-- Facts, decisions, preferences extracted from conversations.
-- The CEO reads these on wake-up to maintain context across sessions.
CREATE TABLE IF NOT EXISTS public.org_memory (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL DEFAULT 'fact',          -- fact, decision, preference, insight, reminder
  content     TEXT NOT NULL,                          -- the memory text
  source      TEXT DEFAULT NULL,                      -- conversation_id, mission_id, or 'system'
  tags        TEXT[] DEFAULT '{}',                    -- searchable tags
  importance  INTEGER NOT NULL DEFAULT 5,             -- 1-10 scale
  embedding   VECTOR(1536) DEFAULT NULL,              -- for semantic search (populated async)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ DEFAULT NULL                -- NULL = never expires
);

CREATE INDEX IF NOT EXISTS idx_org_memory_category ON public.org_memory(category);
CREATE INDEX IF NOT EXISTS idx_org_memory_importance ON public.org_memory(importance DESC);
CREATE INDEX IF NOT EXISTS idx_org_memory_tags ON public.org_memory USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_org_memory_updated ON public.org_memory(updated_at DESC);

-- ─── Conversation Summaries ────────────────────────────────────────
-- Compressed versions of old conversation chunks.
-- Prepended as [PREVIOUS CONTEXT] when thread gets long.
CREATE TABLE IF NOT EXISTS public.conversation_summaries (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  summary         TEXT NOT NULL,
  message_range   JSONB NOT NULL,                     -- { "from_id": "...", "to_id": "...", "count": N }
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_convo_summaries_convo ON public.conversation_summaries(conversation_id);

-- ─── Mission Memory ────────────────────────────────────────────────
-- Learnings tied to specific missions for future similar tasks.
CREATE TABLE IF NOT EXISTS public.mission_memory (
  id          TEXT PRIMARY KEY,
  mission_id  TEXT NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  lesson      TEXT NOT NULL,
  outcome     TEXT NOT NULL DEFAULT 'neutral',        -- success, failure, neutral
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mission_memory_mission ON public.mission_memory(mission_id);

-- ─── Agent Skills (assignment table) ───────────────────────────────
-- CEO assigns specific skills to specific agents. Not global.
CREATE TABLE IF NOT EXISTS public.agent_skills (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  skill_id    TEXT NOT NULL,
  assigned_by TEXT NOT NULL DEFAULT 'ceo',             -- who assigned it
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON public.agent_skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_skill ON public.agent_skills(skill_id);

-- ─── Scheduler State ───────────────────────────────────────────────
-- CEO scheduler heartbeat and configuration.
CREATE TABLE IF NOT EXISTS public.scheduler_state (
  id              TEXT PRIMARY KEY DEFAULT 'main',
  status          TEXT NOT NULL DEFAULT 'stopped',     -- running, paused, stopped
  interval_ms     INTEGER NOT NULL DEFAULT 30000,
  last_heartbeat  TIMESTAMPTZ DEFAULT NULL,
  last_cycle_result JSONB DEFAULT NULL,                -- summary of last evaluateCycle()
  config          JSONB NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── CEO Action Queue ──────────────────────────────────────────────
-- Actions produced by the decision engine, waiting to execute.
CREATE TABLE IF NOT EXISTS public.ceo_action_queue (
  id          TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,                           -- hire_agent, assign_mission, request_approval, send_message, enable_skill
  payload     JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',         -- pending, executing, completed, failed
  priority    INTEGER NOT NULL DEFAULT 5,              -- 1-10
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_ceo_actions_status ON public.ceo_action_queue(status, priority DESC);

-- ─── Task Executions ───────────────────────────────────────────────
-- Tracks agent task work: persistent conversation, mid-task approvals.
CREATE TABLE IF NOT EXISTS public.task_executions (
  id              TEXT PRIMARY KEY,
  mission_id      TEXT REFERENCES public.missions(id) ON DELETE SET NULL,
  agent_id        TEXT REFERENCES public.agents(id) ON DELETE SET NULL,
  skill_id        TEXT DEFAULT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',     -- pending, running, paused, completed, failed
  conversation    JSONB NOT NULL DEFAULT '[]',         -- LLM message history for this task
  result          JSONB DEFAULT NULL,                  -- structured output
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ DEFAULT NULL,
  completed_at    TIMESTAMPTZ DEFAULT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_exec_mission ON public.task_executions(mission_id);
CREATE INDEX IF NOT EXISTS idx_task_exec_agent ON public.task_executions(agent_id);
CREATE INDEX IF NOT EXISTS idx_task_exec_status ON public.task_executions(status);

-- ─── Agent Ranks / Promotions ──────────────────────────────────────
-- Track agent performance for the 8-level promotion system.
CREATE TABLE IF NOT EXISTS public.agent_stats (
  agent_id              TEXT PRIMARY KEY REFERENCES public.agents(id) ON DELETE CASCADE,
  rank_level            INTEGER NOT NULL DEFAULT 1,    -- 1-8
  rank_title            TEXT NOT NULL DEFAULT 'Intern',
  tasks_completed       INTEGER NOT NULL DEFAULT 0,
  tasks_failed          INTEGER NOT NULL DEFAULT 0,
  coworker_assists      INTEGER NOT NULL DEFAULT 0,    -- times called by other agents
  coworker_requests     INTEGER NOT NULL DEFAULT 0,    -- times asked other agents for help
  ceo_special_missions  INTEGER NOT NULL DEFAULT 0,    -- direct CEO assignments completed
  tokens_total          INTEGER NOT NULL DEFAULT 0,
  cost_total_usd        REAL NOT NULL DEFAULT 0,
  xp                    INTEGER NOT NULL DEFAULT 0,    -- computed promotion points
  last_promotion_at     TIMESTAMPTZ DEFAULT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── CEO backup model + degraded state ─────────────────────────────
ALTER TABLE public.ceo ADD COLUMN IF NOT EXISTS backup_model TEXT DEFAULT NULL;
ALTER TABLE public.ceo ADD COLUMN IF NOT EXISTS primary_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.ceo ADD COLUMN IF NOT EXISTS last_primary_check TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE public.ceo ADD COLUMN IF NOT EXISTS fallback_active BOOLEAN NOT NULL DEFAULT false;

-- ─── Extend skills table with full definition ──────────────────────
-- Add JSONB column to store the complete skill definition from the repo.
-- This replaces the hardcoded skillDefinitions.ts.
ALTER TABLE public.skills ADD COLUMN IF NOT EXISTS definition JSONB DEFAULT NULL;
ALTER TABLE public.skills ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL;
ALTER TABLE public.skills ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'available';
ALTER TABLE public.skills ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'seed';  -- seed, github, marketplace

-- ─── RLS Policies for new tables ───────────────────────────────────
ALTER TABLE public.org_memory            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_memory        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_skills          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduler_state       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ceo_action_queue      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_executions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_stats           ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'org_memory', 'conversation_summaries', 'mission_memory',
    'agent_skills', 'scheduler_state', 'ceo_action_queue',
    'task_executions', 'agent_stats'
  ])
  LOOP
    EXECUTE format('
      CREATE POLICY "%1$s_auth_all" ON public.%1$I
        FOR ALL
        TO authenticated
        USING (true)
        WITH CHECK (true);
    ', t);
  END LOOP;
END $$;

-- Anon full access for PostgREST (single-tenant, anon key acts as service key)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'org_memory', 'conversation_summaries', 'mission_memory',
    'agent_skills', 'scheduler_state', 'ceo_action_queue',
    'task_executions', 'agent_stats',
    'settings', 'agents', 'ceo', 'missions', 'audit_log',
    'vault', 'approvals', 'skills', 'conversations', 'chat_messages'
  ])
  LOOP
    -- Drop + recreate to avoid "already exists" errors on re-run
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_anon_all" ON public.%1$I', t);
    EXECUTE format('
      CREATE POLICY "%1$s_anon_all" ON public.%1$I
        FOR ALL
        TO anon
        USING (true)
        WITH CHECK (true);
    ', t);
  END LOOP;
END $$;
