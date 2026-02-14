# CEO Autonomous Agent System — Design Document

> Architecture for the CEO to operate as an autonomous agent that proactively
> manages the workforce, executes skills, and communicates with the founder.

### Implementation Status (2026-02-13)

| Component | Status | File(s) |
|-----------|--------|---------|
| CEO Scheduler (Option B) | SHIPPED | `src/lib/ceoScheduler.ts` (193 lines) |
| Decision Engine | SHIPPED | `src/lib/ceoDecisionEngine.ts` (389 lines) |
| Task Dispatcher | SHIPPED | `src/lib/taskDispatcher.ts` (572 lines) |
| CEO Action Queue | SHIPPED | `src/lib/ceoActionQueue.ts` (96 lines) |
| Skill Executor | SHIPPED | `src/lib/skillExecutor.ts` (581 lines) |
| CLI Skill Handlers | SHIPPED | `src/lib/cliSkillHandlers.ts` (230 lines) |
| Chat Service (LLM streaming) | SHIPPED | `src/lib/llm/chatService.ts` (549 lines) |
| Edge Function (skill exec) | SHIPPED | `docker/supabase/functions/execute-skill/index.ts` |
| 8 Personality Archetypes | SHIPPED | Inline in `chatService.ts` |
| Supabase Realtime subscriptions | SHIPPED | Various components |
| Agent Factory (CEO auto-hire) | NOT BUILT | Founder hires manually via HireAgentModal |
| Agent Name Pool | NOT BUILT | Agent names are manual input |
| Centralized events.ts | NOT BUILT | Uses `window.dispatchEvent` + Supabase Realtime |
| Budget tracking in decision engine | NOT BUILT | Budget tracked in chatService only |
| Mid-task approval flow | NOT BUILT | Tasks run to completion or fail |
| Agent self-reporting results | NOT BUILT | Edge Function / browser fallback writes results directly |

---

## Overview

The CEO operates as a persistent autonomous agent that:
1. **Proactively monitors** — evaluates org state every 30 seconds via scheduler
2. **Dispatches tasks** — parses tool calls from LLM responses, creates missions + task executions
3. **Executes skills** — runs skills via Edge Function (server-side) with browser fallback
4. **Communicates** — queues notifications for the founder, posts results to chat
5. **Syncs skills** — periodically fetches skill definitions from GitHub repo

**Not yet implemented:**
- CEO-initiated hiring (founder hires manually)
- Budget warnings/overrides in the decision engine
- Mid-task approval pauses for agents

---

## Scheduler Architecture

### SHIPPED: Option B — Visibility-aware setInterval

**File:** `src/lib/ceoScheduler.ts`

The `CEOScheduler` class runs the decision engine on a configurable interval, pausing when the browser tab is hidden and resuming with an immediate tick when it becomes visible.

```typescript
interface SchedulerConfig {
  intervalMs: number;        // Default: 30000 (30 seconds)
  pauseWhenHidden: boolean;  // Default: true
}
```

#### Public API

| Method | Description |
|--------|-------------|
| `start()` | Begin interval, register visibility listener, write state to DB |
| `stop()` | Clear interval, remove listener, write state |
| `pause()` | Manual pause (sets status to `'paused'`) |
| `resume()` | Resume from manual pause |
| `getStatus()` | Returns `'running' | 'paused' | 'stopped'` |
| `getState()` | Returns `{ status, lastHeartbeat, lastCycleResult }` |

#### Factory function

```typescript
export function createScheduler(
  onCycle: () => Promise<Record<string, unknown>>,
  config?: Partial<SchedulerConfig>,
): CEOScheduler;
```

Mounted in `AppLayout.tsx` via `useEffect`. The `onCycle` callback is `evaluateCycle()` from the decision engine.

#### Visibility behavior

