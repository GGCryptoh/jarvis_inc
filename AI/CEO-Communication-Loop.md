# CEO Communication Loop

> How the CEO detects events, evaluates org state, queues actions,
> and communicates with the founder through persistent chat.

### Implementation Status (2026-02-13)

| Area | Status | Key File(s) |
|------|--------|-------------|
| CEO Scheduler (Option B) | **SHIPPED** | `src/lib/ceoScheduler.ts` |
| Decision Engine (heuristic) | **SHIPPED** | `src/lib/ceoDecisionEngine.ts` |
| CEO Action Queue | **SHIPPED** | `src/lib/ceoActionQueue.ts` |
| Chat Persistence (conversations + messages) | **SHIPPED** | `src/lib/database.ts`, `src/components/Chat/ChatView.tsx` |
| LLM Streaming (5 providers) | **SHIPPED** | `src/lib/llm/chatService.ts` |
| System Prompt (13 sections) | **SHIPPED** | `src/lib/llm/chatService.ts` → `buildCEOSystemPrompt()` |
| Memory Injection (org + founder profile) | **SHIPPED** | `src/lib/memory.ts` |
| Task Plan Parsing + Dispatch | **SHIPPED** | `src/lib/taskDispatcher.ts` |
| Supabase Realtime Subscriptions | **SHIPPED** | `src/hooks/useRealtimeSubscriptions.ts` |
| QuickChatPanel on Surveillance | **SHIPPED** | `src/components/Surveillance/QuickChatPanel.tsx` |
| Mission Review Flow (nav badge) | **SHIPPED** | `src/components/Missions/MissionDetailPage.tsx` |
| CEO-initiated proactive chat | NOT BUILT | CEO responds but does not initiate conversations |
| Rich action cards in chat (hire, budget, etc.) | NOT BUILT | Only skill approval cards exist |
| Budget warnings / threshold alerts | NOT BUILT | Budget is tracked and enforced, but no proactive warnings |
| "Hey founder we need to chat!" flow | NOT BUILT | No attention-request message type |
| Cross-tab / cross-device notifications | NOT BUILT | Single-tab only (Option B scheduler) |
| Edge Function + pg_cron (Option E) | NOT BUILT | Using browser-side Option B |

---

## Overview

The CEO operates in two modes:

1. **Reactive** (shipped): The founder sends a message in Chat. The CEO's LLM processes it with full org context (system prompt), streams a response, and optionally dispatches skill-backed tasks via `<task_plan>` blocks.

2. **Background evaluation** (shipped): The CEO Scheduler runs a heuristic decision engine every 30 seconds. It detects org-level issues (unassigned missions, idle agents, stale approvals, stuck tasks) and writes lightweight notifications to the `ceo_action_queue` table. The UI picks these up via Supabase Realtime.

The CEO does **not** currently initiate conversations. It evaluates state and queues notifications, but all chat messages originate from the founder or from task completion events.

---

## The Loop

```
┌─────────────────────────────────────────────────────────┐
│              CEO SCHEDULER TICK (every 30s)              │
│  CEOScheduler class — visibility-aware setInterval       │
│  Pauses when tab hidden, resumes + immediate tick on     │
│  tab visible. Writes heartbeat to scheduler_state table. │
└──────────────┬──────────────────────────────────────────┘
               │
        ┌──────▼──────┐
        │  LOAD STATE  │  ← loadAgents(), loadMissions(), loadSkills(),
        │              │    loadApprovals(), loadCEO()
        └──────┬──────┘
               │
        ┌──────▼──────────────┐
        │  HEURISTIC CHECKS   │  ← 6 rule-based checks (no LLM)
        └──────┬──────────────┘
               │
        ┌──────▼──────┐     ┌─────────────────────┐
        │  FILTER      │────→│ Deduplicate against  │
        │  (dedup)     │     │ existing pending/     │
        │              │     │ recently dismissed    │
        └──────┬──────┘     │ entries (2hr cooldown)│
               │             └─────────────────────┘
        ┌──────▼──────┐
        │  INSERT      │  ← New actions → ceo_action_queue table
        └──────┬──────┘
               │
        ┌──────▼──────┐
        │  PRUNE       │  ← Delete dismissed/seen entries older than 2 hours
        └──────┬──────┘
               │
        ┌──────▼──────┐
        │  SKILL SYNC  │  ← seedSkillsFromRepo() — throttled to once per hour
        └──────┬──────┘
               │
        ┌──────▼──────┐
        │  RETURN      │  ← CycleResult { timestamp, actions, checks }
        │  DIAGNOSTICS │    Written to scheduler_state.last_cycle_result
        └─────────────┘
```

---

## Heuristic Checks (What the Engine Evaluates Each Tick)

All checks are pure heuristics — no LLM calls. The engine reads org state from Supabase and applies simple rules.

