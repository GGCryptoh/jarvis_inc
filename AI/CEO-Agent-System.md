# CEO Autonomous Agent System — Design Document

> Committed project documentation. Defines the architecture for the CEO to operate
> as an autonomous agent that proactively manages the workforce, executes skills,
> and communicates with the founder.

---

## Overview

The CEO transitions from a one-time onboarding script to a persistent autonomous agent that:
1. **Proactively chats** — initiates conversations based on system state
2. **Recommends hires** — analyzes workload, proposes new agents with full configs
3. **Executes skills** — runs tasks directly when no specialist agent exists
4. **Manages budget** — tracks token spend, warns on thresholds, requests overrides
5. **Handles decline gracefully** — "No problem. I'll handle this myself for now."

---

## Scheduler Architecture

### Option A: Simple setInterval

**How**: `setInterval(evaluateCycle, 30000)` inside a React hook mounted in AppLayout.

**Setup**:
```typescript
// src/hooks/useCEOScheduler.ts
export function useCEOScheduler(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => evaluateCycle(), 30000);
    return () => clearInterval(id);
  }, [enabled]);
}
```
- Store `intervalMs` in settings table for user-configurable frequency
- Hook returns `{ isRunning, lastHeartbeat, pause, resume }`

| Pros | Cons |
|------|------|
| Simplest to implement (~10 lines) | Chrome throttles background tabs to 1 tick/min |
| No external dependencies | Timer drifts over long periods |
| Works immediately | No awareness of tab visibility (wastes cycles) |
| Easy to debug | Missed cycles are simply lost |

---

### Option B: Visibility API-aware setInterval

**How**: `setInterval` + `document.addEventListener('visibilitychange', ...)`. Pauses when tab hidden. On return, calculates missed cycles and runs up to `maxCatchUpCycles` (default 3).

**Setup**:
```typescript
// src/lib/ceoScheduler.ts
interface SchedulerConfig {
  intervalMs: number;        // Default: 30000 (30 seconds)
  pauseWhenHidden: boolean;  // Default: true
  catchUpOnReturn: boolean;  // Default: true
  maxCatchUpCycles: number;  // Default: 3
}

class CEOScheduler {
  private intervalId: number | null = null;
  private hiddenAt: number | null = null;
  private cycleCount = 0;

  start() {
    this.intervalId = setInterval(() => this.tick(), this.config.intervalMs);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private onVisibilityChange = () => {
    if (document.hidden) {
      this.hiddenAt = Date.now();
      if (this.config.pauseWhenHidden) clearInterval(this.intervalId!);
    } else {
      if (this.hiddenAt && this.config.catchUpOnReturn) {
        const elapsed = Date.now() - this.hiddenAt;
        const missed = Math.floor(elapsed / this.config.intervalMs);
        const catchUp = Math.min(missed, this.config.maxCatchUpCycles);
        for (let i = 0; i < catchUp; i++) this.tick();
      }
      this.hiddenAt = null;
      this.intervalId = setInterval(() => this.tick(), this.config.intervalMs);
    }
  };

  private tick() {
    this.cycleCount++;
    evaluateCycle();
    persistSchedulerState(this.cycleCount);
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }
}
```

- Persist `last_run`, `cycle_count`, `is_running` to `scheduler_state` table
- Mount via `useCEOScheduler` hook in `AppLayout.tsx`

| Pros | Cons |
|------|------|
| No wasted cycles when tab hidden | Catch-up logic adds ~20 lines |
| Catches up gracefully on tab return | No execution when tab is fully closed |
| Works with sql.js (main thread) | May miss evaluations during long away periods |
| Simple enough for client-side app | N/A |

**Catch-up example**: Tab hidden 5 min, interval=30s. On return: `missed=10`, runs `min(10,3)=3` evaluations, then resumes normal interval.

---

### Option C: Dedicated Web Worker

**How**: `ceo-worker.js` with its own `setInterval`. Worker sends `postMessage` to main thread for evaluation (sql.js is main-thread-only).

