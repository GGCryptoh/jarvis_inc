# Skill Execution Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire CEO tool calls into background Supabase Edge Function execution with Realtime notifications, mission integration, a Collateral artifact browser, real Financials, and Vault notification channels.

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

Parallel batches:
- **Batch 1:** Tasks 1, 2, 6, 9 (all independent)
- **Batch 2:** Tasks 3, 7, 11 (depend on batch 1)
- **Batch 3:** Tasks 4, 5, 10 (depend on batch 2)
- **Batch 4:** Task 8 (depends on batch 3)

---

### Task 1: Add Edge Runtime to Docker Stack

**Files:**
- Modify: `docker/docker-compose.yml`
- Modify: `docker/supabase/kong.yml.template`
- Modify: `docker/setup.mjs`
- Modify: `docker/.env.example`
- Create: `docker/supabase/functions/main/index.ts`

**Step 1: Add edge-runtime service to docker-compose.yml**

Add after the `supabase-realtime` service:

```yaml
  # --- Supabase: Edge Functions (Deno runtime) -------------------
  supabase-functions:
    image: supabase/edge-runtime:v1.70.0
    restart: unless-stopped
    depends_on:
      supabase-db:
        condition: service_healthy
    environment:
      JWT_SECRET: ${JWT_SECRET}
      SUPABASE_URL: http://supabase-kong:8000
      SUPABASE_ANON_KEY: ${ANON_KEY}
      SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
      SUPABASE_DB_URL: postgresql://postgres:${POSTGRES_PASSWORD}@supabase-db:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-postgres}
      VERIFY_JWT: "false"
    volumes:
      - ./supabase/functions:/home/deno/functions:Z
    command:
      - start
      - --main-service
      - /home/deno/functions/main
    networks:
      - jarvis-net
```

Also add `supabase-functions` to Kong's `depends_on` list.

**Step 2: Add functions route to kong.yml.template**

Add to the `services:` list:

```yaml
  - name: functions-v1
    url: http://supabase-functions:9000/
    routes:
      - name: functions-v1-all
        strip_path: true
        paths:
          - /functions/v1/
    plugins:
      - name: cors
```

**Step 3: Create the main dispatcher**

Create `docker/supabase/functions/main/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const FUNCTION_DIR = "/home/deno/functions";

serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const functionName = pathParts[0];

  if (!functionName) {
    return new Response(JSON.stringify({ error: "Function name required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const mod = await import(`${FUNCTION_DIR}/${functionName}/index.ts`);
    if (typeof mod.default === "function") {
      return await mod.default(req);
    }
    return new Response(JSON.stringify({ error: "Function has no default export" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Function "${functionName}" not found: ${err}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
});
```

Note: If the official `supabase/edge-runtime` image handles routing internally (via `--main-service`), this may be simpler — test and adapt. The image's built-in dispatcher may handle worker isolation automatically. In that case, the main/index.ts can be a minimal passthrough.

**Step 4: Update setup.mjs**

In `generateKongConfig()`, the template already handles substitution. The new functions route in kong.yml.template has no variables, so no setup.mjs change needed for Kong.

Add an edge-runtime health check to the `waitForServices()` function:

```javascript
// After existing health checks
{ name: 'Edge Functions', url: 'http://localhost:8000/functions/v1/health', optional: true },
```

Create a health function: `docker/supabase/functions/health/index.ts`:

```typescript
export default async (_req: Request) => {
  return new Response(JSON.stringify({ status: "ok" }), {
    headers: { "Content-Type": "application/json" },
  });
};
```

**Step 5: Update .env.example**

Add:

```
# Edge Functions
FUNCTIONS_VERIFY_JWT=false
```

**Step 6: Commit**

```bash
git add docker/docker-compose.yml docker/supabase/kong.yml.template docker/setup.mjs docker/.env.example docker/supabase/functions/
git commit -m "feat: add Supabase Edge Runtime to Docker stack"
```

---

### Task 2: Migration 005 — Channels Tables

**Files:**
- Create: `docker/supabase/migrations/005_channels.sql`

**Step 1: Write the migration**