| Check | Detection Logic | Action Produced | Priority |
|-------|----------------|-----------------|----------|
| **Unassigned missions** | Missions with status `active` or `in_progress` and no `assignee` | `assign_mission` — pairs each unassigned mission with an idle agent | 3 |
| **Idle agents** | Agents not assigned to any active/in_progress mission | `send_message` with topic `idle_workforce` | 6 |
| **Stale approvals** | Approvals with `status = 'pending'` older than 24 hours | `send_message` with topic `stale_approvals` | 4 |
| **No agents hired** | Zero agents but 1+ missions exist | `send_message` with topic `no_agents` — suggests hiring | 2 |
| **Skills gap** | 1+ missions exist but zero skills enabled | `send_message` with topic `skills_gap` | 5 |
| **Stuck tasks** | `task_executions` in `pending`/`running` status for > 5 minutes | Auto-fails the task, moves mission to `review` if all siblings terminal, posts chat message with action buttons, triggers `synthesizeMissionSummary()` for multi-task missions | N/A (direct DB mutation) |

### Not Yet Evaluated (Aspirational)

These triggers are described in the original design but not implemented:

- Founder sent a chat message (CEO responds reactively via `streamCEOResponse`, not via the scheduler)
- Agent waiting for approval
- All agents busy / utilization > 80%
- Missing skill for a specific task (keyword matching)
- Budget threshold reached
- No activity for extended period ("check in" behavior)

---

## CEO Action Queue

The action queue is a lightweight notification system, not a rich action-card UI. Actions are rows in the `ceo_action_queue` Supabase table.

### Schema

```typescript
interface CEOAction {
  id: string;
  action_type: 'mission_review' | 'needs_attention' | 'insight' | 'greeting';
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  status: 'pending' | 'seen' | 'dismissed';
  created_at: string;
}
```

### API (`src/lib/ceoActionQueue.ts`)

| Function | What It Does |
|----------|-------------|
| `queueCEOAction(type, title, message, metadata?)` | Insert a new pending action, dispatch `ceo-actions-changed` event |
| `loadPendingActions()` | Load up to 10 pending actions, newest first |
| `markActionSeen(actionId)` | Update status to `seen`, dispatch event |
| `dismissAction(actionId)` | Update status to `dismissed`, dispatch event |
| `getPendingActionCount()` | Count of pending actions (used for badges) |

### Deduplication

The decision engine deduplicates before inserting: it fetches all `pending`, `seen`, and `dismissed` entries created within the last 2 hours and skips any action whose `payload.topic` already exists. Old dismissed/seen entries are pruned after each cycle (2-hour TTL).

### UI Integration

- Supabase Realtime subscription on `ceo_action_queue` dispatches `ceo-actions-changed` window events (`src/hooks/useRealtimeSubscriptions.ts`).
- The NavigationRail Chat badge shows the count of **unread conversations** (via `getUnreadConversationCount()`), not the action queue count directly. The action queue feeds into the system but the badge is conversation-driven.

---

## Chat Persistence (Shipped)

Chat is fully persisted in Supabase. No more in-memory-only messages.

### Tables

**`conversations`**
| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | `conv-{timestamp}-{random}` |
| `title` | text | Auto-generated or user-set |
| `participant` | text | `'ceo'` |
| `status` | text | `'active'` or `'archived'` |
| `last_read_at` | timestamp | Tracks founder's read position |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

**`chat_messages`**
| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | `msg-{timestamp}-{random}` |
| `conversation_id` | text FK | References `conversations.id` |
| `sender` | text | `'user'` or `'ceo'` |
| `text` | text | Message content (markdown) |
| `metadata` | jsonb | Action card data, tool call results, etc. |
| `token_count` | integer | Approximate token count |
| `created_at` | timestamp | |

### Components

| Component | Role |
|-----------|------|
| `ChatView.tsx` | Main chat page — routes between onboarding flow and post-meeting chat |
| `ChatSidebar.tsx` | Conversation list with new/archive actions |
| `ChatThread.tsx` | Message rendering with LLM streaming support |
| `OnboardingFlow.tsx` | Scripted first-run onboarding (separate from persistent chat) |
| `QuickChatPanel.tsx` | Compact chat overlay on Surveillance page |
| `ToolCallBlock.tsx` | Renders tool call results and action buttons inline |
| `RichResultCard.tsx` | Renders skill execution results with formatted output |

### Conversation Lifecycle

1. Founder navigates to Chat after onboarding is complete.
2. On "New Conversation", a random CEO greeting is selected (pool of 20, with LRU history to avoid repeats) and inserted as the first CEO message.
3. Founder types a message. `streamCEOResponse()` builds the full system prompt, appends the last 20 messages as context, and streams the LLM response.
4. CEO response is parsed for `<task_plan>` / `<tool_call>` blocks. Matched blocks are dispatched via `taskDispatcher.ts`. `enable_skill` calls create approval cards.
5. Conversations can be archived from the sidebar.
6. `markConversationRead()` updates `last_read_at` to track unread status.

