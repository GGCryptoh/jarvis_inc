# Skill Execution Pipeline, Notifications & Financials

## Overview

When the CEO decides to use skills (research, code generation, analysis, etc.), tool calls are intercepted from the LLM response, grouped into missions, and dispatched to a Supabase Edge Function for background execution. Results flow back via Realtime subscriptions, updating chat cards, nav badges, and toast notifications. A new Collateral page provides a browsable archive of all outputs. Financials switches from dummy data to real LLM + channel cost tracking.

---

## 1. Task Grouping & Dispatch

The CEO's system prompt instructs it to emit `<task_plan>` blocks that group related tool calls into missions:

```json
{
  "missions": [
    {
      "title": "Market research on AI competitors",
      "tool_calls": [
        {"name": "research-web", "arguments": {"search_query": "..."}},
        {"name": "research-web", "arguments": {"search_query": "..."}}
      ]
    },
    {
      "title": "Current weather check",
      "tool_calls": [
        {"name": "research-web", "arguments": {"search_query": "weather today"}}
      ]
    }
  ]
}
```

**Grouping rules (CEO decides):**
- Related outputs that feed one deliverable → one mission, multiple tool calls
- Unrelated requests → separate missions
- Single `<tool_call>` without `<task_plan>` → one mission, one task (backward compat)

**Chat parser flow:**
1. Parse `<task_plan>` or `<tool_call>` blocks from CEO response
2. Per mission group: create `missions` row (status: `in_progress`)
3. Per tool call: create `task_executions` row (status: `pending`, linked to mission)
4. Show retro mission card in chat with progress states
5. POST to `/functions/v1/execute-skill` for each task

---

## 2. Edge Function — `execute-skill`

**Location:** `docker/supabase/functions/execute-skill/index.ts`

**Contract:**
```
POST /functions/v1/execute-skill
Body: { task_execution_id }
Auth: anon key (edge function uses service_role internally)
```

Browser sends only the `task_execution_id`. Edge function reads everything from DB:
- Skill definition from `skills` table
- Model + provider from task_execution row
- API key from `vault` table (by service name)

**Execution flow:**
1. Update `task_executions.status` → `running`
2. Resolve skill definition from DB
3. Fetch API key from vault by service
4. Build prompt from skill command template + params
5. Call LLM provider (Anthropic/OpenAI/Google/DeepSeek/xAI)
6. Write result to `task_executions.result` JSONB
7. Update `task_executions.status` → `completed`
8. Log to `llm_usage` (with mission_id, agent_id)
9. Log to `audit_log`
10. Check: all tasks for this mission complete?
    - YES → `missions.status` → `review`
    - NO → wait for remaining
11. Post CEO summary message to `chat_messages`

**Error handling:**
- Provider error → `status = 'failed'`, error in result JSONB
- Any task fails → mission stays `in_progress`, failed task gets retry
- Timeout: 5 minute max per execution (configurable per skill)

**LLM providers in edge function:**
Standalone Deno-compatible HTTP + SSE parsing. Same logic as browser providers but no browser dependencies. ~200 lines covering all 5 providers.

---

## 3. Realtime Subscriptions & Notifications

**Browser subscriptions (mounted in AppLayout):**
- `task_executions` (INSERT, UPDATE) → update chat cards, trigger toast
- `missions` (UPDATE where status = 'review') → update nav badge
- `chat_messages` (INSERT where sender = 'ceo') → show in chat, trigger toast if not on /chat

**Toast notification system:**
- Retro-styled popup (bottom-right, pixel font, cyan/green border)
- "CEO NEO: Research complete — Market analysis ready for review"
- Auto-dismiss 8s, click to navigate to mission
- Stacks if multiple arrive

**Missions nav badge:**
- Green circle with white count on Missions icon in NavigationRail
- Count = missions where `status = 'review'`
- Same pattern as existing approval badge

**Chat card states:**
- `pending` — Cyan border, "QUEUED" label, pulsing dot
- `running` — Cyan border, "EXECUTING..." label, animated spinner
- `completed` — Green border, "COMPLETE" label, checkmark, output preview
- `failed` — Red border, "FAILED" label, error message, retry button

---

## 4. Mission Review Flow

Click a `review` status mission → expanded detail view:
- Mission title & context
- Each task_execution output (collapsible, rendered markdown)
- Total cost (sum of task costs)
- Duration
- Actions: APPROVE (→ `done`) / REDO (→ `in_progress`, re-dispatch) / DISCARD (→ `done` with flag)

---

## 5. Collateral — Output & Artifact Browser

**New nav route:** `/collateral` with Archive icon