```sql
-- Notification channels + usage tracking
CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('email', 'telegram', 'sms', 'voice')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{}',
  cost_per_unit REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_usage (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES notification_channels(id),
  type TEXT NOT NULL,
  recipient TEXT,
  cost REAL NOT NULL DEFAULT 0,
  mission_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_usage_created ON channel_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_usage_channel ON channel_usage (channel_id);

-- RLS
ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channels_anon_all" ON notification_channels FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "channels_auth_all" ON notification_channels FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE channel_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channel_usage_anon_all" ON channel_usage FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "channel_usage_auth_all" ON channel_usage FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

**Step 2: Commit**

```bash
git add docker/supabase/migrations/005_channels.sql
git commit -m "feat: add notification_channels + channel_usage tables"
```

---

### Task 3: Edge Function — `execute-skill`

**Files:**
- Create: `docker/supabase/functions/execute-skill/index.ts`

**Step 1: Write the edge function**

This is the core background execution function. It reads everything from DB (no secrets in the request), calls the LLM provider, streams the response, writes results back.

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
};

// Provider endpoint configs
const PROVIDER_ENDPOINTS: Record<string, string> = {
  Anthropic: "https://api.anthropic.com/v1/messages",
  OpenAI: "https://api.openai.com/v1/chat/completions",
  Google: "https://generativelanguage.googleapis.com/v1beta/models",
  DeepSeek: "https://api.deepseek.com/v1/chat/completions",
  xAI: "https://api.x.ai/v1/chat/completions",
};

// Model display name → service mapping (duplicated from browser code for standalone use)
const MODEL_SERVICE_MAP: Record<string, string> = {
  "Claude Opus 4.6": "Anthropic",
  "Claude Opus 4.5": "Anthropic",
  "Claude Sonnet 4.5": "Anthropic",
  "Claude Haiku 4.5": "Anthropic",
  "GPT-5.2": "OpenAI",
  "o3-pro": "OpenAI",
  "o4-mini": "OpenAI",
  "Gemini 3 Pro": "Google",
  "Gemini 2.5 Flash": "Google",
  "DeepSeek R1": "DeepSeek",
  "Llama 3.3": "Meta",
  "Grok 4": "xAI",
};

const MODEL_API_IDS: Record<string, string> = {
  "Claude Opus 4.6": "claude-opus-4-6",
  "Claude Opus 4.5": "claude-opus-4-5-20251101",
  "Claude Sonnet 4.5": "claude-sonnet-4-5-20250929",
  "Claude Haiku 4.5": "claude-haiku-4-5-20251001",
  "GPT-5.2": "gpt-5.2",
  "o3-pro": "o3-pro",
  "o4-mini": "o4-mini",
  "Gemini 3 Pro": "gemini-3.0-pro",
  "Gemini 2.5 Flash": "gemini-2.5-flash",
  "DeepSeek R1": "deepseek-reasoner",
  "Llama 3.3": "llama-3.3-70b",
  "Grok 4": "grok-4",
};

const MODEL_COSTS: Record<string, [number, number]> = {
  "Claude Opus 4.6": [5, 25],
  "Claude Opus 4.5": [5, 25],
  "Claude Sonnet 4.5": [3, 15],
  "Claude Haiku 4.5": [0.8, 4],
  "GPT-5.2": [10, 30],
  "o3-pro": [20, 80],
  "o4-mini": [1.1, 4.4],
  "Gemini 3 Pro": [1.25, 5],
  "Gemini 2.5 Flash": [0.15, 0.6],
  "DeepSeek R1": [0.55, 2.19],
  "Llama 3.3": [0.6, 0.6],
  "Grok 4": [3, 15],
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_COSTS[model] ?? [0, 0];
  return (inputTokens / 1_000_000) * rates[0] + (outputTokens / 1_000_000) * rates[1];
}

// ── LLM Provider Calls ──────────────────────────────────────────

interface LLMResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

async function callAnthropic(apiKey: string, modelId: string, systemPrompt: string, userPrompt: string): Promise<LLMResult> {
  const resp = await fetch(PROVIDER_ENDPOINTS.Anthropic, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return {
    text: data.content?.[0]?.text ?? "",
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

async function callOpenAICompatible(endpoint: string, apiKey: string, modelId: string, systemPrompt: string, userPrompt: string): Promise<LLMResult> {
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI-compatible ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

async function callGoogle(apiKey: string, modelId: string, systemPrompt: string, userPrompt: string): Promise<LLMResult> {
  const url = `${PROVIDER_ENDPOINTS.Google}/${modelId}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { maxOutputTokens: 4096 },
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

async function callLLM(service: string, apiKey: string, modelId: string, systemPrompt: string, userPrompt: string): Promise<LLMResult> {
  switch (service) {
    case "Anthropic":
      return callAnthropic(apiKey, modelId, systemPrompt, userPrompt);
    case "OpenAI":
      return callOpenAICompatible(PROVIDER_ENDPOINTS.OpenAI, apiKey, modelId, systemPrompt, userPrompt);
    case "DeepSeek":
      return callOpenAICompatible(PROVIDER_ENDPOINTS.DeepSeek, apiKey, modelId, systemPrompt, userPrompt);
    case "xAI":
      return callOpenAICompatible("https://api.x.ai/v1/chat/completions", apiKey, modelId, systemPrompt, userPrompt);
    case "Google":
      return callGoogle(apiKey, modelId, systemPrompt, userPrompt);
    default:
      throw new Error(`Unsupported service: ${service}`);
  }
}

