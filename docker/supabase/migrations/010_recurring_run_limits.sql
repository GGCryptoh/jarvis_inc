-- 010: Recurring Mission Run Limits
-- Adds max_runs (optional cap) and run_count (counter) to missions table
-- for time-limited recurring tasks ("every hour for 3 hours").

ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS max_runs INTEGER DEFAULT NULL;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS run_count INTEGER NOT NULL DEFAULT 0;
