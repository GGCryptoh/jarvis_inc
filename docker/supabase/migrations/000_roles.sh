#!/bin/bash
# Jarvis Inc — Role Password Bootstrap
# =====================================
# Runs AFTER the Supabase Postgres image creates its own roles.
# We only set passwords (the image creates roles but often without passwords)
# and create additional schemas/grants needed by our app.
#
# Mounted as /docker-entrypoint-initdb.d/zz_jarvis_roles.sh (sorts AFTER
# the image's init-scripts/ and migrate.sh).

echo "Jarvis: Bootstrapping role passwords and schemas..."

psql -v ON_ERROR_STOP=0 --dbname "${POSTGRES_DB:-postgres}" <<-EOSQL

  -- ── Set passwords on login roles ───────────────────────
  -- The Supabase image creates these roles but may not set passwords.
  -- Services (PostgREST, GoTrue, Realtime) connect using POSTGRES_PASSWORD.
  ALTER ROLE authenticator       WITH LOGIN NOINHERIT PASSWORD '${POSTGRES_PASSWORD}';
  ALTER ROLE supabase_auth_admin WITH LOGIN NOINHERIT CREATEROLE CREATEDB PASSWORD '${POSTGRES_PASSWORD}';
  ALTER ROLE supabase_admin      WITH LOGIN NOINHERIT PASSWORD '${POSTGRES_PASSWORD}';

  -- Storage API role
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
      CREATE ROLE supabase_storage_admin LOGIN NOINHERIT PASSWORD '${POSTGRES_PASSWORD}';
    ELSE
      ALTER ROLE supabase_storage_admin WITH LOGIN NOINHERIT PASSWORD '${POSTGRES_PASSWORD}';
    END IF;
  END \$\$;

  -- ── Additional schemas needed by services ──────────────
  CREATE SCHEMA IF NOT EXISTS _realtime;
  CREATE SCHEMA IF NOT EXISTS graphql_public;
  CREATE SCHEMA IF NOT EXISTS storage;

  ALTER SCHEMA storage OWNER TO supabase_storage_admin;
  GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
  GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

  -- Storage API needs to SET ROLE to API roles
  GRANT anon TO supabase_storage_admin;
  GRANT authenticated TO supabase_storage_admin;
  GRANT service_role TO supabase_storage_admin;

  ALTER SCHEMA auth       OWNER TO supabase_auth_admin;
  ALTER SCHEMA _realtime  OWNER TO supabase_admin;

  -- ── Public schema grants for API roles ─────────────────
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

  -- ── Auth schema ownership + grants ─────────────────────
  GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
  GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role, supabase_auth_admin;

  -- ── Transfer auth objects to supabase_auth_admin ──────
  -- GoTrue needs to own auth functions/tables so it can CREATE OR REPLACE them.
  -- Supabase init scripts create these owned by postgres/supabase_admin.
  DO \$xfer\$
  DECLARE r RECORD;
  BEGIN
    -- Transfer all functions in auth schema
    FOR r IN SELECT proname, pg_get_function_identity_arguments(oid) as args
      FROM pg_proc WHERE pronamespace = 'auth'::regnamespace
    LOOP
      EXECUTE format('ALTER FUNCTION auth.%I(%s) OWNER TO supabase_auth_admin', r.proname, r.args);
    END LOOP;
    -- Transfer all tables in auth schema
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'auth'
    LOOP
      EXECUTE format('ALTER TABLE auth.%I OWNER TO supabase_auth_admin', r.tablename);
    END LOOP;
    -- Transfer all sequences in auth schema
    FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'auth'
    LOOP
      EXECUTE format('ALTER SEQUENCE auth.%I OWNER TO supabase_auth_admin', r.sequencename);
    END LOOP;
  END\$xfer\$;

EOSQL

echo "Jarvis: Role bootstrap complete"