// ── Main Handler ─────────────────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { task_execution_id } = await req.json();
    if (!task_execution_id) {
      return new Response(JSON.stringify({ error: "task_execution_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Load task execution
    const { data: task, error: taskErr } = await supabase
      .from("task_executions")
      .select("*")
      .eq("id", task_execution_id)
      .single();
    if (taskErr || !task) throw new Error(`Task not found: ${taskErr?.message}`);

    // 2. Mark as running
    await supabase
      .from("task_executions")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", task_execution_id);

    // 3. Load skill definition
    const { data: skill } = await supabase
      .from("skills")
      .select("*")
      .eq("id", task.skill_id)
      .single();
    if (!skill) throw new Error(`Skill not found: ${task.skill_id}`);

    // 4. Determine model and service
    const model = task.model || skill.model || "Claude Sonnet 4.5";
    const service = MODEL_SERVICE_MAP[model] ?? "Anthropic";
    const apiModelId = MODEL_API_IDS[model] ?? model;

    // 5. Get API key from vault
    const { data: vaultEntry } = await supabase
      .from("vault")
      .select("key_value")
      .eq("service", service)
      .limit(1)
      .single();
    if (!vaultEntry?.key_value) throw new Error(`No API key for ${service}`);

    // 6. Build prompt from skill command
    const definition = typeof skill.definition === "string" ? JSON.parse(skill.definition) : (skill.definition ?? {});
    const commands = definition.commands ?? [];
    const command = commands.find((c: any) => c.name === task.command_name) ?? commands[0];
    const params = task.params ?? {};

    let systemPrompt = `You are an AI agent executing the "${skill.id}" skill.\n`;
    if (command?.prompt_template) {
      systemPrompt += command.prompt_template;
    } else {
      systemPrompt += `Execute the "${command?.name ?? task.command_name}" command.\n`;
      systemPrompt += `Skill description: ${definition.description ?? skill.id}\n`;
    }

    let userPrompt = "";
    for (const [key, val] of Object.entries(params)) {
      userPrompt += `${key}: ${val}\n`;
    }
    if (!userPrompt) userPrompt = task.command_name ?? "Execute";

    // 7. Call LLM (non-streaming for simplicity — edge function writes result at end)
    const result = await callLLM(service, vaultEntry.key_value, apiModelId, systemPrompt, userPrompt);

    // 8. Calculate cost
    const cost = estimateCost(model, result.inputTokens, result.outputTokens);

    // 9. Update task_execution with result
    await supabase
      .from("task_executions")
      .update({
        status: "completed",
        result: { output: result.text, summary: result.text.slice(0, 200) },
        tokens_used: result.inputTokens + result.outputTokens,
        cost_usd: cost,
        completed_at: new Date().toISOString(),
        conversation: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
          { role: "assistant", content: result.text },
        ],
      })
      .eq("id", task_execution_id);

    // 10. Log to llm_usage
    const usageId = `usage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await supabase.from("llm_usage").insert({
      id: usageId,
      provider: service,
      model,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      estimated_cost: cost,
      context: "skill_execution",
      mission_id: task.mission_id ?? null,
      agent_id: task.agent_id ?? null,
    });

    // 11. Log to audit
    await supabase.from("audit_log").insert({
      agent: task.agent_id ?? "ceo",
      action: "SKILL_EXECUTE",
      details: `${skill.id}/${task.command_name} via ${model} (${result.inputTokens + result.outputTokens} tokens, $${cost.toFixed(4)})`,
      severity: "info",
    });

    // 12. Check if all tasks for this mission are complete
    if (task.mission_id) {
      const { data: siblings } = await supabase
        .from("task_executions")
        .select("status")
        .eq("mission_id", task.mission_id);

      const allComplete = siblings?.every((t: any) => t.status === "completed" || t.status === "failed");

      if (allComplete) {
        await supabase
          .from("missions")
          .update({ status: "review" })
          .eq("id", task.mission_id);

        // 13. Post CEO summary in chat
        const { data: ceo } = await supabase.from("ceo").select("name").limit(1).single();
        const ceoName = ceo?.name ?? "CEO";

        // Find or create conversation
        const { data: convos } = await supabase
          .from("conversations")
          .select("id")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1);

        const convoId = convos?.[0]?.id;
        if (convoId) {
          const completedTasks = siblings?.filter((t: any) => t.status === "completed") ?? [];
          const failedTasks = siblings?.filter((t: any) => t.status === "failed") ?? [];
          let summary = `Mission complete — ${completedTasks.length} task(s) finished`;
          if (failedTasks.length > 0) summary += `, ${failedTasks.length} failed`;
          summary += `. Head to Missions to review the results.`;

          await supabase.from("chat_messages").insert({
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            conversation_id: convoId,
            sender: "ceo",
            text: summary,
            metadata: { type: "mission_complete", mission_id: task.mission_id },
          });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, task_execution_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // Update task as failed
    try {
      const { task_execution_id } = await req.clone().json().catch(() => ({}));
      if (task_execution_id) {
        await supabase
          .from("task_executions")
          .update({
            status: "failed",
            result: { error: String(err) },
            completed_at: new Date().toISOString(),
          })
          .eq("id", task_execution_id);
      }
    } catch { /* best effort */ }

    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
```

**Step 2: Commit**

```bash
git add docker/supabase/functions/execute-skill/
git commit -m "feat: execute-skill edge function — background LLM skill execution"
```

---

### Task 4: Task Plan Parser & Dispatch

**Files:**
- Create: `src/lib/taskDispatcher.ts`
- Modify: `src/lib/llm/chatService.ts`

**Step 1: Create taskDispatcher.ts**

Parses `<task_plan>` and `<tool_call>` blocks from CEO response text. Creates missions + task_executions in DB. Dispatches to edge function.

```typescript
import { getSupabase } from './supabase';
import { loadCEO } from './database';

export interface ParsedMission {
  title: string;
  toolCalls: { name: string; arguments: Record<string, unknown> }[];
}

/** Parse <task_plan> or individual <tool_call> blocks from CEO response */
export function parseTaskPlan(text: string): ParsedMission[] {
  // Try <task_plan> first
  const planMatch = text.match(/<task_plan>\s*([\s\S]*?)\s*<\/task_plan>/);
  if (planMatch) {
    try {
      const plan = JSON.parse(planMatch[1]);
      return (plan.missions ?? []).map((m: any) => ({
        title: m.title ?? 'Untitled mission',
        toolCalls: m.tool_calls ?? [],
      }));
    } catch { /* fall through */ }
  }

  // Fallback: individual <tool_call> blocks → one mission per call
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const missions: ParsedMission[] = [];
  let match: RegExpExecArray | null;
  while ((match = toolCallRegex.exec(text)) !== null) {
    try {
      const call = JSON.parse(match[1]);
      missions.push({
        title: `${call.name}: ${Object.values(call.arguments ?? {})[0] ?? 'execute'}`.slice(0, 100),
        toolCalls: [call],
      });
    } catch { /* skip unparseable */ }
  }

  return missions;
}

/** Strip task_plan/tool_call blocks from text, leaving the conversational parts */
export function stripTaskBlocks(text: string): string {
  return text
    .replace(/<task_plan>[\s\S]*?<\/task_plan>/g, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .trim();
}

/** Create missions + task_executions and dispatch to edge function */
export async function dispatchTaskPlan(missions: ParsedMission[], model: string): Promise<string[]> {
  const sb = getSupabase();
  const ceo = await loadCEO();
  const missionIds: string[] = [];

  for (const mission of missions) {
    const missionId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    missionIds.push(missionId);

    // Create mission
    await sb.from('missions').insert({
      id: missionId,
      title: mission.title,
      status: 'in_progress',
      assignee: ceo?.name ?? 'CEO',
      priority: 'medium',
      created_by: ceo?.name ?? 'CEO',
    });

    // Create task_executions and dispatch
    for (const call of mission.toolCalls) {
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      await sb.from('task_executions').insert({
        id: taskId,
        mission_id: missionId,
        agent_id: 'ceo',
        skill_id: call.name,
        command_name: call.name,
        params: call.arguments,
        model,
        status: 'pending',
      });

      // Fire-and-forget dispatch to edge function
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('jarvis_supabase_url') || '';
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('jarvis_supabase_anon_key') || '';

      fetch(`${supabaseUrl}/functions/v1/execute-skill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ task_execution_id: taskId }),
      }).catch(err => console.error('Dispatch failed:', err));
    }
  }

  window.dispatchEvent(new Event('missions-changed'));
  window.dispatchEvent(new Event('task-executions-changed'));
  return missionIds;
}
```

**Step 2: Wire into chatService.ts onDone callback**

In `src/lib/llm/chatService.ts`, modify the `wrappedCallbacks.onDone` to detect and dispatch task plans:

After the existing `logUsage` call, add:

```typescript
import { parseTaskPlan, dispatchTaskPlan, stripTaskBlocks } from '../taskDispatcher';

