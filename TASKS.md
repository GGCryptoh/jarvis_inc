# TASKS — Jarvis Inc. v1

> PRD-to-code gap analysis. Checked against current codebase as of 2026-02-11.

---

## Legend

- `[x]` — Done (shipped in current code)
- `[~]` — Partial (UI exists but static/dummy, or only partly functional)
- `[ ]` — Not started

---

## 1. Foundation & Infrastructure

- [x] Project scaffolding (Vite + React + TypeScript + Tailwind)
- [x] Client-side SQLite via sql.js + IndexedDB persistence
- [x] Docker support (Dockerfile)
- [x] Founder Ceremony — boot sequence, registration, SQLite persistence
- [x] Reset DB flow — 3-step dialog with Fire CEO, Shutter Business (export + wipe), and Reset Database options
- [ ] **Backend server** — Planned: Supabase self-hosted via Docker. Not needed for demo mode. See Section 19
- [ ] **Database migration to server-side** — Planned: Dual-mode architecture. See Section 19
- [ ] **Authentication** — Planned: Supabase Auth. See Section 19
- [ ] **WebSocket / SSE layer** — Planned: Supabase Realtime. See Section 19

---

## 2. AI CEO & Orchestration Engine (PRD Section 5, 7)

- [ ] **CEO agent runtime** — Instantiate a persistent AI CEO using an LLM (Claude/GPT). The CEO interprets goals, delegates, approves, and reports
- [~] **Goal ingestion** — CEO onboarding chat asks for primary mission, saves to DB, recommends skills based on mission keywords, inline approval card. Post-meeting chat shows random CEO greeting (20 variants) + mission card. LLM:CONNECTED badge checks skill enabled + API key present. **Missing**: structured goal/constraint editing, ongoing goal management, LLM-bolstered mission text
- [ ] **Task definition model** — Structured tasks with Objective, Context/Backstory, Constraints (time, quality, budget, risk) per PRD
- [ ] **Task refinement** — CEO refines ambiguous tasks before delegation (not blind pass-through)
- [ ] **Agent assignment logic** — CEO picks agents based on role, workload, cost profile, permissions, and available tools
- [ ] **Crew-style delegation** — Agents can request sub-delegation; CEO evaluates and approves multi-agent collaboration
- [ ] **Task monitoring & check-ins** — CEO heartbeat checks active tasks, requests interim updates, estimates completion %, flags risks
- [ ] **Daily executive reports** — CEO produces daily summaries of work, spend, risks, and outcomes
- [ ] **Ad-hoc reporting** — CEO can generate reports on demand
- [ ] **Heartbeat / scheduler** — Periodic CEO wake-up cycle to evaluate system state and take action

---

## 3. Agent Execution Runtime (PRD Section 5, 7)

- [x] Agent CRUD — Hire/edit/fire agents in Surveillance UI, persisted to DB. Skills page functional with DB-backed toggles, model selection per skill, and vault integration
- [x] **Skills configuration** — 18 skills across 4 categories, org-wide toggle + model assignment, auto-approval for missing API keys, filter (All/Enabled/Disabled) + search bar
- [ ] **Agent execution engine** — Agents actually run tasks using LLM calls, tools, and external actions
- [ ] **Agent tool access** — Each agent has a defined set of tools they can use (web search, code gen, email, etc.)
- [ ] **Agent reporting** — Agents report progress and results upward to CEO
- [ ] **Agent model assignment** — Agents use specific LLM models (Claude, GPT, etc.) — UI exists but not wired to real model calls
- [ ] **Protected gateway** — A controlled gateway that executes external actions (API calls, file writes, emails) on behalf of agents

---

## 4. Permissions & Capability Governance (PRD Section 8)

- [ ] **Permission model** — Per-agent, per-capability permission modes: Always Ask, Ask Once/Task, Ask Once/Session, Allow w/ Budget, Allow All
- [ ] **Permission management UI** — Interface to view and configure agent permissions
- [ ] **CEO auto-approval** — CEO approves actions within policy automatically
- [ ] **Human approval routing** — Sensitive/high-risk/financial actions escalated to human
- [ ] **Time-bound approvals** — Approvals expire and are auditable

---

## 5. Budget & Financial Controls (PRD Section 9)