### Realtime

Supabase Realtime subscriptions on `chat_messages` dispatch `chat-messages-changed` window events, keeping all open tabs/components in sync.

---

## CEO System Prompt

Built fresh for every LLM call by `buildCEOSystemPrompt()` in `src/lib/llm/chatService.ts`. Contains these sections:

| # | Section | Source |
|---|---------|--------|
| 1 | **Identity** | CEO name, org name, founder name, primary mission, today's date |
| 2 | **Personality** | `ARCHETYPE_PERSONAS[ceo.archetype]` — 8 archetypes (Wharton MBA, Wall Street, MIT Engineer, SV Founder, Beach Bum, Military Commander, Creative Director, Professor) |
| 3 | **Philosophy** | `PHILOSOPHY_BLOCKS[ceo.philosophy]` — 4 options (Move fast, Steady, Data-driven, Innovation) |
| 4 | **Risk Tolerance** | `RISK_BLOCKS[ceo.risk_tolerance]` — 3 levels (Conservative, Moderate, Aggressive) with specific behavior rules |
| 5 | **Founder Profile** | `org_memory` rows where `category = 'founder_profile'`, sorted by importance |
| 6 | **Organizational Memory** | Top 20 non-founder memories from `org_memory`, sorted by importance then recency |
| 7 | **Workforce** | Agent list with name, role, model |
| 8 | **Enabled Skills** | Full command definitions with parameter names, types, required/optional, defaults, descriptions |
| 9 | **Disabled Skills** | Available-but-not-enabled skills (real ones from GitHub repo, not hardcoded placeholders) |
| 10 | **Active Missions** | Mission list with status, assignee, priority |
| 11 | **Budget & Spend** | Monthly budget, current month spend (LLM + channel breakdown), remaining, exceeded warning |
| 12 | **Tool Usage Rules** | 4-step decision flow: answer from knowledge, use a skill, propose a mission, suggest enabling a disabled skill. Parameter checking, quick vs long task guidance, `<task_plan>` output format |
| 13 | **Critical Rules** | Respond naturally, match personality, never fabricate data, never fire skills silently, keep responses concise |

### Conversation Context

After the system prompt, the last 20 messages from the active conversation are appended as alternating `user`/`assistant` turns, followed by the current user message.

---

## CEO Scheduler

**Implementation**: `src/lib/ceoScheduler.ts` — Option B (visibility-aware `setInterval`).

### Class: `CEOScheduler`

| Method | Description |
|--------|-------------|
| `start()` | Begin ticking. Registers `visibilitychange` listener if `pauseWhenHidden` is true. |
| `stop()` | Clear interval, remove listener, set status to `stopped`. |
| `pause()` | Manual pause (keeps status as `paused`). |
| `resume()` | Resume from manual pause. |
| `getStatus()` | Returns `'running'` / `'paused'` / `'stopped'`. |
| `getState()` | Returns `{ status, lastHeartbeat, lastCycleResult }`. |

### Configuration

```typescript
interface SchedulerConfig {
  intervalMs: number;        // default 30000 (30 seconds)
  pauseWhenHidden: boolean;  // default true
}
```

### Visibility Behavior

- **Tab hidden**: Clears the interval but keeps status as `running` (visibility pause, not manual pause).
- **Tab visible**: Re-schedules the interval AND runs an immediate tick so the CEO catches up on anything that happened while the tab was hidden.

### State Persistence

After every tick, the scheduler upserts to the `scheduler_state` table:

```typescript
{
  id: 'main',
  status: 'running' | 'paused' | 'stopped',
  interval_ms: number,
  last_heartbeat: ISO timestamp,
  last_cycle_result: CycleResult,
  config: SchedulerConfig,
  updated_at: ISO timestamp,
}
```

### Factory

```typescript
import { createScheduler } from './ceoScheduler';
const scheduler = createScheduler(evaluateCycle, { intervalMs: 30000 });
scheduler.start();
```

---

## Task Dispatch from Chat

When the CEO's LLM response contains `<task_plan>` or `<tool_call>` blocks, `chatService.ts` parses and dispatches them:

1. **Parse**: `parseTaskPlan(fullText)` extracts structured mission/tool-call data.
2. **Separate**: `enable_skill` calls are handled via `handleEnableSkillCall()` (creates approval + chat message with metadata). Regular skill calls become missions.
3. **Dispatch**: `dispatchTaskPlan(missions, model, context)` creates `task_executions` rows, assigns agents, and runs skills via `skillExecutor.ts`.
4. **Context**: The dispatch includes `conversationExcerpt` (recent messages) and `founderPresent: true` flag so quick tasks auto-complete inline.