// Inside wrappedCallbacks.onDone, after logUsage:
const missions = parseTaskPlan(fullText);
if (missions.length > 0) {
  dispatchTaskPlan(missions, availability.displayModel).catch(() => {});
}
```

The chat UI will handle rendering via `TaskPlanBlock` (Task 5) — the `fullText` still includes the `<task_plan>` blocks which the renderer will parse.

**Step 3: Add task_plan instruction to CEO system prompt**

In `buildCEOSystemPrompt()` in chatService.ts, add to the system prompt:

```typescript
// After the skills section
prompt += `\n## Tool Usage\n`;
prompt += `When you need to use skills, wrap tool calls in a <task_plan> block:\n`;
prompt += `<task_plan>\n{"missions":[{"title":"Mission name","tool_calls":[{"name":"skill-id","arguments":{"param":"value"}}]}]}\n</task_plan>\n`;
prompt += `Group related calls into one mission. Unrelated requests = separate missions.\n`;
prompt += `For a single quick call, you can use <tool_call>{"name":"skill-id","arguments":{...}}</tool_call>\n`;
```

**Step 4: Commit**

```bash
git add src/lib/taskDispatcher.ts src/lib/llm/chatService.ts
git commit -m "feat: task plan parser + edge function dispatch from CEO chat"
```

---

### Task 5: TaskPlanBlock Component

**Files:**
- Create: `src/components/Chat/TaskPlanBlock.tsx`
- Modify: `src/components/Chat/ToolCallBlock.tsx`
- Modify: `src/components/Chat/ChatThread.tsx`

**Step 1: Create TaskPlanBlock.tsx**

A mission-level card that shows grouped tool calls with live status updates from Realtime.

```typescript
import { useState, useEffect } from 'react';
import { Target, Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';
import { skills as skillDefinitions } from '../../data/skillDefinitions';

interface TaskExecution {
  id: string;
  skill_id: string;
  command_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: { output?: string; summary?: string; error?: string };
}

interface TaskPlanBlockProps {
  missionId: string;
  missionTitle: string;
  tasks: TaskExecution[];
}

const STATUS_CONFIG = {
  pending: { icon: Clock, color: 'text-cyan-400', border: 'border-cyan-400/30', bg: 'bg-cyan-400/[0.04]', label: 'QUEUED' },
  running: { icon: Loader2, color: 'text-cyan-400', border: 'border-cyan-400/30', bg: 'bg-cyan-400/[0.04]', label: 'EXECUTING...' },
  completed: { icon: CheckCircle, color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/[0.04]', label: 'COMPLETE' },
  failed: { icon: XCircle, color: 'text-red-400', border: 'border-red-500/30', bg: 'bg-red-500/[0.04]', label: 'FAILED' },
};

export default function TaskPlanBlock({ missionId, missionTitle, tasks: initialTasks }: TaskPlanBlockProps) {
  const [tasks, setTasks] = useState(initialTasks);

  // Listen for task execution updates via Realtime events
  useEffect(() => {
    const handler = () => {
      // Re-fetch task statuses for this mission
      import('../../lib/supabase').then(({ getSupabase }) => {
        getSupabase()
          .from('task_executions')
          .select('id, skill_id, command_name, status, result')
          .eq('mission_id', missionId)
          .then(({ data }) => {
            if (data) setTasks(data as TaskExecution[]);
          });
      });
    };

    window.addEventListener('task-executions-changed', handler);
    // Also poll every 3s as fallback
    const interval = setInterval(handler, 3000);
    return () => {
      window.removeEventListener('task-executions-changed', handler);
      clearInterval(interval);
    };
  }, [missionId]);

  // Overall mission status
  const allComplete = tasks.every(t => t.status === 'completed');
  const anyFailed = tasks.some(t => t.status === 'failed');
  const anyRunning = tasks.some(t => t.status === 'running');
  const overallStatus = allComplete ? 'completed' : anyFailed ? 'failed' : anyRunning ? 'running' : 'pending';
  const config = STATUS_CONFIG[overallStatus];
  const StatusIcon = config.icon;

  return (
    <div className={`my-3 rounded-lg border ${config.border} ${config.bg} overflow-hidden`}>
      {/* Mission header */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${config.border} bg-black/20`}>
        <Target size={12} className={config.color} />
        <span className="font-pixel text-[9px] tracking-widest text-zinc-400">MISSION</span>
        <span className="flex-1" />
        <StatusIcon size={12} className={`${config.color} ${overallStatus === 'running' ? 'animate-spin' : ''}`} />
        <span className={`font-pixel text-[9px] tracking-widest ${config.color}`}>{config.label}</span>
      </div>

      {/* Mission title */}
      <div className="px-3 py-2">
        <div className="font-pixel text-[10px] tracking-wider text-zinc-200">{missionTitle}</div>
      </div>

      {/* Task list */}
      <div className="px-3 pb-2 space-y-1">
        {tasks.map(task => {
          const skill = skillDefinitions.find(s => s.id === task.skill_id);
          const SkillIcon = skill?.icon ?? Target;
          const taskConfig = STATUS_CONFIG[task.status];
          const TaskStatusIcon = taskConfig.icon;

          return (
            <div key={task.id} className="flex items-center gap-2 py-1">
              <SkillIcon size={12} className="text-zinc-500 flex-shrink-0" />
              <span className="font-pixel text-[9px] tracking-wider text-zinc-400 flex-1 truncate">
                {skill?.name ?? task.skill_id}
              </span>
              <TaskStatusIcon
                size={10}
                className={`${taskConfig.color} flex-shrink-0 ${task.status === 'running' ? 'animate-spin' : ''}`}
              />
            </div>
          );
        })}
      </div>

      {/* Completed: show preview */}
      {allComplete && tasks[0]?.result?.summary && (
        <div className="px-3 py-2 border-t border-emerald-500/20 bg-emerald-500/[0.03]">
          <div className="font-pixel text-[9px] tracking-wider text-zinc-500 line-clamp-2">
            {tasks[0].result.summary}...
          </div>
        </div>
      )}

      {/* Failed: show error */}
      {anyFailed && (
        <div className="px-3 py-2 border-t border-red-500/20 bg-red-500/[0.03]">
          <div className="font-pixel text-[9px] tracking-wider text-red-400">
            {tasks.find(t => t.status === 'failed')?.result?.error ?? 'Execution failed'}
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Update ToolCallBlock.tsx to detect dispatched tasks**

In `RichMessageContent`, check if the text contains `<task_plan>` blocks. If so, render `TaskPlanBlock` components instead of individual `ToolCallCard`s. This requires loading task_executions from DB by mission_id.

Update the `parseToolCalls` function in `ToolCallBlock.tsx` to also detect `<task_plan>`:

```typescript
import { parseTaskPlan, stripTaskBlocks } from '../../lib/taskDispatcher';

/** Render message text with inline tool call or task plan blocks */
export default function RichMessageContent({ text }: { text: string }) {
  // Check for task_plan first
  const missions = parseTaskPlan(text);
  if (missions.length > 0) {
    const cleanText = stripTaskBlocks(text);
    // TaskPlanBlock needs mission IDs — loaded from DB in parent
    // For now, show the missions as enhanced tool cards
    return (
      <>
        {cleanText && <span>{cleanText}</span>}
        {missions.map((m, i) => (
          <div key={i} className="my-2">
            {m.toolCalls.map((call, j) => (
              <ToolCallCard key={j} call={call} />
            ))}
          </div>
        ))}
      </>
    );
  }

  // Fallback to individual tool_call parsing
  const segments = parseToolCalls(text);
  // ... existing logic
}
```

Note: Full TaskPlanBlock integration (with Realtime mission IDs) will be wired in ChatThread.tsx where we have access to the database context. The ToolCallBlock provides the initial render; ChatThread upgrades it to TaskPlanBlock once the mission is dispatched.

**Step 3: Commit**

```bash
git add src/components/Chat/TaskPlanBlock.tsx src/components/Chat/ToolCallBlock.tsx src/components/Chat/ChatThread.tsx
git commit -m "feat: TaskPlanBlock — mission-grouped execution cards with live status"
```

---

### Task 6: Realtime Subscriptions + Toast Notifications

**Files:**
- Modify: `src/hooks/useRealtimeSubscriptions.ts`
- Create: `src/components/Layout/ToastNotification.tsx`
- Modify: `src/components/Layout/AppLayout.tsx`

**Step 1: Add task_executions to Realtime subscriptions**

In `useRealtimeSubscriptions.ts`, add to `TABLE_EVENT_MAP`:

```typescript
const TABLE_EVENT_MAP: Record<string, string> = {
  approvals: 'approvals-changed',
  agents: 'agents-changed',
  missions: 'missions-changed',
  chat_messages: 'chat-messages-changed',
  ceo: 'ceo-changed',
  ceo_action_queue: 'ceo-actions-changed',
  task_executions: 'task-executions-changed',  // NEW
};
```

**Step 2: Create ToastNotification.tsx**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { X, CheckCircle, AlertCircle } from 'lucide-react';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  navigateTo?: string;
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info', navigateTo?: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts(prev => [...prev, { id, message, type, navigateTo }]);
    // Auto-dismiss after 8s
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 8000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, addToast, dismissToast };
}

export default function ToastContainer({
  toasts,
  onDismiss,
  onNavigate,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  onNavigate?: (path: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
      {toasts.map(toast => (
        <div
          key={toast.id}
          onClick={() => toast.navigateTo && onNavigate?.(toast.navigateTo)}
          className={[
            'rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm',
            toast.navigateTo ? 'cursor-pointer' : '',
            toast.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10'
              : toast.type === 'error'
                ? 'border-red-500/30 bg-red-500/10'
                : 'border-cyan-400/30 bg-cyan-400/10',
          ].join(' ')}
        >
          <div className="flex items-start gap-2">
            {toast.type === 'success' ? (
              <CheckCircle size={14} className="text-emerald-400 mt-0.5 flex-shrink-0" />
            ) : toast.type === 'error' ? (
              <AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
            ) : null}
            <div className="font-pixel text-[9px] tracking-wider text-zinc-200 flex-1 leading-relaxed">
              {toast.message}
            </div>
            <button onClick={(e) => { e.stopPropagation(); onDismiss(toast.id); }}>
              <X size={12} className="text-zinc-500 hover:text-zinc-300" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Step 3: Mount toast system + mission Realtime listener in AppLayout.tsx**

```typescript
import ToastContainer, { useToast } from './ToastNotification';
import { useNavigate } from 'react-router-dom';

// Inside AppLayout:
const { toasts, addToast, dismissToast } = useToast();
const navigate = useNavigate();

// Listen for mission completions
useEffect(() => {
  const handler = async () => {
    // Check for missions that just moved to 'review'
    try {
      const { getSupabase } = await import('../../lib/supabase');
      const { data } = await getSupabase()
        .from('missions')
        .select('id, title')
        .eq('status', 'review')
        .order('updated_at', { ascending: false })
        .limit(1);
      if (data?.[0]) {
        addToast(
          `Mission ready for review: ${data[0].title}`,
          'success',
          '/missions',
        );
      }
    } catch { /* ignore */ }
  };

  window.addEventListener('missions-changed', handler);
  return () => window.removeEventListener('missions-changed', handler);
}, [addToast]);

// In JSX, after the main content:
<ToastContainer toasts={toasts} onDismiss={dismissToast} onNavigate={navigate} />
```

**Step 4: Commit**

```bash
git add src/hooks/useRealtimeSubscriptions.ts src/components/Layout/ToastNotification.tsx src/components/Layout/AppLayout.tsx
git commit -m "feat: toast notifications + task_executions Realtime subscription"
```

---

### Task 7: Missions Review Flow + Nav Badge

**Files:**
- Modify: `src/components/Missions/MissionsView.tsx`
- Modify: `src/components/Layout/NavigationRail.tsx`
- Modify: `src/lib/database.ts`

**Step 1: Add review count function to database.ts**

```typescript
export async function getMissionReviewCount(): Promise<number> {
  const { count } = await getSupabase()
    .from('missions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'review');
  return count ?? 0;
}
```

**Step 2: Add badge to NavigationRail**

Follow the exact same pattern as the approval badge:

```typescript
const [reviewCount, setReviewCount] = useState(0);

useEffect(() => {
  const load = async () => {
    try { setReviewCount(await getMissionReviewCount()); } catch {}
  };
  load();
}, []);

useEffect(() => {
  const refresh = async () => {
    try { setReviewCount(await getMissionReviewCount()); } catch {}
  };
  const interval = setInterval(refresh, 5000);
  window.addEventListener('missions-changed', refresh);
  return () => {
    clearInterval(interval);
    window.removeEventListener('missions-changed', refresh);
  };
}, []);

// In the nav items render:
{item.label === 'Missions' && reviewCount > 0 && (
  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-black px-1">
    {reviewCount}
  </span>
)}
```

**Step 3: Add review detail to MissionsView**

When a mission card in the `review` column is clicked, show an expanded detail overlay with:
- Mission title
- Task execution outputs (loaded from `task_executions WHERE mission_id = ?`)
- Total cost (sum of `cost_usd`)
- Rendered markdown output (using `whitespace-pre-line` for now, upgrade to markdown renderer later)
- APPROVE button → `updateMissionStatus(id, 'done')` + audit log
- REDO button → `updateMissionStatus(id, 'in_progress')` + re-dispatch
- DISCARD button → `updateMissionStatus(id, 'done')` + flag as discarded

Add to database.ts:

```typescript
export async function loadTaskExecutions(missionId: string): Promise<any[]> {
  const { data } = await getSupabase()
    .from('task_executions')
    .select('*')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: true });
  return data ?? [];
}
```

The MissionsView review detail is a modal/overlay component:

```typescript
// MissionReviewDialog — shows output, cost, approve/redo/discard
function MissionReviewDialog({ mission, onClose }: { mission: MissionRow; onClose: () => void }) {
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    loadTaskExecutions(mission.id).then(setTasks);
  }, [mission.id]);

  const totalCost = tasks.reduce((sum, t) => sum + (t.cost_usd ?? 0), 0);
  const totalTokens = tasks.reduce((sum, t) => sum + (t.tokens_used ?? 0), 0);

  const handleApprove = async () => {
    await updateMissionStatus(mission.id, 'done');
    await logAudit('Founder', 'MISSION_APPROVED', `Approved: ${mission.title} ($${totalCost.toFixed(4)})`);
    window.dispatchEvent(new Event('missions-changed'));
    onClose();
  };

  const handleRedo = async () => {
    await updateMissionStatus(mission.id, 'in_progress');
    // Re-dispatch all failed or completed tasks
    for (const task of tasks) {
      await getSupabase().from('task_executions').update({ status: 'pending', result: null }).eq('id', task.id);
      // Dispatch to edge function
      // ... same dispatch logic as taskDispatcher.ts
    }
    window.dispatchEvent(new Event('missions-changed'));
    window.dispatchEvent(new Event('task-executions-changed'));
    onClose();
  };

  // ... render modal with task outputs, costs, buttons
}
```

**Step 4: Commit**

```bash
git add src/components/Missions/MissionsView.tsx src/components/Layout/NavigationRail.tsx src/lib/database.ts
git commit -m "feat: mission review flow + green nav badge for review items"
```

---

### Task 8: Collateral Page

**Files:**
- Create: `src/components/Collateral/CollateralView.tsx`
- Modify: `src/App.tsx` (add route)
- Modify: `src/components/Layout/NavigationRail.tsx` (add nav item)

**Step 1: Create CollateralView.tsx**

Artifact browser — grid of task execution output cards with filters.

```typescript
import { useState, useEffect } from 'react';
import { Archive, Search, Calendar, Filter } from 'lucide-react';
import { skills as skillDefinitions } from '../../data/skillDefinitions';

interface Artifact {
  id: string;
  skill_id: string;
  command_name: string;
  result: { output?: string; summary?: string };
  mission_id: string;
  mission_title?: string;
  agent_id: string;
  cost_usd: number;
  tokens_used: number;
  completed_at: string;
}

export default function CollateralView() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [skillFilter, setSkillFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'all'>('all');

  useEffect(() => {
    loadArtifacts();
    window.addEventListener('task-executions-changed', loadArtifacts);
    return () => window.removeEventListener('task-executions-changed', loadArtifacts);
  }, []);

  const loadArtifacts = async () => {
    const { getSupabase } = await import('../../lib/supabase');
    let query = getSupabase()
      .from('task_executions')
      .select('id, skill_id, command_name, result, mission_id, agent_id, cost_usd, tokens_used, completed_at')
      .eq('status', 'completed')
      .not('result', 'is', null)
      .order('completed_at', { ascending: false });

    // Date filter
    if (dateRange === 'today') {
      query = query.gte('completed_at', new Date(Date.now() - 86400000).toISOString());
    } else if (dateRange === 'week') {
      query = query.gte('completed_at', new Date(Date.now() - 7 * 86400000).toISOString());
    } else if (dateRange === 'month') {
      query = query.gte('completed_at', new Date(Date.now() - 30 * 86400000).toISOString());
    }

    const { data } = await query.limit(100);
    setArtifacts((data ?? []) as Artifact[]);
  };

  const filtered = artifacts
    .filter(a => !skillFilter || a.skill_id === skillFilter)
    .filter(a => !searchQuery || a.result?.output?.toLowerCase().includes(searchQuery.toLowerCase()));

  const uniqueSkills = [...new Set(artifacts.map(a => a.skill_id))];

  // Detail view when artifact is selected
  if (selectedArtifact) {
    const skill = skillDefinitions.find(s => s.id === selectedArtifact.skill_id);
    return (
      <div className="flex-1 flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
          <button onClick={() => setSelectedArtifact(null)} className="font-pixel text-[10px] text-zinc-500 hover:text-zinc-300">
            ← BACK
          </button>
          <div className="font-pixel text-[11px] tracking-wider text-zinc-200 flex-1">
            {skill?.name ?? selectedArtifact.skill_id}
          </div>
          <span className="font-pixel text-[9px] text-zinc-500">
            ${selectedArtifact.cost_usd?.toFixed(4)} · {selectedArtifact.tokens_used} tokens
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="font-pixel text-[10px] tracking-wider text-zinc-300 whitespace-pre-line leading-relaxed">
            {selectedArtifact.result?.output ?? 'No output'}
          </div>
        </div>
      </div>
    );
  }

  // Grid view
  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header + Filters */}
      <div className="px-6 py-4 border-b border-zinc-800">
        <h1 className="font-pixel text-[13px] tracking-wider text-zinc-100 mb-3">COLLATERAL</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Date chips */}
          {(['today', 'week', 'month', 'all'] as const).map(d => (
            <button
              key={d}
              onClick={() => setDateRange(d)}
              className={`font-pixel text-[9px] tracking-wider px-3 py-1 rounded-full border ${
                dateRange === d
                  ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                  : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {d === 'today' ? 'TODAY' : d === 'week' ? 'THIS WEEK' : d === 'month' ? 'THIS MONTH' : 'ALL'}
            </button>
          ))}

          {/* Skill filter */}
          <select
            value={skillFilter}
            onChange={e => setSkillFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-pixel text-[9px] text-zinc-400"
          >
            <option value="">ALL SKILLS</option>
            {uniqueSkills.map(id => (
              <option key={id} value={id}>{skillDefinitions.find(s => s.id === id)?.name ?? id}</option>
            ))}
          </select>

          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search outputs..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded pl-7 pr-3 py-1 font-pixel text-[9px] text-zinc-300 placeholder-zinc-600"
            />
          </div>
        </div>
      </div>

      {/* Card Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Archive size={32} className="mx-auto text-zinc-700 mb-3" />
            <div className="font-pixel text-[10px] text-zinc-600 tracking-wider">NO ARTIFACTS YET</div>
            <div className="font-pixel text-[9px] text-zinc-700 tracking-wider mt-1">
              Completed skill executions will appear here
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(a => {
              const skill = skillDefinitions.find(s => s.id === a.skill_id);
              const SkillIcon = skill?.icon ?? Archive;
              return (
                <button
                  key={a.id}
                  onClick={() => setSelectedArtifact(a)}
                  className="text-left rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <SkillIcon size={14} className="text-emerald-400" />
                    <span className="font-pixel text-[10px] tracking-wider text-zinc-200 truncate">
                      {skill?.name ?? a.skill_id}
                    </span>
                  </div>
                  <div className="font-pixel text-[9px] text-zinc-500 line-clamp-3 leading-relaxed mb-2">
                    {a.result?.summary ?? a.result?.output?.slice(0, 150) ?? ''}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-pixel text-[8px] text-zinc-600">
                      {a.completed_at ? new Date(a.completed_at).toLocaleDateString() : ''}
                    </span>
                    <span className="font-pixel text-[8px] text-zinc-600">
                      ${a.cost_usd?.toFixed(4) ?? '0.00'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Add route to App.tsx**

```typescript
import CollateralView from './components/Collateral/CollateralView';

// In routes:
<Route path="/collateral" element={<CollateralView />} />
```

**Step 3: Add nav item to NavigationRail.tsx**

```typescript
import { Archive } from 'lucide-react';

// Add to navItems array (between Vault and Audit):
{ icon: Archive, label: 'Collateral', path: '/collateral' },
```

**Step 4: Commit**

```bash
git add src/components/Collateral/CollateralView.tsx src/App.tsx src/components/Layout/NavigationRail.tsx
git commit -m "feat: Collateral page — artifact browser with filters"
```

---

### Task 9: Financials — Real Data

**Files:**
- Modify: `src/components/Financials/FinancialsView.tsx`
- Modify: `src/lib/llmUsage.ts`

**Step 1: Add aggregation functions to llmUsage.ts**

```typescript
export async function getMonthlyUsage(): Promise<{ month: string; llmCost: number; channelCost: number }[]> {
  const { data: llm } = await getSupabase()
    .from('llm_usage')
    .select('created_at, estimated_cost');

  const { data: channels } = await getSupabase()
    .from('channel_usage')
    .select('created_at, cost');

  // Group by month
  const months: Record<string, { llm: number; channel: number }> = {};

  for (const row of llm ?? []) {
    const month = new Date(row.created_at).toISOString().slice(0, 7); // YYYY-MM
    months[month] = months[month] ?? { llm: 0, channel: 0 };
    months[month].llm += row.estimated_cost ?? 0;
  }

  for (const row of channels ?? []) {
    const month = new Date(row.created_at).toISOString().slice(0, 7);
    months[month] = months[month] ?? { llm: 0, channel: 0 };
    months[month].channel += row.cost ?? 0;
  }

  return Object.entries(months)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, costs]) => ({ month, llmCost: costs.llm, channelCost: costs.channel }));
}

export async function getCurrentMonthSpend(): Promise<{ llm: number; channel: number; total: number }> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: llm } = await getSupabase()
    .from('llm_usage')
    .select('estimated_cost')
    .gte('created_at', startOfMonth.toISOString());

  const { data: channels } = await getSupabase()
    .from('channel_usage')
    .select('cost')
    .gte('created_at', startOfMonth.toISOString());

  const llmTotal = (llm ?? []).reduce((s, r) => s + (r.estimated_cost ?? 0), 0);
  const channelTotal = (channels ?? []).reduce((s, r) => s + (r.cost ?? 0), 0);

  return { llm: llmTotal, channel: channelTotal, total: llmTotal + channelTotal };
}

