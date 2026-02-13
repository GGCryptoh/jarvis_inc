-- Notification channels + usage tracking
CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('email', 'telegram', 'sms', 'voice')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{}',
  cost_per_unit REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_usage (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES notification_channels(id),
  type TEXT NOT NULL,
  recipient TEXT,
  cost REAL NOT NULL DEFAULT 0,
  mission_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_usage_created ON channel_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_usage_channel ON channel_usage (channel_id);

-- RLS
ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channels_anon_all" ON notification_channels FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "channels_auth_all" ON notification_channels FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE channel_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channel_usage_anon_all" ON channel_usage FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "channel_usage_auth_all" ON channel_usage FOR ALL TO authenticated USING (true) WITH CHECK (true);