- **Tab hidden:** Clears the interval but keeps status as `'running'` (not a manual pause).
- **Tab visible again:** Re-schedules the interval AND runs one tick immediately.
- **No catch-up:** Does not batch missed cycles. One immediate tick on return is sufficient.

#### Persistence

Every tick and state change writes to the `scheduler_state` Supabase table:

```typescript
await getSupabase()
  .from('scheduler_state')
  .upsert({
    id: 'main',
    status: this.status,
    interval_ms: this.config.intervalMs,
    last_heartbeat: this.lastHeartbeat,
    last_cycle_result: this.lastCycleResult,
    config: this.config,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
```

#### Other scheduler options (not implemented)

Options A (simple setInterval), C (Web Worker), D (OS cron), and E (Supabase Edge Function + pg_cron) were evaluated. Option E remains the recommended path for true background execution when the browser is closed, but Option B is what shipped for the current client-side architecture.

---

## Decision Engine

### File: `src/lib/ceoDecisionEngine.ts`

Each scheduler tick calls `evaluateCycle()`. This is a **heuristic-only engine** — no LLM calls. The upgrade path is to replace heuristic checks with LLM-powered evaluation.

### Types

```typescript
interface CEOAction {
  id: string;
  action_type: 'hire_agent' | 'assign_mission' | 'request_approval'
             | 'send_message' | 'enable_skill';
  payload: Record<string, unknown>;
  priority: number;  // 1-10 (1 = highest)
}

interface CycleResult {
  timestamp: string;
  actions: CEOAction[];
  checks: Record<string, unknown>;
}
```

### Evaluation Steps

`evaluateCycle()` loads the full org state from Supabase, then runs these heuristic checks in order:

| # | Check | Condition | Action Produced | Priority |
|---|-------|-----------|-----------------|----------|
| 1 | **Stuck tasks** | `task_executions` in `pending`/`running` status for > 5 minutes | Auto-fails the task, moves mission to `review` if all sibling tasks are terminal, posts CEO summary to chat, synthesizes multi-task summary | N/A (direct DB write) |
| 2 | **Unassigned missions** | Active/in-progress missions with no assignee AND idle agents available | `assign_mission` action pairing mission to idle agent | 3 |
| 3 | **Idle agents** | Agents not assigned to any active mission | `send_message` with topic `idle_workforce` | 6 |
| 4 | **Stale approvals** | Pending approvals older than 24 hours | `send_message` with topic `stale_approvals` | 4 |
| 5 | **No agents hired** | Zero agents but missions exist | `send_message` with topic `no_agents` | 2 |
| 6 | **Skills gap** | Missions exist but zero skills enabled | `send_message` with topic `skills_gap` | 5 |

### Deduplication

Before inserting actions into `ceo_action_queue`, the engine checks for existing entries with the same `topic` in the payload:
- Looks at `pending`, `seen`, and `dismissed` actions created within the last 2 hours
- If a topic already exists in that window, the action is skipped
- Within the same batch, topics are also deduplicated

### Pruning

After inserting new actions, the engine deletes `dismissed` and `seen` entries older than 2 hours to keep the queue lean.

### Skill Sync

Once per hour (throttled by in-memory timestamp), calls `seedSkillsFromRepo()` to fetch skill definitions from the GitHub skills repo.

### Diagnostic Result

Every cycle returns a `CycleResult` with action count and org stats (agent count, mission count, enabled skills, pending approvals, CEO status). This is written to `scheduler_state.last_cycle_result` by the scheduler.

---

## Task Dispatcher

### File: `src/lib/taskDispatcher.ts`

Responsible for parsing CEO LLM responses into structured tasks, creating missions and task executions in the database, and dispatching them for execution.

### Parsing CEO Responses

```typescript
export function parseTaskPlan(text: string): ParsedMission[];
export function stripTaskBlocks(text: string): string;
```

**`parseTaskPlan`** extracts structured tool calls from two formats:
1. `<task_plan>` block — JSON with `{ missions: [{ title, tool_calls }] }` for multi-mission plans
2. `<tool_call>` blocks — individual JSON objects `{ name, command, arguments }`, each becoming a single mission