### Stuck Task Recovery

The decision engine's `checkStuckTasks()` handles tasks stuck in `pending`/`running` for over 5 minutes:
- Marks them as `failed` with an error message.
- If all sibling tasks for a mission are now terminal, moves the mission to `review` status.
- Posts a chat message to the active conversation with action buttons (`LOOKS GOOD`, `REVIEW MISSION`, `VIEW COLLATERAL`).
- For multi-task missions with 2+ completed tasks, triggers `synthesizeMissionSummary()`.
- Dispatches `missions-changed` and `task-executions-changed` events for UI refresh.

---

## Notification System

### Navigation Rail Badges

| Badge | Tab | Source | Event |
|-------|-----|--------|-------|
| Pending approvals count | Approvals | `getPendingApprovalCount()` | `approvals-changed` + 5s poll |
| Missions in review count | Missions | `getMissionReviewCount()` | `missions-changed` + 5s poll |
| New collateral items | Collateral | `getNewCollateralCount()` | `task-executions-changed` + 5s poll |
| Unread conversations | Chat | `getUnreadConversationCount()` | `chat-messages-changed` + `chat-read` + 8s poll |

### CEO Status Pip

The NavigationRail displays a small colored dot with the CEO's initial:

| Status | Color | Meaning |
|--------|-------|---------|
| `nominal` | Emerald | CEO is idle |
| `thinking` | Yellow | CEO is processing |
| `error` | Red | Something went wrong |

---

## Aspirational Features (Not Yet Built)

These are part of the original vision but have no implementation:

### CEO-Initiated Conversations
The CEO would detect situations requiring founder input and proactively post messages like "Hey {FOUNDER}, we need to chat!" with an `attention_request` type. The NavigationRail would show a special badge and/or the CEO status pip would pulse red. Currently, the CEO only responds to founder messages.

### Rich Action Cards
Inline interactive cards in chat for hire recommendations, budget warnings, task reports, and mission updates — each with approve/decline/modify buttons. Currently only skill-approval cards exist (via `metadata.type = 'skill_approval'`).

### Budget Threshold Warnings
Proactive alerts when token spend approaches daily/monthly limits. The budget is tracked in `llm_usage` and enforced (LLM calls are blocked when exceeded), but there are no proactive warnings to the founder.

### Cross-Tab / Cross-Device
Option E (Edge Function + pg_cron) would allow the CEO to evaluate and act even when no browser tab is open. Supabase Realtime would push notifications to all connected clients. Currently limited to the active browser tab.

---

## Key Files

| File | Role |
|------|------|
| `src/lib/ceoScheduler.ts` | CEOScheduler class — visibility-aware setInterval, state persistence |
| `src/lib/ceoDecisionEngine.ts` | `evaluateCycle()` — 6 heuristic checks, action queue insertion, stuck task recovery, skill sync |
| `src/lib/ceoActionQueue.ts` | Action queue CRUD — `queueCEOAction`, `loadPendingActions`, `markActionSeen`, `dismissAction` |
| `src/lib/llm/chatService.ts` | `streamCEOResponse()`, `buildCEOSystemPrompt()`, `isLLMAvailable()`, `handleEnableSkillCall()` |
| `src/lib/taskDispatcher.ts` | `parseTaskPlan()`, `dispatchTaskPlan()`, `synthesizeMissionSummary()` |
| `src/lib/memory.ts` | `getMemories()` — feeds founder profile + org memories into system prompt |
| `src/lib/database.ts` | All DB functions: conversations, chat_messages, agents, missions, approvals, etc. |
| `src/hooks/useRealtimeSubscriptions.ts` | Supabase Realtime on 7 tables including `chat_messages` and `ceo_action_queue` |
| `src/components/Chat/ChatView.tsx` | Main chat page — onboarding router + conversation management |
| `src/components/Chat/ChatSidebar.tsx` | Conversation list with new/archive |
| `src/components/Chat/ChatThread.tsx` | Message rendering with streaming |
| `src/components/Chat/ToolCallBlock.tsx` | Tool call results + action buttons |
| `src/components/Chat/RichResultCard.tsx` | Formatted skill execution results |
| `src/components/Chat/OnboardingFlow.tsx` | Scripted first-run CEO meeting |
| `src/components/Surveillance/QuickChatPanel.tsx` | Compact chat overlay on Surveillance page |
| `src/components/Missions/MissionDetailPage.tsx` | Mission review with task results |
| `src/components/Layout/NavigationRail.tsx` | Badge counts (approvals, missions, collateral, unread chat), CEO status pip |
| `AI/CEO-Agent-System.md` | Full technical architecture (scheduler options, decision engine, personality) |
| `AI/Chat-Onboarding-Flow.md` | Scripted onboarding conversation |
| `AI/Approval-System.md` | Approval types and lifecycle |
