# CEO Autonomous Agent System — Design Document

> Committed project documentation. Defines the architecture for the CEO to operate
> as an autonomous agent that proactively manages the workforce, executes skills,
> and communicates with the founder.

### Implementation Status (2026-02-12)
- **Shipped**: CEO ceremony, 8 archetypes, personality-aware system prompts, LLM streaming, scripted fallback (`ceoResponder.ts`)
- **Not yet built**: Scheduler, decision engine, agent factory, task execution pipeline, proactive chat loop
- **Files referenced but not yet created**: `ceoScheduler.ts`, `ceoDecisionEngine.ts`, `ceoExecutor.ts`, `ceoPersonality.ts`, `agentFactory.ts`
- **Prerequisite for**: Phase 2 (CEO Autonomy) in TASKS.md

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

### Option E: Supabase Edge Function + pg_cron

**How**: A Deno-based Edge Function (`supabase/functions/ceo-heartbeat/index.ts`) runs the CEO evaluation cycle. Triggered by `pg_cron` extension (built into self-hosted Supabase) on a configurable schedule (default: every 60 seconds). Has direct Postgres access via service role key. Pushes results to frontend via Supabase Realtime subscriptions on `chat_messages` and `ceo_action_queue` tables.

**Setup**:
```typescript
// supabase/functions/ceo-heartbeat/index.ts (Deno runtime)
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1. Load CEO + system state from Postgres
  const { data: ceo } = await supabase.from('ceo').select('*').single();
  const { data: missions } = await supabase.from('missions').select('*');
  const { data: agents } = await supabase.from('agents').select('*');
  const { data: pendingApprovals } = await supabase.from('approvals').select('*').eq('status', 'pending');

  // 2. Load CEO's API key from vault
  const { data: vaultEntry } = await supabase
    .from('vault').select('key_value')
    .eq('service', getServiceForModel(ceo.model)).single();

  // 3. Build prompt, call LLM, parse actions
  const prompt = buildCEOPrompt(ceo, { missions, agents, pendingApprovals });
  const response = await callLLM(ceo.model, vaultEntry.key_value, prompt);
  const actions = parseCEOActions(response);

  // 4. Write actions → ceo_action_queue, chat_messages
  //    Frontend receives updates instantly via Supabase Realtime
  for (const action of actions) {
    await supabase.from('ceo_action_queue').insert(action);
  }

  // 5. Update scheduler state
  await supabase.from('scheduler_state').upsert({ id: 'main', last_run: new Date().toISOString() });

  return new Response(JSON.stringify({ actions: actions.length }));
});
```

**pg_cron schedule** (in Supabase migration):
```sql
-- supabase/migrations/005_ceo_cron.sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule('ceo-heartbeat', '* * * * *',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/ceo-heartbeat',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
    body := '{}'::jsonb
  );$$
);
```

**Frontend Realtime subscription**:
```typescript
supabase.channel('ceo-actions')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
    addMessage(payload.new); // Instant chat update
  })
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ceo_action_queue' }, (payload) => {
    handleCEOAction(payload.new); // Trigger approval notification, etc.
  })
  .subscribe();
```

| Pros | Cons |
|------|------|
| Runs even when browser is closed | Requires Supabase Docker (but needed anyway for full mode) |
| Direct Postgres access (no message passing) | Cold start latency (~500ms first call) |
| True cron via pg_cron | Deno runtime (not Node.js — minor learning curve) |
| Realtime push to frontend (no polling) | Self-hosted Edge Functions less documented than cloud |
| Same infrastructure as the DB | Edge Function timeout limits (default 60s) |
| Can call any external LLM API | Debugging requires Supabase CLI tools |

**Why this is the recommended approach**: Supabase is already needed for auth, real-time updates, and server-side DB. The Edge Function runs in the same infrastructure — no separate server, no separate deployment. pg_cron is built into Supabase Postgres, so scheduling is a single SQL statement.

---

### Summary Matrix