**`stripTaskBlocks`** removes both `<task_plan>` and `<tool_call>` blocks from text, leaving conversational content for the chat UI.

### Dispatch Flow

```typescript
export async function dispatchTaskPlan(
  missions: ParsedMission[],
  model: string,
  context?: DispatchContext,
): Promise<string[]>;  // returns mission IDs
```

For each parsed mission:

1. **Build context** — assembles founder profile memories, relevant org memories (via keyword search on mission title + arguments), and last 10 conversation messages
2. **Create mission** — inserts into `missions` table with status `'in_progress'`, assigned to CEO
3. **Create task executions** — one `task_executions` row per tool call with `skill_id`, `command_name`, `params`, `model`, and assembled `context`
4. **Dispatch to Edge Function** — `POST /functions/v1/execute-skill` with `{ task_execution_id }`
5. **Browser fallback** — if Edge Function returns non-200 or is unreachable, falls back to `executeBrowserSide()`
6. **Stale check** — if Edge Function returns 200 but task is still `pending` after 15 seconds, runs browser fallback

### Browser-Side Execution

When the Edge Function is unavailable, `executeBrowserSide()` runs the skill directly:

1. Checks for CLI handler first (`hasCLIHandler` from `cliSkillHandlers.ts`)
2. Falls back to `executeSkill()` from `skillExecutor.ts`
3. Updates `task_executions` with result
4. When all sibling tasks for a mission complete:
   - **Founder present + single task + tab visible** = auto-complete mission (status `'done'`)
   - **Otherwise** = mission goes to `'review'` status
   - Multi-task missions get an LLM-synthesized summary via `synthesizeMissionSummary()`
5. Posts CEO summary message to active conversation
6. Queues `mission_review` action via `ceoActionQueue`

### Mission Summary Synthesis

```typescript
export async function synthesizeMissionSummary(
  missionId: string,
  missionTitle: string,
): Promise<void>;
```

For missions with 2+ completed tasks, calls the CEO's LLM to create a unified executive report from all task outputs. Falls back to simple concatenation if no LLM/API key is available. The synthesized summary is stored as a special `task_executions` entry with `skill_id: 'mission-summary'`.

### DispatchContext

```typescript
interface DispatchContext {
  conversationExcerpt?: ChatMessageRow[];  // recent messages for task context
  conversationId?: string;                  // for tracing
  founderPresent?: boolean;                 // true = auto-complete quick tasks
}
```

When dispatched from live chat, `founderPresent: true` enables auto-completion of single quick tasks so the founder sees the result inline.

---

## CEO Action Queue

### File: `src/lib/ceoActionQueue.ts`

Lightweight notification system for CEO-to-founder proactive communication. Actions are produced by the decision engine and displayed as notifications in the UI.

### Types

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

### Functions

| Function | Description |
|----------|-------------|
| `queueCEOAction(type, title, message, metadata?)` | Insert a new action into `ceo_action_queue`, dispatch `ceo-actions-changed` event |
| `loadPendingActions()` | Fetch up to 10 pending actions, newest first |
| `markActionSeen(id)` | Set status to `'seen'` |
| `dismissAction(id)` | Set status to `'dismissed'` |
| `getPendingActionCount()` | Count of pending actions (used for NavigationRail badge) |

All functions fail silently if the table doesn't exist yet (graceful degradation during setup).

### UI Integration

- **NavigationRail** — shows badge count from `getPendingActionCount()`
- **Decision engine** — produces actions from heuristic checks
- **Task dispatcher** — queues `mission_review` when a mission finishes and founder isn't watching
- **Event** — `window.dispatchEvent(new Event('ceo-actions-changed'))` triggers UI refresh

---

## Skill Executor

### File: `src/lib/skillExecutor.ts`

