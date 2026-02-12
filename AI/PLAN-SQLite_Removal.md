# PLAN: SQLite Removal & Full Supabase Migration

> Design plan for removing sql.js (browser-only SQLite) and making Supabase
> the sole data backend. The Founder Ceremony becomes the guided setup experience
> that walks the user through Docker/Supabase configuration.

### Implementation Status (2026-02-12)
- **Status**: Design phase — nothing from this plan is implemented yet
- **Prerequisite**: Docker Supabase stack fully operational (GoTrue role bootstrap still needs debugging)
- **Roadmap**: Phase 1 items #13-24 in TASKS.md

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

### Approach: Clean Cut (No Dual-Mode)

The original plan in `AI/Data-Layer.md` proposed a `DataService` interface with
both `SqliteDataService` and `SupabaseDataService`. That added complexity for a
transitional period.

**New approach**: Remove sql.js entirely. The app requires Supabase to run.
The Founder Ceremony handles all setup.

**Rationale**:
- Dual-mode means maintaining two data paths forever
- SQLite limitations block Phase 2 & 3 (CEO scheduler, agent execution)
- The Docker setup script (`setup.mjs`) already generates all secrets
- One path = simpler code, fewer bugs, easier to test

### What About Demo/Preview?

For users who just want to see the UI without Docker:
- **Option A**: A read-only demo hosted on a public URL (static site + Supabase cloud free tier)
- **Option B**: Keep sql.js as a "preview mode" behind a `?demo=true` URL param (minimal maintenance, not the primary path)
- **Recommendation**: Option A for marketing, Option B as a fallback. Neither blocks the main migration.

---

## Phase 1: Supabase Client Integration

### 1.1 Install Dependencies

```bash
npm install @supabase/supabase-js
```

### 1.2 Supabase Client Singleton

```typescript
// src/lib/supabase.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!client) throw new Error('Supabase not initialized — run setup first')
  return client
}

export function initSupabase(url: string, anonKey: string): SupabaseClient {
  client = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  })
  return client
}
```

### 1.3 Environment Variables

```typescript
// Loaded from Founder Ceremony setup or from saved config
const SUPABASE_URL = 'https://api.jarvis.local'  // Kong gateway
const SUPABASE_ANON_KEY = '...'                    // From docker/.env
```

These get saved to `localStorage` after the Founder Ceremony completes.

---

## Phase 2: Founder Ceremony Redesign

The Founder Ceremony becomes a **3-stage setup wizard**:

### Stage 1: System Boot (existing — keep as-is)
- CRT terminal boot sequence
- ASCII art, loading bars
- "INITIALIZING SYSTEMS..."

### Stage 2: Infrastructure Setup (NEW)

This replaces the simple "enter your callsign" form. It walks through
Docker/Supabase configuration with a CRT-themed UI.

```
┌─ SYSTEM SETUP ──────────────────────────────────┐
│                                                  │
│  ▸ DOMAIN          [ jarvis.local          ]     │
│  ▸ SSL MODE        ( ) Internal  (•) Off         │
│  ▸ POSTGRES PASS   [ ••••••••••••          ]     │
│  ▸ STUDIO USER     [ admin                 ]     │
│  ▸ STUDIO PASS     [ ••••••••              ]     │
│                                                  │
│  [ GENERATE SECRETS ]  [ ADVANCED... ]           │
│                                                  │
│  ── SERVICE STATUS ──                            │
│  ✓ Postgres        .... ONLINE                   │
│  ✓ Auth (GoTrue)   .... ONLINE                   │
│  ✓ API (PostgREST) .... ONLINE                   │
│  ✓ Realtime        .... ONLINE                   │
│  ✓ Studio          .... ONLINE                   │
│  ○ Kong Gateway    .... CHECKING...              │
│                                                  │
│  [ CONTINUE → ]                                  │
└──────────────────────────────────────────────────┘
```

**Steps within Stage 2:**

1. **Check Docker** — Ping `http://localhost:8000/rest/v1/` (Kong) to see if
   Supabase is already running. If yes, skip to health checks.
2. **Configuration Form** — Domain, SSL mode, passwords. Pre-filled with
   sensible defaults. Generate button creates JWT secret, API keys, etc.
3. **Write Config** — POST to a local setup endpoint OR instruct user to run
   `npm run setup` in terminal (with the values pre-filled).
4. **Health Checks** — Poll each service until all green. Retry button for failures.
5. **Create Admin User** — Call GoTrue to create the first user (the founder).
   Optionally enroll a passkey.

**Key Decision**: The browser can't directly write `docker/.env` or run
`docker compose up`. Two approaches:

| Approach | How |
|---|---|
| **A: Terminal-first** | Founder Ceremony shows the config values and says "run `npm run setup` with these values". After Docker is up, user returns to browser and clicks "Verify". |
| **B: Setup API** | A lightweight Express/Fastify server runs alongside Vite dev, accepts config POST, writes `.env`, spawns Docker. More seamless but adds a dev dependency. |
| **C: Hybrid** | `npm run setup` is interactive (already exists). Founder Ceremony only does health checks + admin user creation. Setup script handles the rest. |