export async function getAgentUsage(agentId: string): Promise<{ totalTokens: number; totalCost: number; taskCount: number }> {
  const { data } = await getSupabase()
    .from('llm_usage')
    .select('input_tokens, output_tokens, estimated_cost')
    .eq('agent_id', agentId);

  if (!data || data.length === 0) return { totalTokens: 0, totalCost: 0, taskCount: 0 };
  return {
    totalTokens: data.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0),
    totalCost: data.reduce((s, r) => s + r.estimated_cost, 0),
    taskCount: data.length,
  };
}
```

**Step 2: Rewrite FinancialsView.tsx to use real data**

Replace the dummy data imports with calls to `getMonthlyUsage()` and `getCurrentMonthSpend()`. Keep the existing UI structure (stat cards + bar chart + table) but wire in real numbers.

Key changes:
- Remove `import { financials } from '../../data/dummyData'`
- Load monthly data via `useEffect` calling `getMonthlyUsage()`
- Stat cards: budget from settings (already works), spent from `getCurrentMonthSpend()`
- Bar chart: real monthly bars from aggregated data
- Table: real rows with LLM Cost | Channel Cost | Total | Budget | Variance

**Step 3: Commit**

```bash
git add src/components/Financials/FinancialsView.tsx src/lib/llmUsage.ts
git commit -m "feat: Financials real data — llm_usage + channel_usage aggregates"
```

---

### Task 10: Agent & CEO Cost Hover Cards

**Files:**
- Modify: `src/components/Surveillance/AgentSprite.tsx`
- Modify: `src/components/Surveillance/SurveillanceView.tsx` (CEO sprite hover)

**Step 1: Add cost data to agent hover tooltip**

In AgentSprite.tsx, the existing hover tooltip shows agent name and status. Add cost info:

```typescript
import { getAgentUsage } from '../../lib/llmUsage';