**Setup**:
```typescript
// src/lib/ceoWorker.ts (main thread side)
const worker = new Worker(new URL('./ceo-worker.js', import.meta.url), { type: 'module' });

worker.onmessage = (e) => {
  if (e.data.type === 'tick') {
    const result = evaluateCycle(); // runs on main thread with sql.js access
    worker.postMessage({ type: 'tick_complete', summary: result.summary });
  }
};

// public/ceo-worker.js (or Vite module worker)
let intervalId = null;
let cycleCount = 0;

self.onmessage = (e) => {
  if (e.data.type === 'start') {
    intervalId = setInterval(() => {
      cycleCount++;
      self.postMessage({ type: 'tick', cycleCount });
    }, e.data.intervalMs);
  }
  if (e.data.type === 'stop') clearInterval(intervalId);
  if (e.data.type === 'set_interval') { /* restart with new interval */ }
};
```

**Message protocol**:
```
Worker → Main: { type: 'tick', cycleCount: N }
Main → Worker: { type: 'tick_complete', summary: '...' }
Main → Worker: { type: 'pause' } / { type: 'resume' } / { type: 'set_interval', ms: N }
```

| Pros | Cons |
|------|------|
| True background execution | sql.js can't run in Worker (main-thread only) |
| Survives tab blur/minimize | All DB ops need postMessage round-trips |
| Doesn't block UI for timer logic | Separate JS file to maintain |
| More reliable timing | Complex debugging (separate thread) |
| | Vite Worker bundling edge cases |

---

### Option D: Real Cron Job (External Process)

**How**: System-level scheduled process outside the browser. Requires a backend.

**Setup variant D1 — Node.js server with node-cron**:
```typescript
// server/ceo-cron.ts
import cron from 'node-cron';
import { evaluateCycle } from './ceoDecisionEngine';

// Every 30 seconds
cron.schedule('*/30 * * * * *', async () => {
  const result = await evaluateCycle();
  // Push to frontend via WebSocket
  wss.clients.forEach(client => {
    client.send(JSON.stringify({ type: 'ceo-heartbeat', ...result }));
  });
});
```

**Setup variant D2 — OS crontab**:
```bash
# Every minute (crontab minimum granularity)
*/1 * * * * /usr/local/bin/node /opt/jarvis/ceo-evaluate.js >> /var/log/jarvis-ceo.log 2>&1
```

**Setup variant D3 — Serverless cron**:
```json
// vercel.json
{
  "crons": [{
    "path": "/api/ceo-tick",
    "schedule": "*/1 * * * *"
  }]
}
```
```json
// AWS EventBridge rule
{
  "ScheduleExpression": "rate(1 minute)",
  "Targets": [{ "Arn": "arn:aws:lambda:...:ceo-evaluate" }]
}
```

| Pros | Cons |
|------|------|
| Runs even when browser is closed | Requires backend (none exists yet) |
| True cron reliability | DB must be server-accessible (not IndexedDB) |
| Can run complex evaluations | Architecture shift from client-side |
| Scales to multi-user | Deployment complexity |
| Can trigger external notifications | Migration effort from sql.js |

**Migration path**: Pairs with TASKS.md Phase 1 (Backend Foundation). Client-side scheduler (A/B) serves as MVP until backend exists.

---

### Summary Matrix

| | A: setInterval | B: Visibility-aware | C: Web Worker | D: Real Cron |
|---|---|---|---|---|
| **Complexity** | Trivial | Low | Medium | High |
| **Backend required** | No | No | No | Yes |
| **Background tab** | Throttled | Pauses | Runs | N/A |
| **Browser closed** | No | No | No | Yes |
| **sql.js compatible** | Yes | Yes | Via messages | Needs migration |
| **Best for** | Quick MVP | Client-side prod | Niche | Multi-user server |
| **Recommended phase** | Prototype | Pre-backend | Skip | Post-backend |

---

## Decision Engine

### File: `src/lib/ceoDecisionEngine.ts`

Each scheduler tick calls `evaluateCycle()`. Runs synchronously against sql.js.

