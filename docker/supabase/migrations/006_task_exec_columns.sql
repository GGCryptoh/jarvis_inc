-- Add missing columns to task_executions needed by skill dispatcher
-- command_name: which command within a skill to execute
-- params: skill command parameters (JSONB)
-- model: LLM model name used for execution
-- context: assembled context (memories, conversation excerpt)

ALTER TABLE public.task_executions
  ADD COLUMN IF NOT EXISTS command_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS params       JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS model        TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS context      JSONB DEFAULT '{}';

-- Drop the FK on agent_id so CEO tasks (agent_id='ceo') work.
-- The CEO lives in the 'ceo' table, not 'agents'.
-- We keep agent_id as TEXT for flexibility.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'task_executions_agent_id_fkey'
      AND table_name = 'task_executions'
  ) THEN
    ALTER TABLE public.task_executions DROP CONSTRAINT task_executions_agent_id_fkey;
  END IF;
END $$;
