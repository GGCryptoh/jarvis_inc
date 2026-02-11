# TASKS — Jarvis Inc. v1

> PRD-to-code gap analysis. Checked against current codebase as of 2026-02-10.

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
- [ ] **Backend server** — No backend exists. Need an API server (Node/Express, Fastify, or Python) to host the AI CEO, agent runtime, gateway, and scheduler
- [ ] **Database migration to server-side** — Move from client-only sql.js to a proper server-side SQLite/Postgres with API endpoints
- [ ] **Authentication** — No auth. PRD requires human owner identity beyond the ceremony
- [ ] **WebSocket / SSE layer** — Real-time push from backend to frontend for live agent status, approvals, and system events

---

## 2. AI CEO & Orchestration Engine (PRD Section 5, 7)

- [ ] **CEO agent runtime** — Instantiate a persistent AI CEO using an LLM (Claude/GPT). The CEO interprets goals, delegates, approves, and reports
- [~] **Goal ingestion** — CEO onboarding chat asks for primary mission, saves to DB, recommends skills based on mission keywords, inline approval card. **Missing**: structured goal/constraint editing, ongoing goal management
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
- [x] **Skills configuration** — 13 skills across 4 categories, org-wide toggle + model assignment, auto-approval for missing API keys
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

- [~] Financials page — Shows static bar chart and table with dummy data. **Not functional**
- [ ] **Real budget tracking** — Daily and monthly budgets at system and agent level, fed by actual LLM token/API costs
- [ ] **Overage thresholds** — Configurable (e.g., 10% daily, 5% monthly) with warnings
- [ ] **Budget enforcement** — Pause agent execution when budget exceeded (unless override approved)
- [ ] **Budget override flow** — CEO requests override, human approves, time-bound and logged
- [ ] **Per-agent cost tracking** — Real-time token and API cost attribution per agent
- [ ] **Budget editing UI** — Human can directly edit budgets

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
- [x] **Approval triggers** — Auto-created when hiring agents or enabling skills whose model's service lacks a vault key
- [x] **Notification badges** — Approvals nav item shows count of pending approvals (refreshed every 5s)
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

- [~] Dashboard — Shows hardcoded stats, agent cards, and mission table. **Not connected to real data**
- [ ] **Live data binding** — Dashboard stats driven by real agent activity, costs, and task counts
- [ ] **Org Chart view** — Visual hierarchy showing CEO → agents reporting structure, with cost/workload rollup
- [ ] **Employee Monitor** — Live agent status (idle, working, blocked), current task, cost, health indicators
- [ ] **CEO status widget** — Show CEO heartbeat, current thinking, last report
- [ ] **Pending approvals summary** — Count and link to Human Tasks page

---

## 14. Missions / Task Management Enhancements

- [~] Missions page — Static Kanban board with dummy data. **No CRUD, no real data**
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
- [x] Skills page — functional with DB-backed toggles, model dropdowns, vault integration
- [x] Chat page — CEO onboarding conversation with mission-based skill recommendations, inline approval card, auto-enable flow
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
- [ ] **Skill JSON schema spec** — `create_images.json` format with author, version, title, description, models, connection_type, commands
- [ ] **Seed skills repo** — 13 JSON files in `/seed_skills_repo/` matching current hardcoded skills
- [ ] **Official skills GitHub repo** — README, LICENSE (Apache 2.0), manifest.json
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
- [ ] **ActiveChat component** — Replace PostMeetingChat placeholder with full interactive chat

### Decision Engine & Scheduler
- [ ] **CEO decision engine** (`ceoDecisionEngine.ts`) — Evaluates missions, agents, skills, budget each cycle
- [ ] **CEO personality system** (`ceoPersonality.ts`) — Philosophy + risk_tolerance influence tone and thresholds
- [ ] **Scheduler system** (`ceoScheduler.ts`) — 4 options documented: setInterval, Visibility API-aware, Web Worker, Real Cron
- [ ] **`useCEOScheduler` hook** — Mounted in AppLayout, manages scheduler lifecycle
- [ ] **CEO action queue** — `ceo_action_queue` table for pending/approved/completed actions
- [ ] **`scheduler_state` table** — Persistent scheduler state (last_run, cycle_count, frequency)

