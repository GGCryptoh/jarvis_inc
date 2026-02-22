-- 007_ceo_command_authority.sql
-- Adds scheduled_for to missions and metadata to agents

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