Browser-side skill execution engine. Routes skills to the correct execution path based on connection type.

### Execution routing

```
executeSkill(skillId, commandName, params, options)
  │
  ├─ connection_type = 'cli'
  │    └─ executeCLISkill() → HTTP-based handlers (weather, DNS, WHOIS)
  │
  ├─ execution_handler exists in API_HANDLERS registry
  │    ├─ 'openai_image_generation'  → DALL-E 3 via OpenAI API
  │    └─ 'gemini_image_generation'  → Gemini Flash image generation
  │
  └─ default (LLM skill)
       └─ Build prompt → get provider + API key → stream LLM → collect result
```

### CLI Skill Handlers (`cliSkillHandlers.ts`)

Skills with `connection_type: 'cli'` that wrap public HTTP APIs execute directly from the browser via `fetch()`. No LLM or API key required.

| Skill ID | Handler | Commands |
|----------|---------|----------|
| `weather-cli` | wttr.in JSON API | `get_forecast`, `get_current`, `get_moon_phase` |
| `whois-lookup` | rdap.org | `domain_lookup`, `ip_lookup` |
| `dns-lookup` | Cloudflare DoH | `query`, `full_report` |

### API Handlers

Direct API call skills (no LLM reasoning):

| Handler Key | Skill | API |
|-------------|-------|-----|
| `openai_image_generation` | create-images (OpenAI) | OpenAI Images API (DALL-E 3) |
| `gemini_image_generation` | create-images (Gemini) | Google Gemini Flash image generation |

### LLM Skills

For skills without a CLI or API handler:
1. Resolve skill definition via `skillResolver`
2. Build prompt from `prompt_template` (with `{param}` interpolation) or generic prompt
3. Look up provider and API key via `MODEL_SERVICE_MAP` and vault
4. Stream LLM response, collect into final result
5. Log to `llm_usage` table and `audit_log`

---

## Edge Function: execute-skill

### File: `docker/supabase/functions/execute-skill/index.ts`

Deno-based Supabase Edge Function for server-side skill execution. Accepts `{ task_execution_id }` via POST.

### Execution flow

1. Load `task_executions` row from Supabase
2. Mark task as `running`
3. Load skill definition from `skills` table
4. Route by `connection_type`:
   - **`cli`** — CLI-over-HTTP handlers (weather via wttr.in)
   - **`api_key`** — Direct API calls (image generation via OpenAI/Gemini)
   - **`llm`** (default) — Build prompt, call LLM provider, collect response
5. Update `task_executions` with result, cost, tokens
6. Log to `llm_usage` and `audit_log`
7. Check if all sibling tasks are complete — if so, move mission to `review`
8. Post CEO summary to active conversation in `chat_messages`
9. On failure: mark task as `failed`, write error

### Multi-provider support

| Provider | Endpoint | Call Style |
|----------|----------|------------|
| Anthropic | `api.anthropic.com/v1/messages` | Anthropic-native (x-api-key header) |
| OpenAI | `api.openai.com/v1/chat/completions` | OpenAI-compatible |
| Google | `generativelanguage.googleapis.com/v1beta` | Google-native |
| DeepSeek | `api.deepseek.com/v1/chat/completions` | OpenAI-compatible |
| xAI | `api.x.ai/v1/chat/completions` | OpenAI-compatible |

---

## CEO Personality System

Personality is implemented **inline in `chatService.ts`** (not as a separate `ceoPersonality.ts` file). The CEO's `archetype`, `philosophy`, and `risk_tolerance` from the `ceo` table are injected into the system prompt.

### 8 Archetype Personas

Each archetype defines a communication style block inserted into the system prompt:

