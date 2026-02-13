# TASKS — Jarvis Inc. Roadmap

> Gap analysis + phased roadmap. Updated 2026-02-12.

---

## Legend

- `[x]` — Done (shipped)
- `[~]` — Partial (UI exists, not fully wired)
- `[ ]` — Not started

---

## 1. Foundation & Infrastructure

- [x] Project scaffolding (Vite + React + TypeScript + Tailwind)
- [x] ~~Client-side SQLite via sql.js + IndexedDB persistence~~ → replaced by Supabase
- [x] **Supabase client singleton** (`src/lib/supabase.ts`) + `database.ts` rewritten for Supabase
- [x] Docker frontend (Dockerfile → nginx:alpine)
- [x] Founder Ceremony (terminal boot, registration, persistence)
- [x] CEO Ceremony (designation, archetype, API key validation, vault dedup)
- [x] Reset DB flow (3-step: Fire CEO, Shutter Business, Reset Database)
- [x] Docker full stack config (`docker/docker-compose.yml` + Caddy + Supabase services)
- [x] Caddy reverse proxy (`docker/Caddyfile`) — 3 routes, optional SSL (internal/LetsEncrypt/off)
- [x] Supabase Kong API gateway config (`docker/supabase/kong.yml`)
- [x] Postgres migrations (`docker/supabase/migrations/001_initial_schema.sql`, `002_rls_policies.sql`)
- [x] Environment template (`docker/.env.example`) with generation instructions
- [x] Interactive setup script (`docker/setup.mjs`) — generates secrets, writes `.env`, starts Docker, health-checks
- [x] Setup script bcrypt `$` escaping fix (Docker Compose `.env` compatibility)
- [x] npm scripts: `npm run setup` (interactive) and `npm run setup:check` (health-check only)
- [x] Docker image versions updated to latest (Postgres 15.8.1.085, GoTrue v2.185.0, PostgREST v14.3, Realtime v2.72.0, Studio 2026.01.27, pg_meta v0.95.2)
- [x] **Supabase Docker stack** — all services running (Postgres, GoTrue, PostgREST, Realtime, Kong, Studio)
- [x] **Role bootstrap** (`docker/supabase/migrations/000_roles.sh`) — passwords, schema ownership, auth object transfer
- [x] **Kong API key injection** — `setup.mjs` generates `kong.yml` from template with real keys
- [x] **Hosts file auto-setup** — `setup.mjs` adds `/etc/hosts` entries automatically (sudo)
- [x] **`npm run jarvis`** — one-command setup: env gen, Docker boot, health checks, Vite env
- [ ] Future: one-liner curl install (`curl ... | node` from GitHub raw)
- [ ] **Passkey/WebAuthn auth verified** (GoTrue config, enrollment flow tested)
- [ ] **Studio basic auth verified** (Caddy protecting studio subdomain)
- [ ] **SSL options verified** (internal self-signed, Let's Encrypt HTTP-01, or off)
- [ ] **Dual-mode boot** (Demo vs Full mode selection screen)
- [ ] **Founder Ceremony: system_setup phase** — CRT wizard that walks through `docker/.env` config:
  - Reads `.env.example` as template
  - Prompts for domain, passwords, keys with CRT-themed input fields
  - Auto-generates secrets (JWT, password hashes) inline
  - Writes final `docker/.env`
  - Health-checks each Supabase service (Postgres, Auth, REST, Realtime)
  - Shows green checkmarks as services come online
  - Only shown when user picks "FULL SETUP" mode

---

## 2. AI CEO & Orchestration

- [x] CEO onboarding chat (scripted state machine)
- [x] 8 personality archetypes (ceremony selector + DB persistence)
- [x] CEO personality-aware prompts (archetype + philosophy + risk → system prompt)
- [x] LLM streaming (Anthropic, OpenAI, Google, DeepSeek, xAI) — 5 providers via `src/lib/llm/`
- [x] LLM abstraction layer (`src/lib/llm/`: types, chatService, providers/anthropic, providers/openai, providers/google)
- [x] LLM fallback to scripted responses when no API key (`src/lib/ceoResponder.ts`)
- [x] Vite proxy config for OpenAI, DeepSeek, xAI API routes
- [x] Chat persistence (conversations + messages in DB — 2 new tables)
- [x] Chat refactored into 6 components: ChatView, ChatSidebar, ChatThread, OnboardingFlow, DeleteConvoDialog, ResearchOfferCard
- [x] Chat sidebar (history, archive, delete, new conversation)
- [~] Goal ingestion — mission capture + keyword skill recommendation. Missing: ongoing goal management
- [x] **CEO scheduler** (`src/lib/ceoScheduler.ts`) — visibility-aware interval, heartbeat to DB
- [x] **Decision engine** (`src/lib/ceoDecisionEngine.ts`) — rule-based MVP, 5 heuristic checks
- [x] **Supabase Realtime** (`src/hooks/useRealtimeSubscriptions.ts`) — 6 table subscriptions → window events
- [x] **Organizational memory** (`src/lib/memory.ts`) — CRUD, LLM extraction, conversation summaries
- [x] **Memory in CEO prompt** — top-20 memories injected into system prompt
- [x] **Personality-aware memory extraction** — archetype weights categories differently
- [x] **Founder profile/soul** — `founder_profile` category, separate prompt section, always included
- [x] **Memory extraction on conversation leave** — catches short chats (not just every-N-message batch)
- [x] **Mission context dispatch** — conversation excerpt + relevant memories travel with dispatched tasks
- [ ] Proactive chat (CEO initiates conversations via action queue)
- [ ] Daily executive reports
- [ ] Task definition model (structured objectives + constraints)
- [ ] Task refinement (CEO refines before delegation)
- [ ] Agent assignment logic (role, workload, cost)

---

## 3. Agent Execution Runtime

- [x] Agent CRUD (hire/edit/fire, DB persistence)
- [x] Agent sprites (7 animation states, 60% bigger)
- [x] CEO sprite (crown, suit, 20% bigger, status dot)
- [ ] Agent execution engine (LLM calls + tools)
- [ ] Agent tool access (per-agent tool sets)
- [ ] Agent reporting (progress → CEO)
- [ ] Protected gateway (external action execution)
- [ ] Task execution pipeline (delegate → execute → approve → complete)

---

## 4. Skills System

- [x] 18 skills across 4 categories with toggles + model selectors
- [x] Filter (All/Enabled/Disabled) + search bar
- [x] Auto-approval for missing API keys
- [x] Skill recommender (keyword → skill IDs)
- [x] Seed skills repo (18 JSON files + schema + manifest)
- [x] **Skill resolver** (`src/lib/skillResolver.ts`) — merges hardcoded + DB + seed repo
- [x] **Skill executor** (`src/lib/skillExecutor.ts`) — resolve → prompt → LLM → audit
- [x] **Skill test dialog** (`src/components/Skills/SkillTestDialog.tsx`) — command picker, param form, dry-run/execute
- [x] **Skill-agent assignment** — HireAgentModal skill picker + `agent_skills` CRUD
- [x] **Full skill definitions in CEO prompt** — command names, descriptions, parameters
- [ ] GitHub sync (manifest-based, checksum diffing)
- [ ] OAuth connection type (PKCE flow)

---

## 5. Approvals & Permissions

- [x] Approvals page (pending queue + history)
- [x] Types: `skill_enable`, `api_key_request`
- [x] Cross-component sync via events
- [x] Notification badge on nav
- [ ] Extended types: `hire_agent`, `budget_override`, `agent_action`
- [ ] Permission model (per-agent, per-capability modes)
- [ ] Time-bound approvals with expiry
- [ ] CEO auto-approval within policy

---

## 6. Vault & Secrets

- [x] Full CRUD for API keys
- [x] 12 models → 6 services mapping + setup hints (Anthropic 4, OpenAI 3, Google 2, DeepSeek 1, Meta 1, xAI 1)
- [x] Dependency warnings on delete
- [x] CEO ceremony vault dedup (check before insert)
- [x] **Tabbed interface** — 5 tabs: Keys, Credentials, Tokens & Secrets, Channels, Memories
- [x] **Memories CRUD** — table with category/content/tags/importance, edit modal, delete with confirm
- [x] **Notification channels** — Email, Telegram, SMS, Voice placeholders
- [ ] Encrypted storage (pgcrypto in Supabase)
- [ ] Scoped access (secrets per agent)
- [ ] Usage tracking (who used what, when, cost)

---

## 7. Budget & Financials

- [x] Budget editing UI (CRT-themed, persisted)
- [x] Bar chart + data table
- [ ] **Token & cost tracking** (`llm_usage` table — per-call input/output tokens, estimated cost, context tags)
- [ ] Real cost tracking (token/API costs per agent)
- [ ] Budget enforcement (pause on exceeded)
- [ ] Budget override flow (CEO requests, human approves)
- [ ] Daily/monthly budget at system + agent level

---

## 8. Surveillance

- [x] Pixel office with 4 floor tiers (auto-upgrade)
- [x] Floor planner (click-to-place, DB persistence)
- [x] Agent sprites: 7 animation states, scaled 60% bigger
- [x] CEO sprite: crown, suit, scaled 20% bigger
- [x] Status dots moved to left of head
- [x] CEO walk-in ceremony
- [x] Agent hire ceremony
- [x] Scene modes (working, meeting, break, all_hands, welcome)
- [x] Door animation removed (clean ceremonies without door visual)
- [x] Working screen glow fixed (subtle radial gradient, not solid green block)
- [x] Real-time CEO status (chatting/working/idle via window events, status colors)
- [x] Typing hands animation (Police Quest-style pixel hands when working)
- [ ] Blocked state visualization
- [ ] Agent reporting lines
- [ ] Advanced floor planner (drag-and-drop, snap-to-grid)

---

## 9. Dashboard

- [x] Live stats from DB (agents, missions, budget)
- [x] Primary mission card (editable)
- [x] Mission control table from DB
- [x] CEO in agent fleet
- [ ] Org Chart view (CEO → agents hierarchy)
- [ ] Employee monitor (live status, task, cost)
- [ ] CEO status widget (heartbeat, last report)

---

## 10. Missions & Mission Control

> See `AI/IDEAS-MissionControl.md` for the full verification, scoring & redo system design.

### Kanban Board (existing)
- [x] 4-column Kanban from DB (Backlog → In Progress → Review → Done)
- [x] Recurring mission support (cyan badge + cron tooltip)
- [ ] Mission CRUD (create, edit, move, complete from UI)
- [ ] REVIEW column (between In Progress and Done — for ceo_review + founder_review)
- [ ] Mission cards: round badge (⟳ R3), CEO score, cumulative cost

### Mission Detail Page (`/missions/:id`) — NEW
- [ ] Route + layout (back button, round indicator, status/priority/agent header)
- [ ] Stats cards (agent, cost, tokens, duration — per round)
- [ ] CEO Scorecard component (quality/completeness/efficiency/overall bars + grade + review text)
- [ ] Tab bar: RESULTS | DELIVERABLES | ACTIVITY | ROUNDS
- [ ] Results tab (agent output rendered as markdown)
- [ ] Deliverables tab (file/artifact browser with preview + download)
- [ ] Activity tab (pre-filtered audit log for this mission only)
- [ ] Rounds tab (timeline of all attempts with stats + rejection reasons)

### Accept / Reject Flow
- [ ] ACCEPT MISSION button → status `done`, audit log, agent celebrates
- [ ] REJECT & REDO modal:
  - Rejection reason (required text area)
  - Redo strategy radio: "Include all collateral" (default) vs "Start fresh"
  - Shows cumulative cost/rounds
  - Increments round, sets status back to `in_progress`
  - CEO receives structured feedback + (optionally) prior work
- [ ] CANCEL MISSION (muted, with confirmation + optional reason)
- [ ] Round versioning (Round 1, 2, 3... simple incrementing integers)

### CEO Integration
- [ ] CEO evaluation prompt (structured JSON: quality, completeness, efficiency, overall, grade, review, recommendation)
- [ ] Redo prompt (rejection reason + strategy fed back to CEO for re-delegation)
- [ ] CEO recommendation is advisory — founder has final say

### Data Model
- [ ] `missions` table: add `current_round`, `description`, `total_cost`, `total_tokens`, `total_duration_ms`, `cancelled_reason`
- [ ] `mission_rounds` table (new): per-attempt stats, CEO scores, rejection info, conversation snapshot
- [ ] `mission_artifacts` table (new): deliverables with name, type, mime_type, content/url, size
- [ ] `mission_activity` table (new): fine-grained per-mission event log

---

## 11. Audit

- [x] Audit page — severity filter + formatted timestamps
- [x] CEO_CHAT entries with "View Chat" button → navigates to archived conversation
- [x] Real event recording (CEO_CHAT, KEY_ADDED/UPDATED/DELETED, MEMORY_EDITED/DELETED, CHANNEL_ADDED/DELETED)
- [x] Export functionality (TSV download)
- [ ] Immutable log (append-only, hash chain)

---

## 12. Sound System

- [x] Web Audio API success jingle (`playSuccessJingle()` — ascending arpeggio, square + triangle waves)
- [x] War march jingle (`playWarMarch()` — Cannon Fodder-inspired military march, ~3.4s)
- [x] Sound test page (`/soundtest`) — CRT-styled jingle player with keyboard controls (Space, Esc, N, P)
- [ ] Additional ceremony sounds (hire, fire, alert)
- [ ] Volume control / mute toggle

---

## 13. Chat Enhancements (shipped)

- [x] Chat font sizes bumped (multiple iterations, settled on current)
- [x] Archived conversation placeholder visible (opacity-70)
- [x] Onboarding messages persist and show in archived view
- [x] LLM: CONNECTED badge in chat header
- [x] **LLM: ONLINE cinematic reveal** — CRT flicker + typewriter + jingle on skill+key validation
- [x] **Skill approval model selector** — all 12 models with key status indicators in approval card
- [x] **Real LLM test in onboarding** — no scripted fallback, retry on error
- [x] **Tool call rendering** — retro ToolCallBlock cards replace raw XML in CEO messages
- [x] **Onboarding state persistence** — step + messages survive route navigation
- [x] Streaming text with blinking cursor
- [x] Resume greeting on conversation switch

---

## 14. Not Yet Started

| Module | Description |
|--------|-------------|
| System Stats | Health dashboard: gateway, scheduler, CEO heartbeat, agent responsiveness |
| Kill Switch | Pause agents, lock budgets, system state machine (running/paused/degraded) |

---

## Phased Roadmap

### Phase 0 — Demo Polish ✅ DONE

1. ~~Dashboard live data~~ ✅
2. ~~Budget editing~~ ✅
3. ~~Missions Kanban from DB~~ ✅
4. ~~CEO archetypes + ceremony~~ ✅
5. ~~CEO API key validation + vault dedup~~ ✅
6. ~~LLM streaming (multi-provider)~~ ✅
7. ~~Chat persistence + sidebar~~ ✅
8. ~~Sprite scaling + status dots~~ ✅
9. ~~Screen glow fix + door removal~~ ✅
10. ~~Chat refactor (6 components) + LLM abstraction~~ ✅
11. ~~Sound system~~ ✅
12. ~~Docker image updates + setup.mjs~~ ✅

### Phase 1 — Supabase Backend ✅ DONE

13. ~~One-command setup (`npm run jarvis`)~~ ✅
14. ~~Role bootstrap (passwords, schema ownership, auth transfer)~~ ✅
15. ~~Kong API key injection (template → generated config)~~ ✅
16. ~~Kill sql.js → Supabase client (`database.ts` rewrite)~~ ✅
17. ~~Async audit of all consumers~~ ✅
18. ~~Memory system (org_memory, extraction, CEO prompt)~~ ✅
19. ~~CEO scheduler + decision engine~~ ✅
20. ~~Supabase Realtime subscriptions~~ ✅
21. ~~Skill resolver + executor + test dialog~~ ✅
22. ~~Skill-agent assignment~~ ✅
23. ~~Full skill definitions in CEO prompt~~ ✅

### Phase 2 — LLM Integration & Chat Polish ✅ DONE

24. ~~LLM: ONLINE reveal~~ ✅ — CRT flicker + typewriter + jingle after skill+key validation
25. ~~Skill approval model selector~~ ✅ — all 12 models with key indicators
26. ~~Real LLM test in onboarding~~ ✅ — no scripted fallback, retry on error
27. ~~Token & cost tracking~~ ✅ — `llm_usage` table, per-call logging, cost rates per model
28. ~~Tool call rendering~~ ✅ — retro-styled ToolCallBlock cards in chat (replaces raw XML)
29. ~~Chat audit logging~~ ✅ — CEO_CHAT entries in audit_log with model + token count
30. ~~Onboarding state persistence~~ ✅ — survives route navigation (step + messages to settings)
31. ~~Audit date fix~~ ✅ — TIMESTAMPTZ format (no more "invalid date")

### Phase 3 — Skill Execution Pipeline ✅ DONE

> See `AI/Skill-Execution-Pipeline.md` for full design.

32. ~~Edge function runtime~~ ✅ — `supabase/edge-runtime` in Docker stack
33. ~~`execute-skill` edge function~~ ✅ — background skill execution (Deno, all 5 providers)
34. ~~Task plan parser~~ ✅ — intercept `<task_plan>` / `<tool_call>` from CEO response, create missions + task_executions
35. ~~TaskPlanBlock component~~ ✅ — retro mission cards in chat (queued → executing → complete/failed)
36. ~~Realtime subscriptions~~ ✅ — task_executions, missions, chat_messages updates
37. ~~Toast notification system~~ ✅ — retro popup on task completion, click to navigate
38. ~~Missions review flow~~ ✅ — click review item → output viewer, approve/redo/discard
39. ~~Missions nav badge~~ ✅ — green circle with review count
40. ~~Collateral page~~ ✅ — `/collateral` artifact browser, filter by date/skill/search, detail view
41. ~~Financials real data~~ ✅ — replace dummy with llm_usage + channel_usage aggregates
42. ~~Agent cost tracking~~ ✅ — hover card shows total spend, tasks, avg cost
43. ~~CEO hover card~~ ✅ — personality, model, philosophy, cost so far
44. ~~Vault channels~~ ✅ — notification_channels table, CHANNELS section, placeholder types (email, telegram, sms, voice)
45. ~~Channel cost tracking~~ ✅ — channel_usage table, feeds into financials

### Phase 3.5 — UX Polish & Memory Intelligence ✅ DONE

46. ~~CEO date awareness~~ ✅ — today's date in system prompt, enforced in skill queries
47. ~~CEO decision flow~~ ✅ — 3-step prompt: answer directly / ask before skill / propose mission brief
48. ~~Mission brief flow~~ ✅ — create mission → opens CEO chat conversation for review
49. ~~CEO real-time surveillance status~~ ✅ — sprite reflects chatting/working/idle via window events
50. ~~Chat copy-to-input~~ ✅ — hover user messages → copy icon → pushes text back to input
51. ~~Typing hands animation~~ ✅ — Police Quest-style pixel hands on agents when working
52. ~~Audit "View Chat" button~~ ✅ — CEO_CHAT entries link to conversation via `/chat?conversation=id`
53. ~~Vault tabbed interface~~ ✅ — 5 tabs: Keys, Credentials, Tokens, Channels, Memories with CRUD
54. ~~Memory extraction on leave~~ ✅ — extract when switching conversations (catches short chats)
55. ~~Personality-aware memory extraction~~ ✅ — archetype weights categories (Wall Street → financial, MIT → technical)
56. ~~Founder profile/soul~~ ✅ — `founder_profile` memory category, separate system prompt section, always included
57. ~~Mission context dispatch~~ ✅ — CEO passes conversation excerpt + relevant memories + founder profile to agents

### Phase 4 — CEO Autonomy & Agent Runtime

46. Proactive chat (CEO initiates conversations via action queue)
47. Agent factory (CEO recommends hires)
48. Chat inline action cards (hire, budget, skill suggestions)
49. Mid-task approvals (pause → approve → resume)
50. Task lifecycle (delegate → execute → complete → CEO review)

### Phase 5 — Mission Verification

> See `AI/IDEAS-MissionControl.md` for full design.

51. **Mission Detail Page** (`/missions/:id`) — full verification UI
52. **CEO Scorecard** — quality/completeness/efficiency/overall scoring
53. **Accept/Reject flow** — rejection feedback + redo strategy
54. **Round versioning** — include collateral vs start fresh
55. **Deliverables browser** — documents, images, data per round
56. Real-time status propagation (surveillance, missions, dashboard)

### Phase 6 — Governance & Controls

57. Permission model + UI
58. Budget enforcement + real cost tracking
59. Extended approval types (hire, budget, skill, agent action)
60. Kill switch + system state machine

### Phase 7 — Remaining Modules

61. Vault encryption (pgcrypto) + scoped access
62. Audit immutability + export
63. System Stats & Health page
64. Skills marketplace (community repos)
65. Org Chart visualization
66. Error handling, toasts, loading states
67. Responsive design, keyboard shortcuts, accessibility

---

## Design Documents Index

| Document | Path | Contents |
|----------|------|----------|
| CEO Agent System | `AI/CEO-Agent-System.md` | Scheduler, decision engine, agent factory, task execution |
| CEO Designate | `AI/CEO-Designate.md` | 8 personality archetypes, prompt assembly |
| CEO Prompts | `AI/CEO/CEO-Prompts.md` | All prompt templates: CEO, agent, chat |
| CEO Communication | `AI/CEO-Communication-Loop.md` | Proactive CEO behavior, triggers, action cards |
| Chat Onboarding | `AI/Chat-Onboarding-Flow.md` | Scripted onboarding state machine |
| Approval System | `AI/Approval-System.md` | Types, lifecycle, cross-component sync |
| Skills Architecture | `AI/Skills-Architecture.md` | 18 skills, categories, agent assignment model |
| Data Layer | `AI/Data-Layer.md` | Schema, dual-mode plan (sql.js vs Supabase) |
| Ceremonies | `AI/Ceremonies.md` | All ceremony state machines |
| Surveillance | `AI/Surveillance.md` | Pixel office, sprites, floors, animations |
| Skills Repo Plan | `AI/PLAN-SKILLS_REPO.md` | Skills repo creation plan |
| **SQLite Removal** | `AI/PLAN-SQLite_Removal.md` | **Full migration: sql.js → Supabase, Founder setup wizard, auth, realtime** |
| **Mission Control** | `AI/IDEAS-MissionControl.md` | **Verification, scoring, accept/reject, redo rounds, deliverables** |
| **LLM Reveal & Tokens** | `AI/LLM-Reveal-Token-Tracking.md` | **LLM:ONLINE reveal, skill model selector, token/cost tracking** |
| **Memory Architecture** | `AI/Memory-Agent-Workspace.md` | **Organizational memory, pgvector, conversation summaries** |
| **Skill Execution Pipeline** | `AI/Skill-Execution-Pipeline.md` | **Edge function execution, task_plan grouping, Realtime, Collateral, Financials, Channels** |