**Recommendation**: **Option C (Hybrid)**. The setup script already works.
The Founder Ceremony focuses on:
- Verifying Supabase is reachable
- Creating the admin user
- Collecting callsign + org name
- Saving the Supabase URL + anon key to localStorage

### Stage 3: Founder Registration (modified from existing)
- Callsign + org name form (keep existing UI)
- Writes to Supabase `settings` table instead of sql.js
- Creates the first audit log entry
- Registers user in GoTrue (email + password or passkey)

---

## Phase 3: Database Function Migration

### 3.1 Migration Map

Every function in `src/lib/database.ts` needs a Supabase equivalent:

| SQLite Function | Supabase Replacement | Notes |
|---|---|---|
| `initDatabase()` | `initSupabase(url, key)` | No schema creation needed (Postgres migrations handle it) |
| `getDB()` | `getSupabase()` | Returns SupabaseClient instead of sql.js Database |
| `persist()` | *(removed)* | Supabase persists automatically |
| `resetDatabase()` | Truncate tables via RPC or admin API | Need `reset_database()` Postgres function |
| `getSetting(key)` | `supabase.from('settings').select('value').eq('key', key).single()` | |
| `setSetting(key, val)` | `supabase.from('settings').upsert({ key, value })` | |
| `loadAgents()` | `supabase.from('agents').select('*')` | |
| `saveAgent(agent)` | `supabase.from('agents').upsert(agent)` | |
| `deleteAgent(id)` | `supabase.from('agents').delete().eq('id', id)` | |
| `loadCEO()` | `supabase.from('ceo').select('*').eq('id', 'ceo').single()` | |
| `saveCEO(ceo)` | `supabase.from('ceo').upsert(ceo)` | |
| `loadMissions()` | `supabase.from('missions').select('*')` | |
| `saveMission(m)` | `supabase.from('missions').upsert(m)` | |
| `updateMission(id, f)` | `supabase.from('missions').update(fields).eq('id', id)` | |
| `deleteMission(id)` | `supabase.from('missions').delete().eq('id', id)` | |
| `logAudit(...)` | `supabase.from('audit_log').insert({...})` | |
| `loadAuditLog()` | `supabase.from('audit_log').select('*').order('timestamp', { ascending: false })` | |
| `saveVaultEntry(e)` | `supabase.from('vault').upsert(e)` | |
| `deleteVaultEntry(id)` | `supabase.from('vault').delete().eq('id', id)` | |
| `loadApprovals()` | `supabase.from('approvals').select('*')` | |
| `saveApproval(a)` | `supabase.from('approvals').upsert(a)` | |
| `loadSkills()` | `supabase.from('skills').select('*')` | |
| `saveSkill(s)` | `supabase.from('skills').upsert(s)` | |
| `loadConversations()` | `supabase.from('conversations').select('*')` | |
| `saveConversation(c)` | `supabase.from('conversations').upsert(c)` | |
| `loadMessages(convoId)` | `supabase.from('chat_messages').select('*').eq('conversation_id', convoId)` | |
| `saveMessage(m)` | `supabase.from('chat_messages').insert(m)` | |

### 3.2 New File Structure

```
src/lib/
├── supabase.ts              # Client singleton + init
├── database.ts              # REPLACED: all functions now call Supabase
├── database.ts.bak          # ❌ DELETE after migration verified
├── models.ts                # Unchanged
├── sounds.ts                # Unchanged
├── ceoResponder.ts          # Unchanged
├── skillRecommender.ts      # Unchanged
├── positionGenerator.ts     # Unchanged
└── llm/                     # Unchanged
```

**Strategy**: Rewrite `database.ts` in-place. Every exported function keeps
the same signature but calls Supabase instead of sql.js. This means zero
changes needed in components — they still import from `database.ts`.

### 3.3 Async Considerations

SQLite functions are currently synchronous (sql.js runs queries synchronously
in WASM). Supabase functions are async. Most callers already treat results
as if they're async (React state updates), but some may need `await` added.

**Audit needed**: Grep all imports from `database.ts` and verify each call
site handles async correctly. Most component code already does
`useEffect(() => { loadAgents().then(setAgents) }, [])` which works with
both sync and async.

---

## Phase 4: Auth Integration

### 4.1 Auth Flow

```
App Boot
  ├─ Check Supabase session (auto-refreshed by @supabase/supabase-js)
  ├─ if (session) → App (user is logged in)
  └─ if (no session) → AuthGate
       ├─ Existing user → Login (email+password OR passkey)
       └─ First time → Founder Ceremony (creates user + org)
```

### 4.2 AuthGate Component

```typescript
// src/components/Auth/AuthGate.tsx
// Wraps the entire app. If no session, shows login or Founder Ceremony.
// If session exists, renders children.
```

### 4.3 Row-Level Security

RLS policies already exist in `docker/supabase/migrations/002_rls_policies.sql`.
They ensure:
- Authenticated users can read/write their own org's data
- Anon users can't access anything
- Service role bypasses RLS (for Edge Functions)

### 4.4 Passkey Enrollment

After Founder Ceremony creates the user, offer passkey enrollment:

```
┌─ SECURE YOUR COMMAND CENTER ────────────────────┐
│                                                  │
│  Your account is created.                        │
│                                                  │
│  Protect it with a passkey for instant,          │
│  passwordless access.                            │
│                                                  │
│  [ ENROLL PASSKEY ]    [ SKIP FOR NOW ]          │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

## Phase 5: Realtime Subscriptions

Replace `window.dispatchEvent()` cross-component sync with Supabase Realtime:

### 5.1 Channels

```typescript
// Subscribe to approval changes
supabase
  .channel('approvals')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'approvals',
  }, (payload) => {
    // Update local state
  })
  .subscribe()
```

### 5.2 What Gets Realtime

| Table | Events | Use Case |
|---|---|---|
| `approvals` | INSERT, UPDATE | Badge count, approval queue refresh |
| `agents` | INSERT, UPDATE, DELETE | Surveillance sprite updates |
| `missions` | INSERT, UPDATE | Kanban board refresh, dashboard stats |
| `audit_log` | INSERT | Live audit feed |
| `chat_messages` | INSERT | CEO proactive messages appearing in chat |
| `ceo` | UPDATE | CEO status pip changes |

### 5.3 Remove Window Events

After Realtime is wired, remove all `window.dispatchEvent()` and
`window.addEventListener()` patterns. The Supabase subscription replaces them.

---

## Phase 6: Cleanup

### 6.1 Remove sql.js

```bash
npm uninstall sql.js
rm public/sql-wasm.wasm
```

### 6.2 Remove IndexedDB Code

Delete all `loadFromIndexedDB()`, `persist()`, `resetDatabase()` IndexedDB
logic from `database.ts`.

### 6.3 Remove Vite Externalization

In `vite.config.ts`, remove the `fs`, `path`, `crypto` externalization that
was only needed for sql.js build warnings.

### 6.4 Update Boot Hook

`src/hooks/useDatabase.ts` currently boots sql.js. Replace with Supabase
session check + health ping.

### 6.5 Update CLAUDE.md

Remove all sql.js references:
- "sql.js — SQLite compiled to WASM, runs in browser, persisted to IndexedDB"
- WASM path pitfall
- DB guard pitfall
- persist() pitfall

### 6.6 Update Tests / CI

If any tests mock sql.js, replace with Supabase test helpers or a local
Postgres instance in CI.

---

## Files Changed (Estimated)

| File | Change |
|---|---|
| `package.json` | Add `@supabase/supabase-js`, remove `sql.js` |
| `src/lib/supabase.ts` | **NEW** — client singleton |
| `src/lib/database.ts` | **REWRITE** — same exports, Supabase calls |
| `src/hooks/useDatabase.ts` | **REWRITE** — session check instead of WASM boot |
| `src/App.tsx` | Add AuthGate wrapper, remove sql.js ready gate |
| `src/components/Auth/AuthGate.tsx` | **NEW** — auth wrapper |
| `src/components/Auth/LoginView.tsx` | **NEW** — login + passkey |
| `src/components/FounderCeremony/FounderCeremony.tsx` | **MODIFY** — add Stage 2 (infrastructure setup) |
| `vite.config.ts` | Remove sql.js externalization, add Supabase env vars |
| `public/sql-wasm.wasm` | **DELETE** |
| `CLAUDE.md` | Update data layer references |
| `AI/Data-Layer.md` | Update to reflect Supabase-only architecture |

---

## Migration Order

```
1. Fix Docker Supabase role bootstrap (GoTrue/PostgREST auth)
2. Install @supabase/supabase-js
3. Create src/lib/supabase.ts (client singleton)
4. Rewrite database.ts (same exports, Supabase internals)
5. Rewrite useDatabase.ts (session check)
6. Create AuthGate + LoginView
7. Modify FounderCeremony (add infrastructure setup stage)
8. Wire Realtime subscriptions
9. Remove sql.js, IndexedDB code, WASM file
10. Update docs (CLAUDE.md, Data-Layer.md, README)
```

**Step 1 is the blocker** — Supabase services need to be fully running before
any frontend migration can be tested.

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Docker not available on all dev machines | Option B preview mode with `?demo=true` keeps sql.js as fallback |
| Supabase service failures | Health check in Founder Ceremony catches issues before proceeding |
| Data loss during migration | No existing production data — this is greenfield |
| Async conversion breaks components | Same function signatures + most callers already async-ready |
| RLS blocks legitimate queries | Test with both anon and authenticated roles during dev |
| Passkey browser support | Fallback to email+password, passkey is optional |

---

## Success Criteria

- [ ] `npm uninstall sql.js` — no sql.js in node_modules
- [ ] `public/sql-wasm.wasm` deleted
- [ ] All 10 tables live in Postgres with data flowing through Supabase client
- [ ] Founder Ceremony creates admin user in GoTrue
- [ ] Auth gate prevents unauthorized access
- [ ] Realtime subscriptions replace window events for approvals, agents, missions
- [ ] CEO scheduler can run as Supabase Edge Function (Phase 2 prerequisite)
- [ ] `docker compose up -d && npm run dev` is the only startup command needed