| Archetype Key | Style |
|---------------|-------|
| `wharton_mba` | Management consultant — frameworks, ROI, executive summaries |
| `wall_street` | Wall Street trader — direct, numbers-focused, zero fluff |
| `mit_engineer` | Systems engineer — architectures, trade-offs, probabilistic reasoning |
| `sv_founder` | Startup CEO — think big, ship fast, product-market fit |
| `beach_bum` | Laid-back wisdom — casual, sustainable pace, perspective |
| `military_cmd` | Military precision — SitRep updates, mission-focused |
| `creative_dir` | Creative sensibility — craft, quality, visual language |
| `professor` | Academic rigor — evidence, reasoning, structured arguments |

### Philosophy Operating Styles

4 built-in philosophies + custom fallback:

| Philosophy | Speed vs Quality | Failure Tolerance | Communication Style |
|-----------|------------------|-------------------|---------------------|
| Move fast, break things | Speed over perfection | High | Brief, action-oriented |
| Steady and methodical | Quality over speed | Low | Detailed, structured |
| Data-driven optimization | Data decides | Medium | Quantitative, evidence-cited |
| Innovation at all costs | Creativity first | High | Enthusiastic, visionary |

### Risk Profiles

| Risk Level | Approval Threshold | Budget Warning | Parallelism |
|------------|-------------------|----------------|-------------|
| Conservative | Always seek founder approval | 60% daily | Sequential missions |
| Moderate | Auto-approve under $0.10 | 80% daily | 2-3 concurrent |
| Aggressive | Auto-approve under $1.00 | 95% daily | Maximum parallel |

---

## Chat Integration

### File: `src/lib/llm/chatService.ts`

The chat service connects the CEO's personality, organizational state, and LLM capabilities into real-time streaming conversations.

### System Prompt Structure (13 sections)

The `buildCEOSystemPrompt()` function assembles:

1. **Identity** — CEO name, org name, founder name, primary mission, today's date
2. **Archetype persona** — communication style block from `ARCHETYPE_PERSONAS`
3. **Philosophy** — operating style from `PHILOSOPHY_BLOCKS`
4. **Risk profile** — autonomy thresholds from `RISK_BLOCKS`
5. **Founder Soul** — `founder_profile` category memories (always included)
6. **Org Memory** — top 20 general memories by importance (from `org_memory` table)
7. **Workforce** — agent list with names, roles, models
8. **Enabled Skills** — full command definitions with parameter requirements (resolved from GitHub repo)
9. **Disabled Skills** — names + descriptions only (for suggesting enablement)
10. **Active Missions** — title, status, assignee, priority
11. **Budget & Spend** — monthly budget, current spend, remaining (from `llm_usage` table)
12. **Tool Usage Rules** — decision flow (answer vs skill vs mission), parameter checking, `<task_plan>` XML format, `enable_skill` tool call format
13. **Critical Rules** — respond naturally, never fabricate, keep concise

### Streaming Flow

```typescript
export async function streamCEOResponse(
  userText: string,
  conversationHistory: ChatMessageRow[],
  callbacks: StreamCallbacks,
): Promise<AbortController | null>;
```

1. Check LLM availability (CEO model + vault key + budget)
2. Build system prompt
3. Assemble message array: system prompt + last 20 conversation messages + current user message
4. Stream via provider (Anthropic, OpenAI, Google, DeepSeek, xAI)
5. On completion:
   - Log usage to `llm_usage` and `audit_log`
   - Parse response for `<task_plan>` / `<tool_call>` blocks
   - Separate `enable_skill` calls (create approval cards) from regular skill calls
   - Dispatch regular skill calls via `dispatchTaskPlan()` with `founderPresent: true`

### Skill Enablement from Chat

When the CEO suggests enabling a disabled skill and the founder agrees, the CEO emits:
```xml
<tool_call>{"name":"enable_skill","arguments":{"skill_id":"...","skill_name":"..."}}</tool_call>
```

`handleEnableSkillCall()` then:
1. Creates a `skill_enable` approval in the `approvals` table
2. Posts a chat message with approval card metadata for the UI to render
3. Dispatches `approvals-changed` event for cross-component sync

---

## Event System