### Agent Hiring & Factory
- [ ] **Agent factory** (`agentFactory.ts`) — CEO generates full agent config: name, role, model, appearance, system prompt, description, prompt templates
- [ ] **Agent name pool** (`agentNamePool.ts`) — Thematic callsign pools by role category (research, code, content, design, security, data, ops)
- [ ] **Model selection strategy** — Cost-tier selection (cheap/mid/expensive) based on risk_tolerance + task complexity
- [ ] **System prompt generation** — CEO writes agent system prompts from mission + philosophy context
- [ ] **Hire recommendation flow** — CEO proposes hire in chat → approval card → founder approves/modifies/declines → ceremony triggers
- [ ] **Decline handling** — CEO says "No problem, I'll handle it myself" → marks self as executor

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

### Database Extensions
- [ ] **Agent columns**: system_prompt, description, user_prompt_template, assistant_prompt_template, hired_by, hired_at, tasks_assigned, tasks_completed, tokens_used, cost_total, current_task_id
- [ ] **CEO columns**: token_budget_daily/monthly, tokens_used_today/month, cost_today/month, last_heartbeat, autonomous_mode
- [ ] **`chat_messages` table** — id, sender, text, metadata JSON, created_at
- [ ] **`ceo_action_queue` table** — id, type, status, payload JSON, priority, requires_approval, timestamps
- [ ] **Daily executive reports** — CEO produces daily summaries of work, spend, risks, and outcomes

---

## 19. Cross-Cutting Concerns

- [ ] **Error handling** — No global error boundary or toast system
- [ ] **Loading states** — Only the initial DB boot has a loading screen
- [ ] **Responsive design** — Currently desktop-only layout
- [ ] **Dark/light theme** — Currently dark-only (fine for v1, but note)
- [ ] **Keyboard shortcuts** — No keyboard navigation
- [ ] **Accessibility** — No ARIA labels, focus management, or screen reader support

---

## Priority Order (Suggested)

### Phase 1 — Skills Repository & CEO Autonomy (Client-Side)
1. Seed skills repo — JSON files for all 13 skills
2. Skill resolver + icon resolver + refresh mechanism
3. CEO scheduler (Visibility API-aware) + decision engine
4. Chat message persistence + proactive CEO messaging
5. Agent factory + hire recommendation flow

### Phase 2 — Backend Foundation
6. Stand up backend server with API routes
7. Migrate DB to server-side
8. WebSocket/SSE for real-time updates
9. Wire existing frontend pages to real API data
10. Migrate CEO scheduler to real cron job

### Phase 3 — CEO & Agent Runtime
11. Implement AI CEO orchestrator (real LLM calls)
12. Implement agent execution engine
13. Task lifecycle (create → assign → execute → complete)
14. CEO self-execution via API wrappers

### Phase 4 — Governance & Controls
15. Permission model + UI
16. Budget enforcement + real cost tracking
17. Extended approval types (hire, budget, skill execution)
18. Kill switch & system state machine

### Phase 5 — Remaining Modules
19. Vault — real secret storage + scoped access + OAuth connections
20. Audit — real logging + immutability
21. Gallery & Artifacts
22. System Stats & Health page
23. Channels & Telegram integration
24. Skills marketplace (community repos)

### Phase 6 — Polish
25. Org Chart visualization
26. Dashboard live data binding
27. Mission CRUD + CEO integration
28. Navigation additions (Human Tasks, Gallery, Stats, Channels)
29. Error handling, toasts, loading states
30. Skill test dialog (dry-run → live execution)