```typescript
interface CycleEvaluation {
  actions: CEOAction[];
  summary: string;
}

interface CEOAction {
  type: 'chat_message' | 'hire_recommendation' | 'mission_assignment'
      | 'skill_execution' | 'approval_request';
  payload: Record<string, unknown>;
  priority: number;           // Higher = more urgent
  requiresApproval: boolean;
}
```

### Evaluation Steps (in order)

1. **Load context**: `loadCEO()`, `getSetting('primary_mission')`, `loadAgents()`, `loadSkills()`, `loadMissions()`, `loadApprovals()`, `loadVaultEntries()`

2. **Check API key availability**: If CEO's model service has no vault key → skip (can't operate). Note missing agent keys but don't block.

3. **Check unassigned missions**: Missions with `status='backlog'` and no assignee. Match by role to idle agents. If no match → consider `hire_recommendation`.

4. **Check workforce utilization**: Count idle vs working agents. All busy + backlog growing → `hire_recommendation`. CEO doing simple tasks → recommend cheap-model agent.

5. **Check skill gaps**: Compare enabled skills vs mission requirements (reuse `recommendSkills()` logic). Missing needed skills → `chat_message` suggesting enablement.

6. **Check budget**: Compare `tokens_used_today` vs `token_budget_daily`. At 80% → warning `chat_message`. Exceeded → `approval_request` for override.

7. **Check stale approvals**: Any pending approvals older than N hours → reminder `chat_message`.

8. **Produce actions**: Insert into `ceo_action_queue`, create `approvals` entries where needed, insert `chat_messages`, dispatch events.

---

## CEO Personality System

### File: `src/lib/ceoPersonality.ts`

CEO `philosophy` and `risk_tolerance` from the `ceo` table influence decisions and messaging.

### Risk Tolerance Thresholds

| Decision | Conservative | Moderate | Aggressive |
|----------|-------------|----------|------------|
| Hire trigger (unassigned missions) | 3+ in backlog | 2+ in backlog | 1+ in backlog |
| Budget warning threshold | 60% of daily | 80% of daily | 95% of daily |
| Auto-approve skill execution | Never | Under $0.10 | Under $1.00 |
| Recommend expensive model | Never | When task is critical | Always prefer best |
| CEO self-execute vs hire | Prefers hiring | Balanced | Prefers self-execution |

### Philosophy → Message Tone

| Philosophy | Tone | Example Hire Message |
|-----------|------|---------------------|
| "Move fast, break things" | Urgent | "We need a {role} NOW. Every minute without one costs us momentum." |
| "Steady and methodical" | Measured | "I've been evaluating our workload. A {role} would strengthen our team. Here's what I'm thinking." |
| "Data-driven optimization" | Analytical | "Data shows {n} unassigned tasks in {category}. Cost analysis: hiring a {role} at {model} = ~${cost}/day vs CEO overhead of ~${ceoCost}/day." |
| "Innovation at all costs" | Bold | "I have an idea. What if we brought on a {role}? They could unlock entirely new capabilities for us." |
| Custom | Default/measured | Falls back to measured tone |

---

## Agent Creation Pipeline (CEO-Initiated)

### Agent Factory: `src/lib/agentFactory.ts`

#### Name Generation
Thematic callsign pools by role category in `src/data/agentNamePool.ts`:

```typescript
const NAME_POOLS: Record<string, string[]> = {
  research:   ['SCOUT', 'RADAR', 'PROBE', 'ATLAS', 'ORACLE', 'LENS', 'HAWK', 'TRACE'],
  code:       ['FORGE', 'BOLT', 'FLUX', 'NEXUS', 'LOGIC', 'SPARK', 'CORE', 'HELIX'],
  content:    ['QUILL', 'ECHO', 'LYRIC', 'REED', 'PRISM', 'INK', 'PROSE', 'FABLE'],
  design:     ['PIXEL', 'FRAME', 'TINT', 'HAZE', 'GLOW', 'SHADE', 'BRUSH', 'FORM'],
  security:   ['CIPHER', 'GUARD', 'AEGIS', 'SHIELD', 'VAULT', 'LOCK', 'SENTRY', 'WATCH'],
  data:       ['DELTA', 'SIGMA', 'GRAPH', 'NODE', 'VECTOR', 'INDEX', 'PULSE', 'STAT'],
  operations: ['RELAY', 'GRID', 'STACK', 'PIPE', 'LINK', 'SYNC', 'BRIDGE', 'GATE'],
  general:    ['NOVA', 'APEX', 'CREST', 'ARIA', 'ZION', 'RUNE', 'DRIFT', 'EMBER'],
};
```