- [~] Financials page — Bar chart and table use dummy monthly data, but budget is real (DB-backed). Budget stored as `monthly_budget` setting
- [x] **Budget editing UI** — Pencil icon on Monthly Budget card opens founder-ceremony-themed dialog (CRT green glow, pixel font, $50-$1000 presets), persisted to DB
- [ ] **Real budget tracking** — Daily and monthly budgets at system and agent level, fed by actual LLM token/API costs
- [ ] **Overage thresholds** — Configurable (e.g., 10% daily, 5% monthly) with warnings
- [ ] **Budget enforcement** — Pause agent execution when budget exceeded (unless override approved)
- [ ] **Budget override flow** — CEO requests override, human approves, time-bound and logged
- [ ] **Per-agent cost tracking** — Real-time token and API cost attribution per agent

---

## 6. Vault & Secrets Management (PRD Section 10)

- [x] Vault page — Full CRUD: add/edit/delete API keys and credentials, service-based quick-select, masked key display
- [x] **Secret CRUD** — Add, edit (name/key), delete vault entries from the UI with impact warnings
- [x] **Model-service mapping** — 14 models mapped to 6 services (Anthropic, OpenAI, Google, DeepSeek, Meta, xAI) with setup hints
- [x] **Entity dependency tracking** — Deleting a vault key shows which agents/CEO depend on that service
- [ ] **Real secret storage** — Encrypted at-rest storage for API keys and credentials (server-side)
- [ ] **Scoped access** — Secrets granted to specific agents, revocable
- [ ] **Model access grants** — Explicitly grant which LLM models each agent can use
- [ ] **Usage tracking** — Track which agent used which secret, when, and at what cost
- [ ] **Audit integration** — All vault access logged to audit trail

---

## 7. Human Tasks & Approvals (PRD Section 11)

- [x] **Approvals page** — Pending queue with inline API key provision, service setup hints, approve/dismiss actions
- [x] **Approval types** — `skill_enable` (with auto-enable on approve) and `api_key_request` (with inline key provision)
- [x] **Approval triggers** — Auto-created when hiring agents or enabling skills whose model's service lacks a vault key
- [x] **Cross-component approval sync** — ChatView and ApprovalsView sync via `approvals-changed` custom event
- [x] **Notification badges** — Approvals nav item shows count of pending approvals (refreshed every 5s + event-driven)
- [x] **Approval history** — Collapsible history tab showing approved/dismissed past decisions
- [ ] **Extended approval types** — Budget overrides, high-risk actions, multi-agent delegation approvals
- [ ] **Time-bound approvals** — Approvals expire and are auditable

---

## 8. Channels & Delivery (PRD Section 12)

- [ ] **Channel configuration UI** — Enable/disable notification channels
- [ ] **Telegram integration** — CEO sends reports and alerts via Telegram bot
- [ ] **Channel health checks** — Verify channels are working
- [ ] **CEO delivery routing** — CEO selects best channel based on availability and preference
- [ ] **Email / SMS** — Future, but interface should be extensible

---

## 9. Gallery & Artifacts (PRD Section 13)

- [ ] **Gallery page** — Central view of all outputs (documents, reports, images, logs). **Missing from navigation entirely**
- [ ] **Artifact storage** — Save agent outputs with metadata (date, agent, task, project, type)
- [ ] **Search & filter** — Filter artifacts by date, agent, task, project, type
- [ ] **Artifact detail view** — View/download individual artifacts

---

## 10. System Stats & Health (PRD Section 14)

- [ ] **System Stats page** — Always-on health dashboard. **Missing from navigation entirely**
- [ ] **Gateway health** — Is the execution gateway running?
- [ ] **Scheduler health** — Is the heartbeat scheduler alive?
- [ ] **CEO heartbeat status** — When did the CEO last check in?
- [ ] **Agent activity & responsiveness** — Per-agent health indicators
- [ ] **Budget burn widget** — Real-time budget consumption
- [ ] **Channel health** — Are notification channels working?
- [ ] **Overall system state** — Running, Degraded, Paused, Budget Constrained, Bootstrapping, Waiting for Approval

---

## 11. Audit & Accountability (PRD Section 15)

- [~] Audit page — Shows static dummy log with severity filter. Export button is non-functional
- [ ] **Real audit recording** — Every action logged: who, what, under whose authority, permissions used, cost, outcome
- [ ] **Immutable log** — Append-only, non-erasable audit trail (server-side)
- [ ] **Export functionality** — Wire up the Export button to download audit log
- [ ] **Audit integrity verification** — SHA-256 hash chain or similar (UI shows placeholder text)