| | A: setInterval | B: Visibility-aware | C: Web Worker | D: Real Cron | E: Supabase Edge |
|---|---|---|---|---|---|
| **Complexity** | Trivial | Low | Medium | High | Medium |
| **Backend required** | No | No | No | Yes (custom) | Yes (Supabase) |
| **Background tab** | Throttled | Pauses | Runs | N/A | N/A |
| **Browser closed** | No | No | No | Yes | Yes |
| **sql.js compatible** | Yes | Yes | Via messages | Needs migration | Needs Supabase |
| **Realtime push** | No | No | No | Via WebSocket | Via Supabase Realtime |
| **Best for** | Quick MVP | Demo mode | Niche | Custom backend | Supabase full mode |
| **Recommended phase** | Prototype | Demo mode | Skip | If not using Supabase | With Supabase |

**Recommended path**: Use **Option B** for demo mode (sql.js, client-side only). Use **Option E** for full mode (Supabase). Options A, C, D are documented for reference but not recommended.

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
- **Assigned skills** — only the tools this agent is authorized to use (see Skill Assignment below)

#### Tool-Calling Description
Short string for other agents/CEO to know what this agent does:
`"Agent SCOUT (Research Analyst). Capabilities: Research Web, Read X/Tweets. Use for information gathering and analysis tasks."`

#### User/Assistant Prompt Templates
- **User prompt (CEO → Agent)**: `Task: {task_description}\nContext: {context}\nConstraints: {constraints}\nExpected output: {output_format}\nTools available: {assigned_skills_with_commands}`
- **Assistant prompt**: `Approach: {steps}\nResults: {results}\nStatus: {status}\nTokens used: {tokens}`

---

## Skill Assignment Model

Skills are **NOT** globally available to all agents. The CEO controls which tools each agent can use.

### Flow

1. **Founder enables skills org-wide** — Skills page toggle determines what's available to the org
2. **CEO checks enabled skills** during evaluation cycle — knows what tools exist
3. **CEO requests founder enable more** — if a mission needs a skill that's off, CEO sends a chat message asking the founder to enable it (with a skill-enable action card)
4. **CEO assigns specific skill IDs per agent** — stored in agent's `skills` column (JSON array)
5. **Agent's system prompt** includes only its assigned skills as callable tools — with command definitions pulled from skill JSON
6. **CEO's user prompt per task** tells the agent which specific skills to use for that task — a subset of the agent's total assigned skills

### Agent Schema

```sql
ALTER TABLE agents ADD COLUMN skills TEXT DEFAULT '[]';  -- JSON array of skill IDs
-- Example: '["research-web", "write-document", "summarize-document"]'
```

### CEO Prompts

**CEO system prompt** includes:
```
Available org skills (enabled by founder): {enabled_skill_ids_with_titles}
```

**CEO user prompt per evaluation cycle** includes:
```
Check if any missions need skills that are not enabled.
For each agent, verify they have the skills needed for their current task.
When delegating a task, specify which tools the agent should use.
```

**Agent system prompt** includes:
```
You are {agent_name}, a {role} at {org_name}.
Your CEO is {ceo_name}. Report results back to the CEO.

You have access to the following tools:
{for each assigned skill: skill_title - skill_description, commands: [command definitions]}

Do NOT attempt to use tools not listed above.
If you need a tool you don't have, report this to the CEO.
```

**CEO → Agent user prompt per task**:
```
Task: {task_description}
Context: {context}
Use these tools: {specific_skill_ids_for_this_task}
Constraints: {constraints}
Expected output: {output_format}

If you need founder approval for anything, pause and report back.
```

---

## Agent Task Execution & Persistence

### Task Lifecycle

```
CEO delegates task → Agent starts working → Agent may need approval →
Agent reports results → CEO reviews → Mission updated → Audit logged
```

### Persistent Task Context

Agents need conversation history (memory) to resume after interruption. Each task execution stores its full context in a `task_executions` table:

```sql
CREATE TABLE IF NOT EXISTS task_executions (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL,       -- links to missions.id
  agent_id        TEXT NOT NULL,       -- who's executing
  status          TEXT NOT NULL DEFAULT 'running',  -- running | paused | waiting_approval | completed | failed
  conversation    TEXT NOT NULL DEFAULT '[]',  -- JSON: full LLM conversation history [{role, content}]
  assigned_skills TEXT NOT NULL DEFAULT '[]',  -- JSON: skill IDs assigned for this task
  tokens_used     INTEGER DEFAULT 0,
  cost            REAL DEFAULT 0.0,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  paused_at       TEXT DEFAULT NULL,
  completed_at    TEXT DEFAULT NULL,
  result          TEXT DEFAULT NULL,    -- JSON: final output / artifacts
  error           TEXT DEFAULT NULL
);
```