// Inside AgentSprite, load cost on hover:
const [cost, setCost] = useState<{ totalCost: number; taskCount: number } | null>(null);

const handleMouseEnter = async () => {
  setHovered(true);
  const usage = await getAgentUsage(agent.id);
  setCost(usage);
};

// In tooltip render, add:
{cost && (
  <>
    <div>TASKS: {cost.taskCount}</div>
    <div>COST: ${cost.totalCost.toFixed(4)}</div>
  </>
)}
```

**Step 2: CEO hover card enhancement**

In SurveillanceView or CEOSprite, the CEO hover card should show:
- Name, archetype, philosophy
- Model being used
- Status (working/idle)
- Confidence (from CEO table if tracked)
- Cost so far: `getAgentUsage('ceo')`

```typescript
const [ceoCost, setCeoCost] = useState(0);
useEffect(() => {
  getAgentUsage('ceo').then(u => setCeoCost(u.totalCost));
}, []);

// In CEO hover card render:
<div>COST SO FAR: ${ceoCost.toFixed(2)}</div>
```

**Step 3: Commit**

```bash
git add src/components/Surveillance/AgentSprite.tsx src/components/Surveillance/SurveillanceView.tsx
git commit -m "feat: agent + CEO hover cards with cost tracking"
```

---

### Task 11: Vault — Notification Channels Section

**Files:**
- Modify: `src/components/Vault/VaultView.tsx`
- Modify: `src/lib/database.ts`

**Step 1: Add channel CRUD to database.ts**

```typescript
export interface ChannelRow {
  id: string;
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
  cost_per_unit: number;
  created_at?: string;
}