---

## 12. System States & Safety Controls (PRD Section 16)

- [ ] **System state machine** — Explicit states: Bootstrapping, Running, Waiting for Approval, Budget Constrained, Degraded, Paused
- [ ] **Kill switch** — Human can pause all agents, pause individual agents, disable execution, lock budgets
- [ ] **Kill switch UI** — Prominent, always-accessible control in the navigation or header
- [ ] **State display** — Current system state visible at all times (nav rail CEO pip is a placeholder)

---

## 13. Dashboard Enhancements (PRD Section 4, 6)

- [x] Dashboard — Stats, missions, and agents all driven by real DB data
- [x] **Live data binding** — Stats show real agent count, active/done missions, monthly budget from DB
- [x] **Primary Mission card** — Editable mission statement with pencil icon + in-theme modal dialog, persisted to `primary_mission` setting
- [x] **Mission Control table** — Real missions from DB (ceremonies seed milestones), with recurring badge + hover tooltip, sorted by status then priority
- [x] **CEO in Agent Fleet** — Yellow-accented card with crown icon, model, status
- [x] **Ceremony milestone seeding** — Founder + CEO ceremonies auto-create "done" missions in Mission Control
- [ ] **Org Chart view** — Visual hierarchy showing CEO → agents reporting structure, with cost/workload rollup
- [ ] **Employee Monitor** — Live agent status (idle, working, blocked), current task, cost, health indicators
- [ ] **CEO status widget** — Show CEO heartbeat, current thinking, last report
- [ ] **Pending approvals summary** — Count and link to Human Tasks page

---

## 14. Missions / Task Management Enhancements

- [x] Missions Kanban — Reads real missions from DB, grouped by status (backlog → in_progress → review → done) with recurring badge + hover tooltip
- [x] **Recurring mission support** — `recurring` column in missions table, cyan RefreshCw icon with hover tooltip for cron description
- [x] **Mission schema extensions** — `recurring`, `created_by`, `created_at` columns added via migration
- [ ] **Task CRUD** — Create, edit, move, and complete missions from the UI
- [ ] **Task detail view** — Objective, context/backstory, constraints, assigned agent, status history
- [ ] **CEO integration** — Tasks created by CEO delegation, not just manual entry
- [ ] **Agent linkage** — Clicking assignee navigates to agent detail
- [ ] **Real-time updates** — Task status updates as agents work

---

## 15. Surveillance Module Enhancements

### Shipped (v1)
- [x] Pixel office with animated agent sprites
- [x] Scene modes (working, meeting, break, all_hands, welcome)
- [x] Hire agent modal with live sprite preview + DB persistence
- [x] Edit agent (name, role, color, skin, model)
- [x] Fire agent with confirmation
- [x] Agent detail sidebar (status, task, confidence, cost, model)
- [x] CEO walk-in ceremony (door open/close, walk to center, celebrate dance, jingle, walk to desk)
- [x] Agent hire ceremony (door animation, walk to center, celebrate, walk to desk)
- [x] CEO meeting approval notification after walk-in ceremony

### v2 — Image-Based Office + Floor Planner (Shipped)

**Pre-made floor images** in `public/floors/`:
| File | Tier | Agents | Layout |
|------|------|--------|--------|
| `startup.png` | 1 | 0-1 | CEO desk + window + plants + fire extinguisher + door |
| `level2.jpg` | 2 | 2-3 | 4 desks + window + plants + fire extinguisher + door |
| `level3.jpg` | 3 | 4-6 | 7 desks + whiteboard + plants + fire extinguisher |
| `level4.jpg` | 4 | 7+ | Multi-room: CEO office, open floor, conference room, many desks |

#### Environment & Rendering
- [x] **Image-based office backgrounds** — Pre-made pixel art images per room tier. Agent sprites overlay via absolute positioning
- [x] **Progressive room unlock** — Auto-swap background image as agent count crosses tier thresholds
- [x] **Top menu buttons** — [OVERVIEW] [FLOOR PLAN] [NETWORK] [ANALYTICS] as interactive HTML overlay

#### Data-Driven Positions
- [x] **DB schema: desk_x/desk_y** — Added to `agents` and `ceo` tables
- [x] **DB-first positioning** — Load from DB; fall back to `positionGenerator.ts` tier presets if NULL
- [x] **Preset default positions** — Per-tier CEO and agent desk defaults matching floor images

