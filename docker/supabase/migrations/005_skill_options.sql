-- Add options_config JSONB column to skills table for per-skill option storage
ALTER TABLE skills ADD COLUMN IF NOT EXISTS options_config JSONB DEFAULT '{}';