Selection: pick random from pool, filtering out names already in use. Fallback: append random 2-digit number.

#### Role-to-Category Mapping
```typescript
function getRoleCategory(role: string): string {
  const lower = role.toLowerCase();
  if (/research|analyst|investigat/.test(lower)) return 'research';
  if (/code|develop|engineer|program/.test(lower)) return 'code';
  if (/write|content|copy|blog|edit/.test(lower)) return 'content';
  if (/design|art|graphic|creative|image/.test(lower)) return 'design';
  if (/security|audit|pen.?test/.test(lower)) return 'security';
  if (/data|analytics|bi|ml/.test(lower)) return 'data';
  if (/devops|ops|infra|deploy|sre/.test(lower)) return 'operations';
  return 'general';
}
```

#### Appearance Randomization
Random selection from existing palettes (10 suit colors, 6 skin tones from HireAgentModal).

#### Model Selection Strategy
```typescript
const COST_TIERS = {
  cheap:     ['Claude Haiku 4.5', 'o4-mini', 'Gemini 2.5 Flash'],
  mid:       ['Claude Sonnet 4.5', 'GPT-5.2', 'Gemini 3 Pro', 'DeepSeek R1'],
  expensive: ['Claude Opus 4.6', 'Claude Opus 4.5', 'o3-pro', 'Grok 4'],
};

// Selection based on risk_tolerance + task complexity:
// conservative: cheap for simple/moderate, mid for complex
// moderate: cheap for simple, mid for moderate, expensive for complex
// aggressive: mid for simple, expensive for moderate/complex
```

#### System Prompt Generation
CEO writes the agent's system prompt incorporating:
- Agent name and role
- Organization name and primary mission
- CEO's philosophy
- Specific responsibilities and constraints
- Communication style expectations

#### Tool-Calling Description
Short string for other agents/CEO to know what this agent does:
`"Agent SCOUT (Research Analyst). Capabilities: Research Web, Read X/Tweets. Use for information gathering and analysis tasks."`

#### User/Assistant Prompt Templates
- **User prompt**: `Task: {task_description}\nContext: {context}\nConstraints: {constraints}\nExpected output: {output_format}`
- **Assistant prompt**: `Approach: {steps}\nResults: {results}\nStatus: {status}\nTokens used: {tokens}`

### Full Hire Pipeline

1. **CEO generates config** via agentFactory functions
2. **Creates `ceo_action_queue` entry** (type: `hire_agent`, payload: full agent config)
3. **Creates `approvals` entry** (type: `hire_agent`, metadata: links to action queue)
4. **Sends chat message** with inline hire card showing:
   - Proposed name, role, model
   - Reason for hiring
   - Estimated cost
   - [APPROVE] [MODIFY] [DECLINE] buttons
5. **Dispatches events**: `ceo-wants-to-chat`, `approvals-changed`
6. **On founder approve**: `saveAgent()`, dispatch `agent-hired`, trigger surveillance hire ceremony
7. **On founder modify**: Open HireAgentModal with CEO's config pre-filled, user changes what they want
8. **On founder decline**: CEO says "No problem. I'll handle this myself for now." → marks self as task executor

---

## CEO Self-Execution

### File: `src/lib/ceoExecutor.ts`

When no specialist agent exists and CEO has the required API key, CEO executes skills directly.

```typescript
const SERVICE_ENDPOINTS: Record<string, string> = {
  'Anthropic': 'https://api.anthropic.com/v1/messages',
  'OpenAI':    'https://api.openai.com/v1/chat/completions',
  'Google':    'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
  'DeepSeek':  'https://api.deepseek.com/v1/chat/completions',
  'xAI':       'https://api.x.ai/v1/chat/completions',
};

async function executeCEOSkill(skillId, input, ceoModel, apiKey): Promise<{
  success: boolean;
  result: string;
  tokensUsed: number;
  cost: number;
}>
```