#### Floor Planner Mode
- [x] **Floor planner toggle** — FLOOR PLAN button in top menu activates edit mode
- [x] **Agent selection** — Click an agent sprite to select
- [x] **Click-to-place** — Click office floor to set desk position (with console coordinate logging)
- [x] **Persist to DB** — Saves desk_x/desk_y via `saveAgentDeskPosition()` / `saveCEODeskPosition()`
- [x] **Grid overlay** — Subtle green grid shown during floor plan mode
- [ ] **Ghost desk cursor** — Preview desk follows mouse when agent is selected

#### Movement & Animation
- [x] **Movement smoothing** — Constant-speed movement (0.6%/tick uniform speed)
- [ ] **Agent desk offset** — `translateY(14px)` when working so agents sit behind desks

#### Ad-hoc Meeting Clusters
- [x] **Agent clustering** — Meeting agents cluster at midpoints with configurable radius
- [x] **Meeting zone glow** — Purple glow circle around meeting clusters

#### Decorative / Interactive Elements
- [x] **Mission board** — Holographic "TODAY'S PRIORITIES" panel (top-right, pointer-events-none)
- [x] **Fire extinguisher tooltip** — Hover tooltip "Break Glass (Coming Soon)"

### Future
- [ ] **Real-time agent status** — Reflect actual agent execution state, not dummy data
- [ ] **Agent reporting lines** — Show who reports to whom in the office
- [ ] **Blocked state visualization** — Show when an agent is waiting on approval or budget
- [ ] **Advanced floor planner** — Drag-and-drop, snap-to-grid, zone editor
- [ ] **Per-group ad-hoc meetings** — Select 2-3 agents to form a meeting cluster
- [ ] **Conference zone editor** — Define named meeting areas on the floor plan

---

## 16. Navigation & Layout

- [x] Left nav rail with tooltips and active states
- [x] CEO status pip above Reset DB (green/yellow/red indicator)
- [x] Skills page — functional with DB-backed toggles, model dropdowns, vault integration, filter (All/Enabled/Disabled), search bar
- [x] Chat page — CEO onboarding conversation with skill recommendations, single-skill approval card, test interaction. Post-meeting: random CEO greeting (20 variants) + mission card. LLM:CONNECTED badge checks skill + API key
- [x] Approvals page added to navigation with pending count badge
- [ ] **Add Human Tasks** to navigation
- [ ] **Add Gallery** to navigation
- [ ] **Add System Stats** to navigation
- [ ] **Add Channels/Settings** to navigation (or settings page)
- [x] **Pending approval badge** — Shows count on Approvals nav item
- [ ] **System state indicator** — Replace hardcoded CEO pip with real system state

---

## 17. Skills Repository & Marketplace

> See `PLAN-SKILLS_REPO.md` for full implementation plan.

- [x] Skill definitions extracted to shared module (`src/data/skillDefinitions.ts`)
- [x] Keyword-to-skill recommender (`src/lib/skillRecommender.ts`)
- [x] CEO chat skill recommendations with inline approval card
- [x] **Skill JSON schema spec** — `skill.schema.json` with author, version, title, description, models, connection_type, commands
- [x] **Seed skills repo** — 18 JSON files in `/seed_skills_repo/` across 4 categories + schema + manifest
- [x] **Official skills GitHub repo** — README, LICENSE (Apache 2.0), manifest.json, real-manifest.json
- [ ] **Marketplace path** — Community skills from external repos, curated/cataloged
- [ ] **Skills refresh mechanism** — Daily auto-sync on page visit + manual refresh icon button
- [ ] **GitHub fetching engine** (`skillsRepository.ts`) — Manifest-based sync, checksum diffing
- [ ] **Skill resolver** (`skillResolver.ts`) — Merge hardcoded fallback + official repo + marketplace sources
- [ ] **Icon resolver** (`iconResolver.ts`) — Map JSON string icon names to Lucide React components
- [ ] **Test dialog per skill** — Themed modal with command selector, auto-generated parameter form, dry-run/live execution, result panel
- [ ] **OAuth connection type** — 4th connection option alongside api_key, curl, cli
- [ ] **OAuth flow (PKCE)** — Popup-based auth, token storage in `oauth_connections` table, callback route
- [ ] **OAuth token refresh** — Auto-refresh before expiry
- [ ] **`skill_definitions` table** — Cached remote skill data with checksums and source tracking
- [ ] **`oauth_connections` table** — OAuth token storage per provider with expiry and scopes
- [ ] **`skill_repos` table** — Configured skill repository sources with sync status