**Shows:** Every completed task_execution output — research reports, images, documents, code, analysis. Browsable across all missions.

**Card grid layout:**
- Card types by skill category: Document, Image (thumbnail), Code (language badge), Chart
- Each card: title, skill icon, timestamp, cost
- Click → full rendered markdown output, mission context, agent, model, cost, duration
- Actions: RE-RUN (re-dispatch same params), EXPORT (copy/download)

**Filters:**
- Date range: Today, This Week, This Month, All, custom
- Skill dropdown
- Mission dropdown
- Agent dropdown
- Full-text search across output content

**Data source:** `task_executions WHERE status = 'completed' AND result IS NOT NULL`

---

## 6. Financials — Real Data

**Replace dummy data with two cost sources:**
1. **LLM Usage** — `llm_usage` table (provider, model, tokens, cost, context, mission_id, agent_id)
2. **Channel Costs** — `channel_usage` table (per-notification costs)

**Stat cards (real):**
- Monthly Budget (from settings, already works)
- Total Spent (SUM llm_usage + channel_usage for current month)
- Remaining (budget - spent)
- Burn Rate (daily avg × days remaining)

**Bar chart:** Real monthly aggregates from llm_usage, budget overlay

**Breakdown table:** Month | LLM Cost | Channel Cost | Total | Budget | Variance — drillable by model, agent, mission

**Agent cost view (hover card):**
- Total spend: `llm_usage WHERE agent_id = ?`
- Tasks completed, avg cost per task
- Most used model, most used skill

**Mission cost view:**
- Total: `llm_usage WHERE mission_id = ?`
- Per-task breakdown
- Model distribution

**CEO hover card:**
- Personality/archetype, model, philosophy, status, confidence
- Cost so far: `llm_usage WHERE agent_id = 'ceo'`

---

## 7. Vault — Notification Channels

**New section below API Keys:**

**Table: `notification_channels`**
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | `channel-{type}-{timestamp}` |
| type | TEXT | `email`, `telegram`, `sms`, `voice` |
| enabled | BOOLEAN | Default false |
| config | JSONB | Type-specific connection details |
| cost_per_unit | REAL | USD per message/minute (founder-supplied) |
| created_at | TIMESTAMPTZ | |

**Table: `channel_usage`**
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | |
| channel_id | TEXT | FK to notification_channels |
| type | TEXT | Channel type |
| cost | REAL | Calculated cost for this notification |
| created_at | TIMESTAMPTZ | |

All channels start disabled with "COMING SOON" badge. Architecture in place for when adapters are implemented.

---

## 8. Schema Changes

**New migration: `005_channels_and_indexes.sql`**
- `notification_channels` table
- `channel_usage` table
- RLS policies

**Existing tables used as-is:**
- `task_executions` (migration 003) — now actively used
- `missions` — real status flow
- `llm_usage` (migration 004) — edge function writes with mission_id/agent_id
- `chat_messages` — edge function posts CEO summaries
- `audit_log` — edge function logs execution events

**Docker change:**
- Add `supabase/edge-runtime` service to docker-compose
- Mount `./supabase/functions/` directory

---

## 9. New & Modified Files

### New Files
| File | Purpose |
|------|---------|
| `docker/supabase/functions/execute-skill/index.ts` | Edge function — background skill execution |
| `docker/supabase/migrations/005_channels.sql` | notification_channels + channel_usage |
| `src/components/Collateral/CollateralView.tsx` | Artifact browser |
| `src/components/Chat/TaskPlanBlock.tsx` | Mission-grouped execution cards for chat |
| `src/hooks/useRealtimeSubscriptions.ts` | Supabase Realtime for all live tables |
| `src/components/Layout/ToastNotification.tsx` | Retro toast popup system |

### Modified Files
| File | Change |
|------|--------|
| `docker/docker-compose.yml` | Add edge-runtime service |
| `src/lib/llm/chatService.ts` | Parse `<task_plan>`, dispatch to edge function |
| `src/components/Chat/ChatThread.tsx` | Render TaskPlanBlock, subscribe to task updates |
| `src/components/Financials/FinancialsView.tsx` | Real llm_usage + channel_usage data |
| `src/components/Missions/MissionsView.tsx` | Review flow with output viewer |
| `src/components/Vault/VaultView.tsx` | Add Channels section |
| `src/components/Layout/NavigationRail.tsx` | Collateral route + Missions review badge |
| `src/components/Layout/AppLayout.tsx` | Mount Realtime + toast provider |
| `src/components/Surveillance/AgentSprite.tsx` | Cost in hover card |
| `src/components/CEOCeremony/CEOCeremony.tsx` | CEO hover card with cost |