Events use `window.dispatchEvent()` with simple `Event` objects (no centralized `events.ts` file). Supabase Realtime subscriptions provide server-to-client updates.

### Window Events (browser-side)

| Event Name | Dispatched By | Consumed By |
|-----------|---------------|-------------|
| `approvals-changed` | chatService, ApprovalsView | NavigationRail (badge count) |
| `chat-messages-changed` | taskDispatcher, ceoDecisionEngine | ChatView (message list) |
| `missions-changed` | taskDispatcher, ceoDecisionEngine | MissionsView, DashboardView |
| `task-executions-changed` | taskDispatcher, ceoDecisionEngine | MissionDetailPage, CollateralView |
| `ceo-actions-changed` | ceoActionQueue | NavigationRail (notification badge) |

### Supabase Realtime

Components subscribe to Postgres changes on relevant tables for live updates from the Edge Function and other sources.

---

## Skill Assignment Model

Skills are **NOT** globally available to all agents. The CEO controls which tools each agent can use.

### Current Flow

1. **Founder enables skills org-wide** via the Skills page
2. **CEO checks enabled skills** in its system prompt (full command definitions included)
3. **CEO suggests enabling disabled skills** if a conversation suggests one would help
4. **CEO dispatches skill calls** via `<task_plan>` blocks in LLM responses
5. **Tasks execute** via Edge Function or browser fallback using the specified skill

### Agent Skills Table

```sql
CREATE TABLE IF NOT EXISTS public.agent_skills (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  skill_id    TEXT NOT NULL,
  assigned_by TEXT NOT NULL DEFAULT 'ceo',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, skill_id)
);
```

**Note:** This table exists in the schema but is not yet used in the application logic. Currently, all skill execution is done by the CEO directly. Agent-level skill assignment will be implemented alongside the agent factory.

---

## Agent Creation Pipeline — NOT YET BUILT

The CEO does not auto-hire agents. Agents are created manually by the founder via `HireAgentModal` in the Surveillance view.

### Planned Components

| Component | Status | Purpose |
|-----------|--------|---------|
| `agentFactory.ts` | Not built | Generate agent configs (name, role, model, skills, system prompt) |
| `agentNamePool.ts` | Not built | Thematic callsign pools by role category |
| CEO-initiated hire flow | Not built | CEO proposes hire -> approval -> ceremony |

### Planned Flow (design only)

1. CEO evaluates workforce gap (decision engine detects unassigned missions with no suitable agent)
2. CEO generates agent config via agent factory
3. CEO creates `hire_agent` action in queue + approval entry
4. CEO posts hire card in chat with [APPROVE] [MODIFY] [DECLINE] buttons
5. Founder approves -> `saveAgent()`, trigger surveillance hire ceremony
6. Founder modifies -> open HireAgentModal with pre-filled config
7. Founder declines -> CEO handles task itself

---

## Database Schema

### Core Tables (001_initial_schema.sql)

| Table | Purpose |
|-------|---------|
| `settings` | Key-value config store |
| `agents` | Agent roster (name, role, color, skin_tone, model, desk position) |
| `ceo` | CEO config (name, model, philosophy, risk_tolerance, archetype, status) |
| `missions` | Mission board (title, status, assignee, priority, due_date, recurring, created_by) |
| `audit_log` | Append-only event log (agent, action, details, severity) |
| `vault` | API keys and credentials (name, type, service, key_value) |
| `approvals` | Approval queue (type, title, description, status, metadata) |
| `skills` | Skill registry (enabled, model, definition, category, status, source) |
| `conversations` | Chat conversation threads (title, type, status) |
| `chat_messages` | Individual messages (conversation_id, sender, text, metadata) |

### Autonomy Tables (003_memory_and_autonomy.sql)