After each execution, update CEO token counters (`tokens_used_today`, `cost_today`, etc.).

**CORS note**: Anthropic API supports browser CORS. OpenAI may need a proxy. For MVP, prioritize Anthropic-powered skills.

---

## Chat Integration

### Persistent Messages
Replace ephemeral React state with `chat_messages` DB table. New hook:

```typescript
// src/hooks/useChatMessages.ts
function useChatMessages(): {
  messages: ChatMessageRow[];
  addMessage: (msg: Omit<ChatMessageRow, 'created_at'>) => void;
  unreadCount: number;
  markRead: () => void;
}
```

### Proactive Message Flow
1. Decision engine inserts message into `chat_messages` table
2. Dispatches `ceo-wants-to-chat` custom event
3. NavigationRail shows badge on Chat nav item (same pattern as Approvals badge)
4. ChatView listens for event, appends message to view
5. PostMeetingChat component replaced with full interactive `ActiveChat`

### Action Cards in Chat
Extended message types for rich inline content:
- **Hire card**: Agent preview + approve/modify/decline buttons
- **Budget warning**: Current spend vs limit + acknowledge button
- **Skill suggestion**: Missing skills + enable/skip buttons
- **Mission report**: Task completion summary + artifacts link

---

## Event System

### File: `src/lib/events.ts`

Centralized event names and dispatch/listen utilities:

```typescript
export const EVENTS = {
  APPROVALS_CHANGED:   'approvals-changed',
  CEO_WANTS_TO_CHAT:   'ceo-wants-to-chat',
  AGENT_HIRED:         'agent-hired',
  MISSION_ASSIGNED:    'mission-assigned',
  SKILL_EXECUTED:      'skill-executed',
  CEO_HEARTBEAT:       'ceo-heartbeat',
  CEO_STATUS_CHANGED:  'ceo-status-changed',
} as const;

export function dispatch(event: string, detail?: Record<string, unknown>): void;
export function listen(event: string, handler: EventHandler): () => void; // returns cleanup fn
```

| Event | Detail | From | To |
|-------|--------|------|-----|
| `ceo-wants-to-chat` | {text, actionType} | DecisionEngine | NavigationRail, ChatView |
| `agent-hired` | {agentId, agentName, hiredBy} | SurveillanceView, ApprovalsView | DecisionEngine, Dashboard |
| `mission-assigned` | {missionId, assigneeId} | DecisionEngine | MissionsView, Surveillance |
| `skill-executed` | {skillId, executor, tokens, cost} | Executor | Financials, Audit |
| `ceo-heartbeat` | {cycleCount, summary} | Scheduler | NavigationRail (CEO pip) |
| `ceo-status-changed` | {status} | DecisionEngine | NavigationRail |

---

## Database Schema Extensions

### Modified: `agents` table
```sql
ALTER TABLE agents ADD COLUMN system_prompt TEXT DEFAULT NULL;
ALTER TABLE agents ADD COLUMN description TEXT DEFAULT NULL;
ALTER TABLE agents ADD COLUMN user_prompt_template TEXT DEFAULT NULL;
ALTER TABLE agents ADD COLUMN assistant_prompt_template TEXT DEFAULT NULL;
ALTER TABLE agents ADD COLUMN hired_by TEXT DEFAULT 'founder';
ALTER TABLE agents ADD COLUMN hired_at TEXT DEFAULT NULL;
ALTER TABLE agents ADD COLUMN tasks_assigned INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN tasks_completed INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN tokens_used INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN cost_total REAL DEFAULT 0.0;
ALTER TABLE agents ADD COLUMN current_task_id TEXT DEFAULT NULL;
```

