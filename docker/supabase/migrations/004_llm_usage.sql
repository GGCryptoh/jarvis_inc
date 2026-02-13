-- Token usage tracking for all LLM calls
CREATE TABLE IF NOT EXISTS llm_usage (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  estimated_cost REAL NOT NULL DEFAULT 0,
  context TEXT NOT NULL CHECK (context IN ('ceo_chat', 'skill_execution', 'memory_extraction', 'conversation_summary')),
  mission_id TEXT,
  agent_id TEXT,
  conversation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_context ON llm_usage (context);
CREATE INDEX IF NOT EXISTS idx_llm_usage_mission ON llm_usage (mission_id) WHERE mission_id IS NOT NULL;

-- RLS
ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "llm_usage_anon_all" ON llm_usage FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "llm_usage_authenticated_all" ON llm_usage FOR ALL TO authenticated USING (true) WITH CHECK (true);
