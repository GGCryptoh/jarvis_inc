-- 009_agent_questions.sql
-- Agent question routing — agents can flag questions during task execution

CREATE TABLE IF NOT EXISTS public.agent_questions (
  id TEXT PRIMARY KEY,
  task_execution_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  question TEXT NOT NULL,
  context TEXT DEFAULT NULL,
  answer TEXT DEFAULT NULL,
  answered_by TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ DEFAULT NULL
);

-- RLS
ALTER TABLE public.agent_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON public.agent_questions FOR ALL TO anon USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_questions;