### Modified: `ceo` table
```sql
ALTER TABLE ceo ADD COLUMN token_budget_daily INTEGER DEFAULT 100000;
ALTER TABLE ceo ADD COLUMN token_budget_monthly INTEGER DEFAULT 2000000;
ALTER TABLE ceo ADD COLUMN tokens_used_today INTEGER DEFAULT 0;
ALTER TABLE ceo ADD COLUMN tokens_used_month INTEGER DEFAULT 0;
ALTER TABLE ceo ADD COLUMN cost_today REAL DEFAULT 0.0;
ALTER TABLE ceo ADD COLUMN cost_month REAL DEFAULT 0.0;
ALTER TABLE ceo ADD COLUMN last_heartbeat TEXT DEFAULT NULL;
ALTER TABLE ceo ADD COLUMN autonomous_mode INTEGER DEFAULT 1;
```

### New: `chat_messages`
```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id         TEXT PRIMARY KEY,
  sender     TEXT NOT NULL,           -- 'ceo' | 'user' | 'system'
  text       TEXT NOT NULL,
  metadata   TEXT DEFAULT NULL,       -- JSON: { skillCard, actionCard, type }
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### New: `ceo_action_queue`
```sql
CREATE TABLE IF NOT EXISTS ceo_action_queue (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL,    -- 'hire_agent' | 'assign_mission' | 'execute_skill' | 'suggest' | 'report'
  status            TEXT NOT NULL DEFAULT 'pending',
  payload           TEXT NOT NULL,    -- JSON blob
  priority          INTEGER DEFAULT 0,
  requires_approval INTEGER DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at       TEXT DEFAULT NULL
);
```

### New: `scheduler_state`
```sql
CREATE TABLE IF NOT EXISTS scheduler_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Extended approval types
No schema change needed — `type` column is already TEXT. New values:
- `hire_agent` — CEO wants to hire an agent
- `budget_override` — CEO wants to exceed budget
- `execute_skill` — CEO wants to run an expensive skill

---

## New Files Summary

| File | Purpose |
|------|---------|
| `src/lib/ceoScheduler.ts` | Scheduler class (visibility-aware or chosen option) |
| `src/lib/ceoDecisionEngine.ts` | CEO brain — state evaluation → action production |
| `src/lib/ceoExecutor.ts` | Direct skill execution via LLM API fetch() |
| `src/lib/ceoPersonality.ts` | Tone/threshold modifiers |
| `src/lib/agentFactory.ts` | Agent config generation |
| `src/lib/events.ts` | Centralized custom events |
| `src/data/agentNamePool.ts` | Thematic callsign pools |
| `src/hooks/useCEOScheduler.ts` | React hook for scheduler lifecycle |
| `src/hooks/useChatMessages.ts` | Persistent chat messages |

## Modified Files

| File | Changes |
|------|---------|
| `src/lib/database.ts` | Schema migrations, CRUD for chat_messages, ceo_action_queue, scheduler_state, extended columns |
| `src/types/index.ts` | Extended Agent, new CEOAction, SchedulerState, ChatMessageRow types |
| `src/components/Chat/ChatView.tsx` | Replace PostMeetingChat with ActiveChat, action cards, DB persistence |
| `src/components/Layout/AppLayout.tsx` | Mount useCEOScheduler hook |
| `src/components/Layout/NavigationRail.tsx` | Chat badge, CEO status from heartbeat |
| `src/components/Approvals/ApprovalsView.tsx` | Handle hire_agent approval type |
| `src/components/Surveillance/SurveillanceView.tsx` | Listen for agent-hired events |
| `src/components/Surveillance/HireAgentModal.tsx` | Extended AgentConfig with new fields |

---

## Implementation Phases

1. **Foundation**: DB migrations, events.ts, types, agentNamePool
2. **Agent Factory**: agentFactory.ts, ceoPersonality.ts, extended HireAgentModal
3. **Scheduler**: ceoScheduler.ts, useCEOScheduler hook, mount in AppLayout
4. **Decision Engine**: ceoDecisionEngine.ts, evaluateCycle(), action pipeline
5. **Chat Integration**: useChatMessages, ActiveChat component, action cards, chat badge
6. **Approvals Extension**: hire_agent type in ApprovalsView, agent preview/edit
7. **CEO Self-Execution**: ceoExecutor.ts, API wrappers, cost tracking
8. **Polish**: CEO pip status from heartbeat, audit logging, dashboard integration