| Table | Purpose |
|-------|---------|
| `org_memory` | Organizational memory (category, content, tags, importance, embedding vector) |
| `conversation_summaries` | Compressed old conversation chunks |
| `mission_memory` | Learnings tied to specific missions |
| `agent_skills` | CEO assigns specific skills to specific agents |
| `scheduler_state` | Scheduler heartbeat + config (id, status, interval_ms, last_heartbeat, last_cycle_result) |
| `ceo_action_queue` | Actions from decision engine (action_type, payload, status, priority) |
| `task_executions` | Task work tracking (mission_id, agent_id, skill_id, command_name, params, model, context, conversation, result, tokens_used, cost_usd) |
| `agent_stats` | Agent performance for rank/promotion system |

### CEO Extensions (003 + 007)

```sql
ALTER TABLE ceo ADD COLUMN IF NOT EXISTS backup_model TEXT DEFAULT NULL;
ALTER TABLE ceo ADD COLUMN IF NOT EXISTS primary_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ceo ADD COLUMN IF NOT EXISTS last_primary_check TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE ceo ADD COLUMN IF NOT EXISTS fallback_active BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ceo ADD COLUMN IF NOT EXISTS suit_color TEXT DEFAULT NULL;
ALTER TABLE ceo ADD COLUMN IF NOT EXISTS skin_tone TEXT DEFAULT NULL;
```

### Task Execution Extensions (006)

```sql
ALTER TABLE task_executions
  ADD COLUMN IF NOT EXISTS command_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS params JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS model TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS context JSONB DEFAULT '{}';
```

The `agent_id` FK was dropped so CEO tasks (`agent_id='ceo'`) work, since the CEO lives in the `ceo` table, not `agents`.

### Approval Types

The `approvals.type` column is TEXT, supporting these values:
- `skill_enable` — CEO recommends enabling a skill (SHIPPED)
- `api_key_request` — Agent/CEO needs an API key (SHIPPED)
- `hire_agent` — CEO wants to hire an agent (NOT YET USED)
- `agent_action` — Agent needs mid-task permission (NOT YET USED)

---

## File Summary

### Shipped Files

| File | Purpose |
|------|---------|
| `src/lib/ceoScheduler.ts` | Visibility-aware interval scheduler |
| `src/lib/ceoDecisionEngine.ts` | Heuristic state evaluation, action production |
| `src/lib/taskDispatcher.ts` | Parse CEO responses, create missions/tasks, dispatch to Edge Function |
| `src/lib/ceoActionQueue.ts` | Notification queue for CEO-to-founder communication |
| `src/lib/skillExecutor.ts` | Browser-side skill execution (CLI, API, LLM) |
| `src/lib/cliSkillHandlers.ts` | HTTP handlers for CLI-type skills (weather, DNS, WHOIS) |
| `src/lib/llm/chatService.ts` | LLM streaming, system prompt builder, tool call dispatch |
| `src/lib/skillResolver.ts` | Resolve skill definitions from GitHub repo + DB |
| `src/lib/memory.ts` | Organizational memory CRUD + personality-aware extraction |
| `docker/supabase/functions/execute-skill/index.ts` | Server-side skill execution Edge Function |

### Planned Files (not yet created)

| File | Purpose |
|------|---------|
| `src/lib/agentFactory.ts` | Agent config generation + skill assignment |
| `src/data/agentNamePool.ts` | Thematic callsign pools |
| `src/lib/events.ts` | Centralized event names + dispatch utilities (currently inline) |

---

## Future Work

1. **Agent Factory** — CEO generates agent configs, proposes hires, assigns skills per agent
2. **Budget in Decision Engine** — track spend thresholds, produce budget warning actions
3. **Mid-Task Approvals** — agents pause execution, save conversation, await founder permission
4. **Agent Task Execution** — agents run tasks independently (not just CEO self-execution)
5. **Option E Scheduler** — Supabase Edge Function + pg_cron for background execution when browser is closed
6. **LLM-Powered Decision Engine** — replace heuristic checks with CEO LLM evaluation of org state