### Execution Flow

1. **CEO delegates task**: Creates `task_executions` row with status='running', assigned_skills, and initial conversation (system prompt + user prompt)
2. **Agent executes**: Calls LLM API with conversation history. Each response appended to `conversation` JSON. Agent status in surveillance = 'working'
3. **Agent needs approval**: Sets status='waiting_approval', creates `approvals` entry. Agent status in surveillance = 'idle' with amber indicator. Saves full conversation so it can resume
4. **Founder approves**: Approval triggers agent resume. Load `conversation` from `task_executions`, continue from where it left off with approval result injected as a message
5. **Process dies / tab closes**: On next boot or scheduler tick, find `task_executions` with status='waiting_approval' that now have matching approved `approvals`. Resume agent with full conversation history
6. **Agent reports results**: Sets status='completed', stores result JSON. CEO picks this up on next evaluation cycle
7. **CEO reviews**: Reads result, updates mission status (in_progress → review → done), writes audit log entry, may send chat message to founder
8. **Real-time updates**: Throughout execution, these update:
   - `/surveillance` — agent sprite shows 'working' status, switches to 'idle' when paused
   - `/missions` — mission card shows progress, assignee, status
   - `/dashboard` — agent details, task counts, cost tracking
   - `/audit` — execution events logged

### Mid-Task Approval Flow (Detail)

```
Agent running → needs external action (e.g., send email, spend > $X)
  → Agent pauses execution
  → Saves full conversation to task_executions.conversation
  → Creates approval: { type: 'agent_action', metadata: { agent_id, task_id, action_description } }
  → Status: task_executions.status = 'waiting_approval'
  → Surveillance: agent sprite → idle with amber dot
  → Approvals page: shows approval with context
  → Founder approves/declines
  → If approved:
      → Load conversation from task_executions
      → Inject approval message: "Founder approved: {action}. Proceed."
      → Resume LLM call with full history
      → Agent continues working
  → If declined:
      → Inject decline message: "Founder declined: {action}. Find alternative."
      → Resume with decline context
      → Agent adapts or reports inability
```

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
ALTER TABLE agents ADD COLUMN skills TEXT DEFAULT '[]';  -- JSON array of assigned skill IDs
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

### New: `task_executions`
```sql
CREATE TABLE IF NOT EXISTS task_executions (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running',
  conversation    TEXT NOT NULL DEFAULT '[]',
  assigned_skills TEXT NOT NULL DEFAULT '[]',
  tokens_used     INTEGER DEFAULT 0,
  cost            REAL DEFAULT 0.0,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  paused_at       TEXT DEFAULT NULL,
  completed_at    TEXT DEFAULT NULL,
  result          TEXT DEFAULT NULL,
  error           TEXT DEFAULT NULL
);
```

### Extended approval types
No schema change needed — `type` column is already TEXT. New values:
- `hire_agent` — CEO wants to hire an agent
- `budget_override` — CEO wants to exceed budget
- `execute_skill` — CEO wants to run an expensive skill
- `agent_action` — Agent needs founder permission for a mid-task action

---

## New Files Summary

### CEO Agent Core
| File | Purpose |
|------|---------|
| `src/lib/ceoScheduler.ts` | Scheduler class (visibility-aware for demo, Edge Function for full) |
| `src/lib/ceoDecisionEngine.ts` | CEO brain — state evaluation → action production |
| `src/lib/ceoExecutor.ts` | Direct skill execution via LLM API fetch() |
| `src/lib/ceoPersonality.ts` | Tone/threshold modifiers |
| `src/lib/agentFactory.ts` | Agent config generation + skill assignment |
| `src/lib/events.ts` | Centralized custom events |
| `src/data/agentNamePool.ts` | Thematic callsign pools |
| `src/hooks/useCEOScheduler.ts` | React hook for scheduler lifecycle |
| `src/hooks/useChatMessages.ts` | Persistent chat messages |

