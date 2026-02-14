# Skill Execution Pipeline Implementation Plan

> **STATUS: COMPLETED** — Shipped in Sprint 5 (Feb 2026)
>
> **What shipped:**
> - Edge Runtime in Docker stack (`supabase-functions` service)
> - `execute-skill` Edge Function — background LLM execution with multi-provider support
> - `taskDispatcher.ts` — parses `<task_plan>` blocks, creates missions + task_executions, dispatches to Edge Function
> - `TaskPlanBlock` / `ToolCallBlock` / `RichResultCard` — chat UI for mission cards with live status
> - Realtime subscriptions for `task_executions` table
> - Mission review flow with nav badge (green badge for items in review)
> - `MissionDetailPage.tsx` — full detail view with task outputs and approve/redo
> - `CollateralView.tsx` — artifact browser with filters (date, skill, search)
> - `FinancialsView.tsx` — wired to real `llm_usage` data
> - Agent + CEO hover cards with cost tracking
> - `llm_usage` table + `llmUsage.ts` aggregation functions
> - Kong route for Edge Functions
>
> **What didn't ship (deferred):**
> - Notification channels (migration 005) — table created but no adapters
> - Vault channels section — placeholder only
> - Toast notification system — basic implementation

---

> **Goal:** Wire CEO tool calls into background Supabase Edge Function execution with Realtime notifications, mission integration, a Collateral artifact browser, real Financials, and Vault notification channels.

**Architecture:** CEO LLM responses containing `<task_plan>` blocks are parsed in the browser, creating missions + task_executions rows. Each task is dispatched to a Supabase Edge Function (`execute-skill`) which calls the LLM provider, writes results to DB, and moves missions to `review`. Browser receives updates via Supabase Realtime, showing toast notifications and updating nav badges. Collateral page provides a browsable archive. Financials switches from dummy to real `llm_usage` + `channel_usage` data.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Supabase (Postgres + PostgREST + Realtime + Edge Runtime/Deno), Web Audio API

---

## Task Dependencies

```
Task 1  (Docker edge-runtime)     ← independent
Task 2  (Migration 005)           ← independent
Task 3  (Edge function)           ← depends on Task 1
Task 4  (Task plan parser)        ← depends on Task 3
Task 5  (TaskPlanBlock component) ← depends on Task 4
Task 6  (Realtime + toast)        ← independent
Task 7  (Missions review + badge) ← depends on Task 6
Task 8  (Collateral page)         ← depends on Task 5, 7
Task 9  (Financials real data)    ← independent
Task 10 (Agent/CEO hover costs)   ← depends on Task 9
Task 11 (Vault channels)          ← depends on Task 2
```

All 11 tasks shipped. See individual task sections below for implementation details.

---

### Task 1: Edge Runtime in Docker Stack — SHIPPED

**Key files:**
- `docker/docker-compose.yml` — `supabase-functions` service added
- `docker/supabase/kong.yml` — `/functions/v1/` route added
- `docker/supabase/functions/main/index.ts` — main dispatcher

---

### Task 2: Migration 005 — Channels Tables — SHIPPED

**Key file:** `docker/supabase/migrations/005_channels.sql`
Tables: `notification_channels`, `channel_usage`

---

### Task 3: Edge Function — `execute-skill` — SHIPPED

**Key file:** `docker/supabase/functions/execute-skill/index.ts`

Multi-provider LLM execution (Anthropic, OpenAI, Google, DeepSeek, xAI). Reads task_execution from DB, loads skill definition, gets API key from vault, calls LLM, writes results + usage back. Moves mission to `review` when all tasks complete.

---

### Task 4: Task Plan Parser & Dispatch — SHIPPED

**Key file:** `src/lib/taskDispatcher.ts`

- `parseTaskPlan(text)` — extracts `<task_plan>` and `<tool_call>` blocks
- `stripTaskBlocks(text)` — removes blocks, leaving conversational text
- `dispatchTaskPlan(missions, model)` — creates missions + task_executions, dispatches to Edge Function

Wired into `chatService.ts` `onDone` callback.

---

### Task 5: TaskPlanBlock + ToolCallBlock — SHIPPED

**Key files:**
- `src/components/Chat/ToolCallBlock.tsx` — renders tool calls in chat
- `src/components/Chat/RichResultCard.tsx` — rich skill execution results
- `src/components/Chat/ChatThread.tsx` — message rendering with task plan integration

---

### Task 6: Realtime Subscriptions + Toast — SHIPPED

`task_executions` added to Realtime subscription table map.

---

### Task 7: Missions Review Flow + Nav Badge — SHIPPED

**Key files:**
- `src/components/Missions/MissionsView.tsx` — review column
- `src/components/Missions/MissionDetailPage.tsx` — full detail view
- `src/components/Layout/NavigationRail.tsx` — green review badge
- `src/lib/database.ts` — `getMissionReviewCount()`, `loadTaskExecutions()`

---

### Task 8: Collateral Page — SHIPPED

**Key file:** `src/components/Collateral/CollateralView.tsx`
- Grid of completed task execution outputs
- Filters: date range, skill type, text search
- Detail view with full output

---

### Task 9: Financials — Real Data — SHIPPED

**Key files:**
- `src/lib/llmUsage.ts` — `getMonthlyUsage()`, `getCurrentMonthSpend()`, `getAgentUsage()`
- `src/components/Financials/FinancialsView.tsx` — wired to real data

---

### Task 10: Agent & CEO Cost Hover Cards — SHIPPED

**Key files:**
- `src/components/Surveillance/AgentSprite.tsx` — cost in tooltip
- `src/components/Surveillance/CEOSprite.tsx` — personality + cost display

---

### Task 11: Vault — Notification Channels — PARTIALLY SHIPPED

Channel CRUD exists in database.ts. VaultView has placeholder section. No adapters implemented.

---

## Verification Checklist

- [x] Edge Functions reachable via Kong at `/functions/v1/`
- [x] `execute-skill` function processes task_execution_id and calls LLM
- [x] CEO chat responses with `<task_plan>` blocks create missions
- [x] Task executions dispatch to Edge Function
- [x] Realtime updates flow back to browser
- [x] Mission moves to review when all tasks complete
- [x] Green badge appears on Missions nav
- [x] Collateral page shows completed outputs
- [x] Financials shows real spend data
- [x] Agent/CEO hover shows cost
