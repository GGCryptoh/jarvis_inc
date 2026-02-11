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
- [x] Reset DB flow with confirmation dialog
- [ ] **Backend server** — No backend exists. Need an API server (Node/Express, Fastify, or Python) to host the AI CEO, agent runtime, gateway, and scheduler
- [ ] **Database migration to server-side** — Move from client-only sql.js to a proper server-side SQLite/Postgres with API endpoints
- [ ] **Authentication** — No auth. PRD requires human owner identity beyond the ceremony
- [ ] **WebSocket / SSE layer** — Real-time push from backend to frontend for live agent status, approvals, and system events

---

## 2. AI CEO & Orchestration Engine (PRD Section 5, 7)

- [ ] **CEO agent runtime** — Instantiate a persistent AI CEO using an LLM (Claude/GPT). The CEO interprets goals, delegates, approves, and reports
- [~] **Goal ingestion** — CEO onboarding chat asks for primary mission and saves to DB settings. **Missing**: structured goal/constraint editing, ongoing goal management
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

- [~] Agent CRUD — Can hire/edit/fire agents in Surveillance UI, persisted to DB. Skills page exists as placeholder. **Missing**: role-based tool assignment, reporting lines, permission profiles
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

- [~] Vault page — Shows static table with dummy entries. Rotate button is non-functional
- [ ] **Real secret storage** — Encrypted at-rest storage for API keys and credentials (server-side)
- [ ] **Scoped access** — Secrets granted to specific agents, revocable
- [ ] **Secret CRUD** — Add, rotate, revoke secrets from the UI
- [ ] **Model access grants** — Explicitly grant which LLM models each agent can use
- [ ] **Usage tracking** — Track which agent used which secret, when, and at what cost
- [ ] **Audit integration** — All vault access logged to audit trail

---

## 7. Human Tasks & Approvals (PRD Section 11)

- [ ] **Human Tasks page** — Dedicated inbox/queue for all pending human decisions. **Missing from navigation entirely**
- [ ] **Approval cards** — Each task shows: who is requesting, what, why, cost/risk impact, approve/reject/modify
- [ ] **Approval triggers** — New agent creation, secret access, budget overrides, high-risk actions, multi-agent delegation
- [ ] **Notification badges** — Nav item shows count of pending approvals
- [ ] **Approval history** — Record of all past decisions

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

- [x] Pixel office with animated agent sprites
- [x] Scene modes (working, meeting, break, all_hands, welcome)
- [x] Hire agent modal with live sprite preview + DB persistence
- [x] Edit agent (name, role, color, skin, model)
- [x] Fire agent with confirmation
- [x] Agent detail sidebar (status, task, confidence, cost, model)
- [x] CEO walk-in ceremony (door open/close, walk to center, celebrate dance, jingle, walk to desk)
- [x] Agent hire ceremony (door animation, walk to center, celebrate, walk to desk)
- [x] CEO meeting approval notification after walk-in ceremony
- [ ] **Real-time agent status** — Reflect actual agent execution state, not dummy data
- [ ] **Agent reporting lines** — Show who reports to whom in the office
- [ ] **Blocked state visualization** — Show when an agent is waiting on approval or budget

---

## 16. Navigation & Layout

- [x] Left nav rail with tooltips and active states
- [x] CEO status pip above Reset DB (green/yellow/red indicator)
- [x] Skills page added to navigation
- [x] Chat page with CEO onboarding conversation
- [ ] **Add Human Tasks** to navigation
- [ ] **Add Gallery** to navigation
- [ ] **Add System Stats** to navigation
- [ ] **Add Channels/Settings** to navigation (or settings page)
- [ ] **Pending approval badge** — Show count on Human Tasks nav item
- [ ] **System state indicator** — Replace hardcoded CEO pip with real system state

---

## 17. Cross-Cutting Concerns

- [ ] **Error handling** — No global error boundary or toast system
- [ ] **Loading states** — Only the initial DB boot has a loading screen
- [ ] **Responsive design** — Currently desktop-only layout
- [ ] **Dark/light theme** — Currently dark-only (fine for v1, but note)
- [ ] **Keyboard shortcuts** — No keyboard navigation
- [ ] **Accessibility** — No ARIA labels, focus management, or screen reader support

---

## Priority Order (Suggested)

### Phase 1 — Backend Foundation
1. Stand up backend server with API routes
2. Migrate DB to server-side
3. WebSocket/SSE for real-time updates
4. Wire existing frontend pages to real API data

### Phase 2 — CEO & Agent Runtime
5. Implement AI CEO orchestrator
6. Implement agent execution engine
7. Task lifecycle (create → assign → execute → complete)
8. Heartbeat scheduler

### Phase 3 — Governance & Controls
9. Permission model + UI
10. Budget enforcement + real cost tracking
11. Human Tasks & Approval queue
12. Kill switch & system state machine

### Phase 4 — Remaining Modules
13. Vault — real secret storage + scoped access
14. Audit — real logging + immutability
15. Gallery & Artifacts
16. System Stats & Health page
17. Channels & Telegram integration

### Phase 5 — Polish
18. Org Chart visualization
19. Dashboard live data binding
20. Mission CRUD + CEO integration
21. Navigation additions (Human Tasks, Gallery, Stats, Channels)
22. Error handling, toasts, loading states
