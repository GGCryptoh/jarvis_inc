-- 008_recurring_fixes.sql
-- Fix invalid cron values, add recurring/scoring columns, create mission_rounds table

-- Fix invalid cron values (e.g., "Weekly" -> proper cron)
UPDATE public.missions SET recurring = '0 9 * * 1' WHERE recurring = 'Weekly';

-- Add task_template for recurring replay
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS task_template JSONB DEFAULT NULL;

-- Add scoring/round columns
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS current_round INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS description TEXT DEFAULT NULL;

-- mission_rounds table for multi-round scoring
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

-- RLS
ALTER TABLE public.mission_rounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON public.mission_rounds FOR ALL TO anon USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.mission_rounds;