---

## 18. CEO Autonomous Agent System

> See `AI/CEO-Agent-System.md` for full design document.

### Chat & Communication
- [x] CEO onboarding chat — scripted conversation, mission capture, skill recommendations
- [ ] **Chat message persistence** — `chat_messages` table, load/save across page visits and sessions
- [ ] **CEO proactive chat** — CEO initiates conversations based on system state analysis
- [ ] **Chat badge on NavigationRail** — Unread message indicator for CEO proactive messages
- [ ] **Inline action cards in chat** — Hire recommendations, budget warnings, skill suggestions with approve/reject
- [~] **PostMeetingChat component** — Shows random CEO greeting + mission card + input (enabled when LLM connected). **Missing**: real LLM API calls, chat history persistence

### CEO Personality & Designation
- [ ] **CEO personality archetypes** — 8 founder-selectable archetypes (Wharton MBA, Wall Street Shark, MIT Engineer, Silicon Valley Founder, Beach Bum Philosopher, Military Commander, Creative Director, Research Professor) that inject personality blocks into CEO system prompt. See `AI/CEO-Designate.md`
- [ ] **CEO Ceremony archetype selector** — New step in CEOCeremony.tsx with visual archetype picker cards (2x4 grid, green border glow on selection)
- [ ] **`ceo` table column**: `archetype TEXT DEFAULT NULL` — stores selected personality archetype
- [ ] **CEO prompt assembly** (`ceoPersonality.ts`) — Runtime assembly of system prompt from archetype + philosophy + risk tolerance. See `AI/CEO/CEO-Prompts.md`

### Decision Engine & Scheduler
- [ ] **CEO decision engine** (`ceoDecisionEngine.ts`) — Evaluates missions, agents, skills, budget each cycle
- [ ] **CEO personality system** (`ceoPersonality.ts`) — Philosophy + risk_tolerance + archetype influence tone and thresholds
- [ ] **Scheduler system** (`ceoScheduler.ts`) — 5 options documented: setInterval, Visibility API-aware, Web Worker, Real Cron, Supabase Edge Function (recommended for full mode)
- [ ] **`useCEOScheduler` hook** — Mounted in AppLayout, manages scheduler lifecycle
- [ ] **CEO action queue** — `ceo_action_queue` table for pending/approved/completed actions
- [ ] **`scheduler_state` table** — Persistent scheduler state (last_run, cycle_count, frequency)

### Agent Hiring & Factory
- [ ] **Agent factory** (`agentFactory.ts`) — CEO generates full agent config: name, role, model, appearance, system prompt, description, prompt templates, assigned skills
- [ ] **Agent name pool** (`agentNamePool.ts`) — Thematic callsign pools by role category (research, code, content, design, security, data, ops)
- [ ] **Model selection strategy** — Cost-tier selection (cheap/mid/expensive) based on risk_tolerance + task complexity
- [ ] **Skill assignment** — CEO assigns specific skill IDs per agent based on role + mission. Agent's system prompt lists only assigned tools
- [ ] **System prompt generation** — CEO writes agent system prompts with assigned skills as callable tools, org mission context, philosophy
- [ ] **Hire recommendation flow** — CEO proposes hire in chat → approval card → founder approves/modifies/declines → ceremony triggers
- [ ] **Decline handling** — CEO says "No problem, I'll handle it myself" → marks self as executor

### Agent Task Execution
- [ ] **`task_executions` table** — Persistent task context: conversation history, assigned skills, status, tokens, cost, result
- [ ] **Task delegation** — CEO creates task_execution with system prompt + user prompt + assigned skills for the task
- [ ] **Conversation persistence** — Full LLM conversation history saved to DB so agents can resume after interruption
- [ ] **Mid-task approvals** — Agent pauses, creates approval, saves conversation. Approval triggers resume with full history
- [ ] **CEO review** — When agent completes task, CEO reviews results, updates mission status, writes audit log
- [ ] **Real-time status propagation** — Agent status updates surveillance sprites, missions board, dashboard, and agent details