export async function loadChannels(): Promise<ChannelRow[]> {
  const { data } = await getSupabase()
    .from('notification_channels')
    .select('*')
    .order('created_at', { ascending: true });
  return (data ?? []) as ChannelRow[];
}

export async function saveChannel(channel: Partial<ChannelRow>): Promise<void> {
  await getSupabase().from('notification_channels').upsert(channel);
}

export async function deleteChannel(id: string): Promise<void> {
  await getSupabase().from('notification_channels').delete().eq('id', id);
}
```

**Step 2: Add Channels section to VaultView.tsx**

Below the existing API keys table, add a new section:

- "NOTIFICATION CHANNELS" header with "+ ADD CHANNEL" button
- List of channel cards: Email, Telegram, SMS, Voice
- Each shows type icon, status (COMING SOON or toggle), cost per unit
- "+ ADD CHANNEL" modal: select type, config fields (placeholder), cost per unit

For now, all channels show "COMING SOON" badge since adapters aren't implemented. The data layer is in place.

**Step 3: Add a 4th stat card to Vault header**

Current Vault has 3 stat boxes (Services, API Keys, Secrets). Add:

```
CHANNELS: {count} configured
```

**Step 4: Commit**

```bash
git add src/components/Vault/VaultView.tsx src/lib/database.ts
git commit -m "feat: Vault notification channels section (placeholder)"
```

---

## Verification

After each task:
- **Task 1**: `docker compose up -d` → `curl http://localhost:8000/functions/v1/health` returns `{"status":"ok"}`
- **Task 2**: Check Supabase Studio → notification_channels and channel_usage tables exist
- **Task 3**: `curl -X POST http://localhost:8000/functions/v1/execute-skill -d '{"task_execution_id":"test"}' -H 'Content-Type: application/json'` → returns error (expected: task not found, proving function runs)
- **Task 4**: Chat with CEO, mention "research competitors" → check `task_executions` table has new rows
- **Task 5**: In chat, CEO tool calls show as retro mission cards with live status
- **Task 6**: Complete a task → toast appears in bottom-right corner
- **Task 7**: Mission moves to review → green badge on Missions nav, click → see output + approve/redo
- **Task 8**: `/collateral` → shows completed task outputs, filters work, click → detail view
- **Task 9**: `/financials` → stat cards show real spend from llm_usage, bar chart shows real months
- **Task 10**: Hover agent in surveillance → see cost, hover CEO → see personality + cost
- **Task 11**: `/vault` → CHANNELS section visible, + ADD CHANNEL works, all show COMING SOON
