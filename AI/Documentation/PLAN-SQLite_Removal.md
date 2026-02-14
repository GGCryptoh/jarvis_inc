# PLAN: SQLite Removal & Full Supabase Migration

> **STATUS: COMPLETED** — Shipped in Sprint 2 (Feb 2026)
>
> **What shipped:**
> - sql.js fully removed (`npm uninstall sql.js`, `public/sql-wasm.wasm` deleted)
> - `src/lib/supabase.ts` — Supabase client singleton
> - `src/lib/database.ts` — complete rewrite, ~40 exported functions, all call Supabase
> - `src/hooks/useDatabase.ts` — rewritten for Supabase session check
> - Supabase Docker stack fully operational (Postgres, GoTrue, PostgREST, Realtime, Kong, Studio)
> - Realtime subscriptions replacing most `window.dispatchEvent()` patterns
> - All tables live in Postgres with RLS policies
> - `docker compose up -d && npm run dev` is the only startup sequence
>
> **What didn't ship (deferred):**
> - AuthGate / LoginView — no auth enforcement yet (single-user local install)
> - Passkey enrollment — deferred
> - Founder Ceremony Stage 2 (infrastructure setup wizard) — setup.mjs handles this
> - Vite externalization cleanup — still has build warnings (harmless)
>
> **Approach taken:** Option C (Hybrid) — `setup.mjs` handles Docker config,
> Founder Ceremony does health checks + callsign/org. Clean cut, no dual-mode.

---

> Design plan for removing sql.js (browser-only SQLite) and making Supabase
> the sole data backend. The Founder Ceremony becomes the guided setup experience
> that walks the user through Docker/Supabase configuration.

---

## Overview

Today the app runs 100% on sql.js (SQLite compiled to WASM) with IndexedDB
persistence. There is no backend, no auth, no realtime, and no multi-device
support. The Supabase Docker stack exists in `docker/` but isn't wired to the
frontend.

This plan eliminates sql.js entirely and replaces it with Supabase as the only
data layer. The Founder Ceremony becomes a CRT-styled setup wizard that
configures the Docker environment, verifies services, and creates the first
admin user.

---

## Why Remove SQLite?

| SQLite (Current) | Problem |
|---|---|
| Single browser tab | Two tabs = two DBs, writes conflict |
| No auth | Anyone with browser access has full control |
| No realtime | Other tabs/devices can't see changes |
| Full binary export on every write | Performance degrades with data growth |
| No server-side execution | CEO scheduler can't run without a browser tab open |
| No cron / background jobs | Agent execution requires a backend |
| Browser storage limits | IndexedDB has quotas (varies by browser) |

Supabase solves all of these: Postgres, row-level security, auth with passkeys,
realtime subscriptions, Edge Functions for scheduling, and a proper REST API.

---

## Migration Strategy

### Approach: Clean Cut (No Dual-Mode) — IMPLEMENTED

**New approach**: Remove sql.js entirely. The app requires Supabase to run.
The Founder Ceremony handles all setup.

**Rationale**:
- Dual-mode means maintaining two data paths forever
- SQLite limitations block Phase 2 & 3 (CEO scheduler, agent execution)
- The Docker setup script (`setup.mjs`) already generates all secrets
- One path = simpler code, fewer bugs, easier to test

---

## Phase 1: Supabase Client Integration — SHIPPED

### 1.1 Dependencies
`@supabase/supabase-js` installed.

### 1.2 Supabase Client Singleton
`src/lib/supabase.ts` — creates client from env vars or localStorage.

### 1.3 Environment Variables
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` loaded from `.env` or localStorage.

---

## Phase 2: Founder Ceremony — PARTIALLY SHIPPED

Stage 1 (System Boot) and Stage 3 (Founder Registration) shipped as-is.
Stage 2 (Infrastructure Setup wizard) was NOT built — `setup.mjs` handles all Docker/Supabase config via CLI instead.

---

## Phase 3: Database Function Migration — SHIPPED

Every function in `src/lib/database.ts` was rewritten with the same export signature but calling Supabase. ~40 functions total. Components import unchanged.

### Migration Map (all completed)

| SQLite Function | Supabase Implementation |
|---|---|
| `initDatabase()` | `initSupabase(url, key)` |
| `getDB()` | `getSupabase()` |
| `persist()` | *(removed — automatic)* |
| `resetDatabase()` | Truncates all tables via Supabase |
| `getSetting(key)` | `supabase.from('settings').select().eq('key', key).single()` |
| `setSetting(key, val)` | `supabase.from('settings').upsert(...)` |
| `loadAgents()` | `supabase.from('agents').select('*')` |
| `saveAgent(agent)` | `supabase.from('agents').upsert(agent)` |
| `deleteAgent(id)` | `supabase.from('agents').delete().eq('id', id)` |
| All others | Same pattern — Supabase `.from().select/insert/upsert/update/delete` |

---

## Phase 4: Auth Integration — NOT SHIPPED (deferred)

Auth gate, login view, and passkey enrollment deferred. Currently single-user local install with no auth enforcement.

---

## Phase 5: Realtime Subscriptions — SHIPPED

`useRealtimeSubscriptions.ts` hook subscribes to Postgres changes:

| Table | Events | Use Case |
|---|---|---|
| `approvals` | INSERT, UPDATE | Badge count, approval queue refresh |
| `agents` | INSERT, UPDATE, DELETE | Surveillance sprite updates |
| `missions` | INSERT, UPDATE | Kanban board refresh, dashboard stats |
| `audit_log` | INSERT | Live audit feed |
| `chat_messages` | INSERT | CEO proactive messages appearing in chat |
| `ceo` | UPDATE | CEO status pip changes |
| `ceo_action_queue` | INSERT, UPDATE | CEO action processing |
| `task_executions` | INSERT, UPDATE | Task status updates |

Some `window.dispatchEvent()` patterns still exist alongside Realtime for components that need both.

---

## Phase 6: Cleanup — SHIPPED

- `npm uninstall sql.js` — removed
- `public/sql-wasm.wasm` — deleted
- IndexedDB code — removed from `database.ts`
- `useDatabase.ts` — rewritten for Supabase
- CLAUDE.md — updated (some sql.js references may remain as historical context)

---

## Files Changed

| File | Change | Status |
|---|---|---|
| `package.json` | Added `@supabase/supabase-js`, removed `sql.js` | DONE |
| `src/lib/supabase.ts` | Created — client singleton | DONE |
| `src/lib/database.ts` | Rewritten — same exports, Supabase calls | DONE |
| `src/hooks/useDatabase.ts` | Rewritten — session check | DONE |
| `public/sql-wasm.wasm` | Deleted | DONE |
| CLAUDE.md | Updated data layer references | DONE |
| AI/Data-Layer.md | Needs rewrite (still references sql.js) | TODO |

---

## Success Criteria

- [x] `npm uninstall sql.js` — no sql.js in node_modules
- [x] `public/sql-wasm.wasm` deleted
- [x] All tables live in Postgres with data flowing through Supabase client
- [ ] Founder Ceremony creates admin user in GoTrue — deferred
- [ ] Auth gate prevents unauthorized access — deferred
- [x] Realtime subscriptions replace window events for approvals, agents, missions
- [x] CEO scheduler can run via client-side (Option B: Visibility API setInterval)
- [x] `docker compose up -d && npm run dev` is the only startup command needed
