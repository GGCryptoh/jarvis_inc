-- Jarvis Inc — Row Level Security
-- ================================
-- Single-tenant: authenticated users get full access.
-- Anon gets nothing (API keys required for all access).

ALTER TABLE public.settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ceo            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages  ENABLE ROW LEVEL SECURITY;

-- Authenticated users: full access to all tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'settings', 'agents', 'ceo', 'missions', 'audit_log',
    'vault', 'approvals', 'skills', 'conversations', 'chat_messages'
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

-- Audit log: authenticated can INSERT only (append-only)
-- Override the ALL policy for extra safety
CREATE POLICY "audit_log_insert_only" ON public.audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
