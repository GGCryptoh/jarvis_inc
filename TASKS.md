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
- [x] Client-side SQLite via sql.js + IndexedDB persistence
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
- [~] **Supabase Docker stack** — containers start, Postgres healthy; GoTrue/PostgREST/Realtime need role bootstrap debugging
- [ ] Future: one-liner curl install (`curl ... | node` from GitHub raw)
- [ ] **Supabase Docker stack verified running** (Postgres, GoTrue, PostgREST, Realtime, Studio)
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
- [ ] CEO agent runtime (persistent AI CEO on a schedule)
- [ ] Scheduler (setInterval demo / Edge Function full)
- [ ] Decision engine (evaluate state → produce actions)
- [ ] Proactive chat (CEO initiates conversations)
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
- [ ] Skill-agent assignment (CEO assigns per agent)
- [ ] Skill resolver (merge hardcoded + repo + marketplace)
- [ ] GitHub sync (manifest-based, checksum diffing)
- [ ] Test dialog per skill (dry-run / live)
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
- [ ] Encrypted storage (pgcrypto in Supabase)
- [ ] Scoped access (secrets per agent)
- [ ] Usage tracking (who used what, when, cost)

---

## 7. Budget & Financials

- [x] Budget editing UI (CRT-themed, persisted)
- [x] Bar chart + data table
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
- [ ] Real-time agent status (reflect execution state)
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

- [~] Audit page — dummy log with severity filter
- [ ] Real event recording (every action → audit_log)
- [ ] Export functionality
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
- [x] Streaming text with blinking cursor
- [x] Resume greeting on conversation switch

---

## 14. Not Yet Started

| Module | Description |
|--------|-------------|
| Gallery | Artifact storage, search/filter, detail view. Links to mission deliverables. |
| System Stats | Health dashboard: gateway, scheduler, CEO heartbeat, agent responsiveness |
| Channels | Telegram, email/SMS delivery for CEO reports + alerts |
| Kill Switch | Pause agents, lock budgets, system state machine (running/paused/degraded) |

---

## Phased Roadmap

### Phase 0 — Demo Polish (no backend) ✅ MOSTLY DONE

1. ~~Dashboard live data~~ ✅
2. ~~Budget editing~~ ✅
3. ~~Missions Kanban from DB~~ ✅
4. ~~CEO archetypes + ceremony~~ ✅
5. ~~CEO API key validation + vault dedup~~ ✅
6. ~~LLM streaming (multi-provider)~~ ✅
7. ~~Chat persistence + sidebar~~ ✅
8. ~~Sprite scaling (agents 60%, CEO 20%) + status dot repositioning~~ ✅
9. ~~Screen glow fix + door animation removal~~ ✅
10. ~~Chat refactor (6 components) + LLM abstraction layer~~ ✅
11. ~~Sound system: war march jingle + /soundtest player~~ ✅
12. ~~Docker image updates + setup.mjs bcrypt fix~~ ✅
13. **Mission CRUD** (create, edit, move, complete) ← NEXT
14. **Audit real logging** (sql.js writes on every action)
15. **Skill test dialog** (dry-run mode)

### Phase 1 — Infrastructure & Dual-Mode Boot (guided, step-by-step)

> User will do this step-by-step with Claude's guidance. Docker files are ready in `docker/`.

13. **Verify Supabase Docker stack** — `docker compose up -d`, confirm all services healthy
14. **Verify Caddy routing** — jarvis.local, api.jarvis.local, studio.jarvis.local all reachable
15. **Verify Studio protection** — basic auth on studio subdomain works
16. **Verify SSL** — test internal (self-signed), then optionally Let's Encrypt (HTTP-01 on port 80)
17. **Verify passkey auth** — register user, enroll passkey, login with passkey
18. DataService interface + SqliteDataService wrapper (abstract the DB layer)
19. SupabaseDataService implementation
20. DataContext + useData() hook → migrate all components
21. AppBoot + ModeSelectionScreen (Demo vs Full)
22. **Founder Ceremony: system_setup phase** — CRT wizard for `.env` config, secret generation, service health checks
23. Auth UI (login/register + passkey enrollment)
24. Supabase migrations verified against sql.js schema

### Phase 2 — CEO Autonomy

25. CEO scheduler (Visibility-aware setInterval in demo, Edge Function in full)
26. Decision engine + personality system
27. Proactive chat (CEO initiates conversations)
28. Agent factory (CEO recommends hires)
29. Hire recommendation flow + approval cards
30. Chat inline action cards (hire, budget, skill suggestions)

### Phase 3 — Agent Runtime + Mission Verification

31. Task execution engine (persistent LLM conversation)
32. Agent LLM calls via skill definitions + tools
33. CEO self-execution (when no specialist agent)
34. Mid-task approvals (pause → approve → resume)
35. Task lifecycle (delegate → execute → complete → CEO review)
36. **Mission Detail Page** (`/missions/:id`) — full verification UI
37. **CEO Scorecard** — quality/completeness/efficiency/overall scoring
38. **Accept/Reject flow** — rejection feedback + redo strategy
39. **Round versioning** — include collateral vs start fresh
40. **Deliverables browser** — documents, images, data per round
41. Real-time status propagation (surveillance, missions, dashboard)

### Phase 4 — Governance & Controls

42. Permission model + UI
43. Budget enforcement + real cost tracking
44. Extended approval types (hire, budget, skill, agent action)
45. Kill switch + system state machine

### Phase 5 — Remaining Modules

46. Vault encryption (pgcrypto) + scoped access
47. Audit immutability + export
48. Gallery & Artifacts page (links to mission deliverables)
49. System Stats & Health page
50. Channels (Telegram integration)
51. Skills marketplace (community repos)

### Phase 6 — Polish

52. Org Chart visualization
53. Navigation additions (Gallery, Stats, Channels)
54. Error handling, toasts, loading states
55. Responsive design, keyboard shortcuts, accessibility

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