### CEO Self-Execution
- [ ] **CEO executor** (`ceoExecutor.ts`) — CEO executes skills directly via LLM API fetch() when no specialist agent exists
- [ ] **Service API wrappers** — Request builders for Anthropic, OpenAI, Google, etc.
- [ ] **CEO cost tracking** — Per-execution token + cost attribution to CEO's budget counters

### Event System
- [ ] **Centralized events** (`events.ts`) — Event names + dispatch/listen helpers
- [ ] **New events**: `ceo-wants-to-chat`, `agent-hired`, `mission-assigned`, `skill-executed`, `ceo-heartbeat`, `ceo-status-changed`

### Extended Approvals
- [ ] **`hire_agent` approval type** — CEO proposes agent with full config preview/edit in ApprovalsView
- [ ] **`budget_override` approval type** — CEO requests to exceed daily/monthly budget
- [ ] **`execute_skill` approval type** — CEO requests permission for expensive skill execution
- [ ] **`agent_action` approval type** — Agent requests founder permission for mid-task actions

### Database Extensions
- [ ] **Agent columns**: system_prompt, description, user_prompt_template, assistant_prompt_template, hired_by, hired_at, tasks_assigned, tasks_completed, tokens_used, cost_total, current_task_id, skills (JSON array)
- [ ] **CEO columns**: token_budget_daily/monthly, tokens_used_today/month, cost_today/month, last_heartbeat, autonomous_mode
- [ ] **`chat_messages` table** — id, sender, text, metadata JSON, created_at
- [ ] **`ceo_action_queue` table** — id, type, status, payload JSON, priority, requires_approval, timestamps
- [ ] **`task_executions` table** — id, task_id, agent_id, status, conversation (JSON), assigned_skills (JSON), tokens, cost, result
- [ ] **Daily executive reports** — CEO produces daily summaries of work, spend, risks, and outcomes

---

## 19. Supabase Integration & Dual-Mode Architecture

> **Not needed for demo mode.** All items below are required only when implementing the CEO autonomous agent runtime with persistent scheduling, real-time updates, and multi-tab support. The current sql.js + IndexedDB stack is sufficient for the onboarding flow and UI development.
>
> Supabase self-hosted via Docker provides Postgres, Auth, Realtime, and Edge Functions. sql.js remains as offline/demo fallback.

### Data Layer Abstraction
- [ ] **DataService interface** (`dataService.ts`) — Async interface for all CRUD ops
- [ ] **SqliteDataService** (`sqliteDataService.ts`) — Wraps existing database.ts (sync→async)
- [ ] **SupabaseDataService** (`supabaseDataService.ts`) — Supabase JS client implementation
- [ ] **DataContext** (`contexts/DataContext.tsx`) — React context + `useData()` hook
- [ ] **Component migration** — Replace direct database.ts imports with useData() in all 8+ components

### Boot Sequence & Mode Selection
- [ ] **AppBoot** (`AppBoot.tsx`) — New top-level: mode detection → service init → auth gate → App
- [ ] **Mode selection screen** (`ModeSelectionScreen.tsx`) — "DEMO MODE" vs "FULL SETUP" in CRT theme
- [ ] **Health check** (`supabaseClient.ts`) — Ping Supabase REST endpoint to detect availability
- [ ] **Reconnect screen** — Shown when full mode but Supabase unreachable (retry / switch / reconfig)

### Supabase Infrastructure
- [ ] **supabase/config.toml** — Local Supabase CLI config (ports, auth settings, no email confirmation)
- [ ] **Migration 001** — Initial schema (settings, agents, ceo, missions, audit_log, vault, approvals, skills)
- [ ] **Migration 002** — Auth: user_profiles table linked to auth.users
- [ ] **Migration 003** — RLS policies (authenticated full access for single-tenant)
- [ ] **Migration 004** — CEO scheduler tables (scheduler_state, ceo_action_queue, chat_messages, task_executions)
- [ ] **Migration 005** — pg_cron + pg_net for CEO heartbeat Edge Function

### Authentication
- [ ] **LoginScreen** (`Auth/LoginScreen.tsx`) — CRT-themed login/signup
- [ ] **AuthContext** (`contexts/AuthContext.tsx`) — Session management via Supabase Auth
- [ ] **useAuth hook** — getSession, onAuthStateChange, signIn, signUp, signOut
- [ ] **First user auto-confirm** — No email verification for local self-hosted
- [ ] **Password reset script** (`scripts/reset-password.ts`) — CLI tool using service role key
- [ ] **Sign-out in NavigationRail** — Only shown in full mode