### Supabase Infrastructure (Full Mode)
| File | Purpose |
|------|---------|
| `supabase/config.toml` | Supabase CLI local config (ports, auth, no email confirm) |
| `supabase/migrations/001_initial_schema.sql` | Core tables (settings, agents, ceo, missions, etc.) |
| `supabase/migrations/002_auth_users.sql` | user_profiles linked to auth.users |
| `supabase/migrations/003_rls_policies.sql` | Row Level Security (authenticated full access) |
| `supabase/migrations/004_ceo_scheduler.sql` | scheduler_state, ceo_action_queue, chat_messages, task_executions |
| `supabase/migrations/005_ceo_cron.sql` | pg_cron + pg_net for CEO heartbeat schedule |
| `supabase/functions/ceo-heartbeat/index.ts` | Deno Edge Function — CEO evaluation cycle |

### Data Layer Abstraction (Dual-Mode)
| File | Purpose |
|------|---------|
| `src/lib/dataService.ts` | DataService interface (async) |
| `src/lib/sqliteDataService.ts` | sql.js implementation (wraps existing database.ts) |
| `src/lib/supabaseDataService.ts` | Supabase JS client implementation |
| `src/lib/supabaseClient.ts` | Supabase client singleton + health check |
| `src/contexts/DataContext.tsx` | React context for DataService + useData() hook |
| `src/contexts/AuthContext.tsx` | Auth state context (Supabase mode) |
| `src/hooks/useAuth.ts` | Auth session management hook |
| `src/hooks/useAppState.ts` | Replaces useDatabase, works through DataService |
| `src/AppBoot.tsx` | New top-level: mode detection → boot routing |
| `src/components/ModeSelection/ModeSelectionScreen.tsx` | Demo vs Full Setup chooser |
| `src/components/Auth/LoginScreen.tsx` | CRT-themed login/signup |
| `src/scripts/reset-password.ts` | CLI password reset (service role key) |

## Modified Files

| File | Changes |
|------|---------|
| `src/lib/database.ts` | Schema migrations, CRUD for new tables, extended columns |
| `src/types/index.ts` | Extended Agent (skills), TaskExecution, CEOAction, ChatMessageRow types |
| `src/data/skillDefinitions.ts` | 6 new skills (18 total) |
| `src/main.tsx` | Render AppBoot instead of App |
| `src/App.tsx` | Use DataService via context instead of direct imports |
| `src/components/Chat/ChatView.tsx` | Replace PostMeetingChat with ActiveChat, action cards |
| `src/components/Layout/AppLayout.tsx` | Mount useCEOScheduler hook |
| `src/components/Layout/NavigationRail.tsx` | Chat badge, CEO status, sign-out (full mode) |
| `src/components/Approvals/ApprovalsView.tsx` | Handle hire_agent + agent_action approval types |
| `src/components/Surveillance/SurveillanceView.tsx` | Real-time agent status from task_executions |
| `src/components/Surveillance/HireAgentModal.tsx` | Extended AgentConfig with skills assignment |
| `src/components/FounderCeremony/FounderCeremony.tsx` | system_setup phase (full mode) |

---

## Implementation Phases

1. **Supabase Foundation**: DataService interface, SqliteDataService wrapper, DataContext, AppBoot, ModeSelectionScreen
2. **Supabase Full Mode**: config.toml, migrations, SupabaseDataService, supabaseClient, Auth (LoginScreen, AuthContext)
3. **Founder Ceremony**: system_setup phase, health checks, account creation
4. **Agent Factory**: agentFactory.ts, ceoPersonality.ts, skill assignment, extended HireAgentModal
5. **Scheduler**: ceoScheduler.ts (demo: visibility-aware, full: Edge Function), useCEOScheduler hook
6. **Decision Engine**: ceoDecisionEngine.ts, evaluateCycle(), action pipeline
7. **Task Execution**: task_executions table, persistent conversation, mid-task approvals, resume flow
8. **Chat Integration**: useChatMessages, ActiveChat, action cards, chat badge, Supabase Realtime
9. **Approvals Extension**: hire_agent, agent_action types in ApprovalsView
10. **CEO Self-Execution**: ceoExecutor.ts, API wrappers, cost tracking
11. **Polish**: CEO pip from heartbeat, audit logging, dashboard integration, surveillance real-time status