### Founder Ceremony Expansion
- [ ] **system_setup phase** — New phase in FounderCeremony for full mode only
- [ ] **Service check UI** — Live status indicators (Docker, Postgres, Auth, Realtime)
- [ ] **Supabase URL/key input** — Pre-filled for local dev, stored in localStorage
- [ ] **Account creation** — signUp during ceremony, creates user_profiles row

### CEO Scheduler (Edge Function)
- [ ] **ceo-heartbeat Edge Function** (`supabase/functions/ceo-heartbeat/index.ts`) — Deno, direct Postgres access
- [ ] **pg_cron schedule** — Every 60 seconds, calls Edge Function via pg_net
- [ ] **Realtime subscriptions** — Frontend subscribes to chat_messages + ceo_action_queue changes

---

## 20. Cross-Cutting Concerns

- [ ] **Error handling** — No global error boundary or toast system
- [ ] **Loading states** — Only the initial DB boot has a loading screen
- [ ] **Responsive design** — Currently desktop-only layout
- [ ] **Dark/light theme** — Currently dark-only (fine for v1, but note)
- [ ] **Keyboard shortcuts** — No keyboard navigation
- [ ] **Accessibility** — No ARIA labels, focus management, or screen reader support

---

## Priority Order (Suggested)

> **Note:** Phase 1 (Supabase) is only needed when moving past demo mode to enable the CEO autonomous agent runtime. Demo mode can proceed with Option B scheduler (Visibility-aware setInterval) + direct sql.js reads. The existing Dockerfile works for deploying the SPA — no Supabase Docker setup is needed until Phase 1.

### Phase 0 — Demo Mode Enhancements (no backend needed)
1. ~~Dashboard live data binding (from sql.js)~~ **DONE** — Real stats, CEO in fleet, mission card with edit, Mission Control from DB
2. ~~Budget editing UI~~ **DONE** — Founder-ceremony-themed dialog on Financials page
3. ~~Missions Kanban from DB~~ **DONE** — Real missions with recurring badge, ceremony milestones auto-seeded
4. CEO Ceremony API key validation (format check + connectivity test + skip dialog)
5. CEO personality archetypes + ceremony archetype selector
6. Mission CRUD (create, edit, move, complete from Kanban)
7. Skill resolver + icon resolver + refresh mechanism from GitHub repo
8. Skill test dialog (dry-run mode)
9. Audit real logging (sql.js writes on every action)

### Phase 1 — Supabase Foundation & Dual-Mode Boot
7. DataService interface + SqliteDataService wrapper
8. DataContext + useData() hook
9. Migrate components to useData() (async)
10. AppBoot + ModeSelectionScreen
11. Supabase config + migrations (001-003)
12. SupabaseDataService implementation
13. Auth (LoginScreen, AuthContext, useAuth)
14. FounderCeremony system_setup phase

### Phase 2 — CEO Autonomy
15. CEO scheduler: Visibility-aware (demo) + Edge Function + pg_cron (full mode)
16. Decision engine + personality system + archetype prompt assembly
17. Chat message persistence + proactive CEO messaging
18. Agent factory + skill assignment model
19. Hire recommendation flow + approval cards

### Phase 3 — Agent Runtime
20. Task execution engine — persistent conversation, mid-task approvals, resume flow
21. Agent LLM calls via skill definitions + assigned tools
22. CEO self-execution (ceoExecutor.ts)
23. Task lifecycle (delegate → execute → pause/approve → complete → CEO review)
24. Real-time status propagation (surveillance, missions, dashboard)

### Phase 4 — Governance & Controls
25. Permission model + UI
26. Budget enforcement + real cost tracking
27. Extended approval types (hire, budget, skill execution, agent action)
28. Kill switch & system state machine

### Phase 5 — Remaining Modules
29. Vault — encrypted storage (pgcrypto) + scoped access + OAuth connections
30. Audit — immutability + export
31. Gallery & Artifacts
32. System Stats & Health page
33. Channels & Telegram integration
34. Skills marketplace (community repos)

### Phase 6 — Polish
35. Org Chart visualization
36. Navigation additions (Human Tasks, Gallery, Stats, Channels)
37. Error handling, toasts, loading states
38. Responsive design, keyboard shortcuts, accessibility
