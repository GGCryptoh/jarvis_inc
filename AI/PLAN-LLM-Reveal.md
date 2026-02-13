# LLM Reveal & Token Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the "LLM: ONLINE" moment a cinematic reveal with real validation, add model selection to skill approval, replace scripted test with real LLM streaming, and track all token usage/costs.

**Architecture:** Enhance OnboardingFlow's approval card with model dropdown + key indicators. Add a reveal animation sequence (CRT flicker + typewriter + jingle) triggered after full validation. Replace scripted test fallback with real-only LLM streaming + retry. Add `llm_usage` table and logging wrapper around all LLM calls.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Web Audio API, Supabase (Postgres + JS client)

---

### Task 1: Add cost rates to models.ts

**Files:**
- Modify: `src/lib/models.ts`

**Step 1: Add cost rates per model**

Add `MODEL_COSTS` map after `MODEL_API_IDS`:

```typescript
/** Cost per 1M tokens in USD: [input, output] */
export const MODEL_COSTS: Record<string, [number, number]> = {
  'Claude Opus 4.6':    [15, 75],
  'Claude Opus 4.5':    [15, 75],
  'Claude Sonnet 4.5':  [3, 15],
  'Claude Haiku 4.5':   [0.80, 4],
  'GPT-5.2':            [10, 30],
  'o3-pro':             [20, 80],
  'o4-mini':            [1.10, 4.40],
  'Gemini 3 Pro':       [1.25, 5],
  'Gemini 2.5 Flash':   [0.15, 0.60],
  'DeepSeek R1':        [0.55, 2.19],
  'Llama 3.3':          [0.60, 0.60],
  'Grok 4':             [3, 15],
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_COSTS[model] ?? [0, 0];
  return (inputTokens / 1_000_000 * rates[0]) + (outputTokens / 1_000_000 * rates[1]);
}
```

**Step 2: Commit**

```bash
git add src/lib/models.ts
git commit -m "feat: add per-model cost rates and estimateCost function"
```

---

### Task 2: Add llm_usage table migration

**Files:**
- Create: `docker/supabase/migrations/004_llm_usage.sql`

**Step 1: Write the migration**

```sql
-- Token usage tracking for all LLM calls
CREATE TABLE IF NOT EXISTS llm_usage (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  estimated_cost REAL NOT NULL DEFAULT 0,
  context TEXT NOT NULL CHECK (context IN ('ceo_chat', 'skill_execution', 'memory_extraction', 'conversation_summary')),
  mission_id TEXT,
  agent_id TEXT,
  conversation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_context ON llm_usage (context);
CREATE INDEX IF NOT EXISTS idx_llm_usage_mission ON llm_usage (mission_id) WHERE mission_id IS NOT NULL;

-- RLS
ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "llm_usage_anon_all" ON llm_usage FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "llm_usage_authenticated_all" ON llm_usage FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

**Step 2: Commit**

```bash
git add docker/supabase/migrations/004_llm_usage.sql
git commit -m "feat: add llm_usage table for token cost tracking"
```

---

### Task 3: Add usage logging to LLM types and providers

**Files:**
- Modify: `src/lib/llm/types.ts`
- Modify: `src/lib/llm/chatService.ts`
- Create: `src/lib/llmUsage.ts`

**Step 1: Extend StreamCallbacks with usage data**

In `src/lib/llm/types.ts`, add optional usage to `onDone`:

```typescript
export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: (fullText: string, usage?: { inputTokens: number; outputTokens: number }) => void;
  onError: (error: Error) => void;
}
```

**Step 2: Create llmUsage.ts service**

```typescript
import { getSupabase } from './supabase';
import { estimateCost } from './models';

export type UsageContext = 'ceo_chat' | 'skill_execution' | 'memory_extraction' | 'conversation_summary';

export interface UsageEntry {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  context: UsageContext;
  missionId?: string;
  agentId?: string;
  conversationId?: string;
}

export async function logUsage(entry: UsageEntry): Promise<void> {
  const cost = estimateCost(entry.model, entry.inputTokens, entry.outputTokens);
  const id = `usage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await getSupabase().from('llm_usage').insert({
    id,
    provider: entry.provider,
    model: entry.model,
    input_tokens: entry.inputTokens,
    output_tokens: entry.outputTokens,
    estimated_cost: cost,
    context: entry.context,
    mission_id: entry.missionId ?? null,
    agent_id: entry.agentId ?? null,
    conversation_id: entry.conversationId ?? null,
  });
}

export async function getTotalUsage(): Promise<{ totalTokens: number; totalCost: number }> {
  const { data } = await getSupabase()
    .from('llm_usage')
    .select('input_tokens, output_tokens, estimated_cost');
  if (!data || data.length === 0) return { totalTokens: 0, totalCost: 0 };
  return {
    totalTokens: data.reduce((sum, r) => sum + r.input_tokens + r.output_tokens, 0),
    totalCost: data.reduce((sum, r) => sum + r.estimated_cost, 0),
  };
}
```

**Step 3: Wire usage logging into streamCEOResponse**

In `src/lib/llm/chatService.ts`, wrap the provider.stream call to log usage in the onDone callback. Since providers don't return token counts yet, estimate from text length (rough: ~4 chars per token for input, exact count for output via text length).

**Step 4: Commit**

```bash
git add src/lib/llm/types.ts src/lib/llmUsage.ts src/lib/llm/chatService.ts
git commit -m "feat: add LLM usage tracking (llm_usage table + logUsage service)"
```

---

### Task 4: New sound — playOnlineJingle()

**Files:**
- Modify: `src/lib/sounds.ts`

**Step 1: Add the online jingle**

Add after `playWarMarch()`:

```typescript
/** Short "system connected" chime — 3 ascending notes, digital feel, ~0.5s */
export function playOnlineJingle() {
  try {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.20;
    master.connect(ctx.destination);

    // 3-note ascending chime: F5 → A5 → C6 (bright, digital)
    const notes = [
      { freq: 698, start: 0, dur: 0.12 },
      { freq: 880, start: 0.10, dur: 0.12 },
      { freq: 1047, start: 0.20, dur: 0.25 },
    ];

    for (const n of notes) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = n.freq;
      env.gain.setValueAtTime(0, ctx.currentTime + n.start);
      env.gain.linearRampToValueAtTime(0.6, ctx.currentTime + n.start + 0.02);
      env.gain.linearRampToValueAtTime(0, ctx.currentTime + n.start + n.dur);
      osc.connect(env);
      env.connect(master);
      osc.start(ctx.currentTime + n.start);
      osc.stop(ctx.currentTime + n.start + n.dur + 0.05);
    }

    // High sparkle on final note
    const sparkle = ctx.createOscillator();
    const sEnv = ctx.createGain();
    sparkle.type = 'triangle';
    sparkle.frequency.value = 2093; // C7
    sEnv.gain.setValueAtTime(0, ctx.currentTime + 0.22);
    sEnv.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.24);
    sEnv.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.45);
    sparkle.connect(sEnv);
    sEnv.connect(master);
    sparkle.start(ctx.currentTime + 0.22);
    sparkle.stop(ctx.currentTime + 0.50);

    setTimeout(() => ctx.close(), 600);
  } catch { /* silent fail */ }
}
```

**Step 2: Commit**

```bash
git add src/lib/sounds.ts
git commit -m "feat: add playOnlineJingle() — digital system-connected chime"
```

---

### Task 5: Enhance SingleSkillApproval with model selector

**Files:**
- Modify: `src/components/Chat/OnboardingFlow.tsx`

**Step 1: Add model dropdown to SingleSkillApproval**

Add these props to SingleSkillApproval:
- `models: { name: string; service: string; hasKey: boolean }[]`
- `selectedModel: string`
- `onModelChange: (model: string) => void`

Render a dropdown between the skill description and buttons:
- Grouped by service
- Green dot (●) for services with vault keys, lock icon for those without
- Default to CEO's model or skill's default model

**Step 2: Wire model state into OnboardingFlow**

Add state: `const [selectedModel, setSelectedModel] = useState('')`

On mount, load vault entries to determine which services have keys. Build model list with indicators.

Pass to SingleSkillApproval. On APPROVE, use selectedModel instead of hardcoded default.

**Step 3: Commit**

```bash
git add src/components/Chat/OnboardingFlow.tsx
git commit -m "feat: add model selector with key indicators to skill approval card"
```

---

### Task 6: LLM: ONLINE reveal animation

**Files:**
- Modify: `src/components/Chat/OnboardingFlow.tsx`
- Modify: `src/index.css` (add reveal keyframes)

**Step 1: Add CSS keyframes for reveal**

In `src/index.css`, add:

```css
@keyframes llm-reveal-flicker {
  0%, 100% { opacity: 1; }
  25% { opacity: 0.3; }
  50% { opacity: 0.8; }
  75% { opacity: 0.1; }
}

@keyframes llm-reveal-slide {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes llm-reveal-glow {
  0%, 100% { box-shadow: 0 0 8px rgba(16, 185, 129, 0.4); }
  50% { box-shadow: 0 0 20px rgba(16, 185, 129, 0.8), 0 0 40px rgba(16, 185, 129, 0.3); }
}

.llm-reveal-flicker {
  animation: llm-reveal-flicker 0.15s ease-in-out;
}

.llm-reveal-badge {
  animation: llm-reveal-slide 0.4s ease-out, llm-reveal-glow 1.5s ease-in-out infinite;
}
```

**Step 2: Add reveal sequence to OnboardingFlow**

Add state: `const [revealPhase, setRevealPhase] = useState<'hidden' | 'flicker' | 'typing' | 'done'>('hidden')`

Create `triggerLLMReveal()` async function:
1. Set revealPhase to `'flicker'` — applies CRT flicker CSS class to chat container
2. After 150ms → set to `'typing'` — badge appears with slide-in, text types character by character
3. Call `playOnlineJingle()`
4. After 500ms → set to `'done'` — badge stays with glow pulse
5. Set `llmEnabled = true`

**Step 3: Wire reveal into approval flow**

In `handleApproveSkill()`, after saving skill and confirming key exists:
- Instead of immediately typing "enabled and connected", call `triggerLLMReveal()`
- After reveal completes, CEO types: "Systems connected. I can see the network now. Want to take it for a spin?"
- Transition to `waiting_test_input`

If key is missing: skip reveal, create api_key_request, listen for vault changes. When key is added (via `approvals-changed` event), THEN trigger reveal.

**Step 4: Commit**

```bash
git add src/components/Chat/OnboardingFlow.tsx src/index.css
git commit -m "feat: cinematic LLM:ONLINE reveal — flicker + typewriter + jingle"
```

---

### Task 7: Replace scripted test with real-only LLM streaming

**Files:**
- Modify: `src/components/Chat/OnboardingFlow.tsx`

**Step 1: Update testing_skill phase**

Replace the current 3-path logic (LLM success / LLM error / no LLM) with:

```typescript
} else if (step === 'waiting_test_input') {
  setMessages(prev => [...prev, { id: `msg-${Date.now()}`, sender: 'user', text }]);
  setInput('');
  setStep('testing_skill');

  const controller = await streamCEOResponse(text, [], {
    onToken: (token) => {
      setTyping(false);
      setStreamingText(prev => (prev ?? '') + token);
    },
    onDone: (fullText) => {
      setStreamingText(null);
      setTyping(false);
      addCeoMessage(fullText);
      offerMarketResearch();
    },
    onError: (error) => {
      setStreamingText(null);
      setTyping(false);
      // Show error with retry — NO scripted fallback
      addCeoMessage(`Connection interrupted: ${error.message}\n\nCheck your API key in The Vault and try again.`);
      setStep('waiting_test_input'); // Allow retry
      setTimeout(() => inputRef.current?.focus(), 100);
    },
  });

  if (controller) {
    abortRef.current = controller;
    setTyping(true);
  } else {
    // This shouldn't happen since we validated the key in reveal
    addCeoMessage('LLM connection lost. Head to The Vault to check your API key, then come back and try again.');
    setStep('waiting_test_input');
  }
  return;
```

**Step 2: Remove generateTestResponse function**

Delete the `generateTestResponse()` helper — it's no longer used.

**Step 3: Commit**

```bash
git add src/components/Chat/OnboardingFlow.tsx
git commit -m "feat: real-only LLM streaming in onboarding test — no scripted fallback"
```

---

### Task 8: Wire vault change listener for delayed reveal

**Files:**
- Modify: `src/components/Chat/OnboardingFlow.tsx`

**Step 1: Add vault listener**

When key is missing after approve, the flow creates an `api_key_request` approval and waits. Add a listener for when the user adds the key from the Vault page:

```typescript
// Listen for vault changes (key added from Vault page)
useEffect(() => {
  if (step !== 'waiting_skill_approve' || !needsApprovalNav) return;

  const checkVault = async () => {
    const service = MODEL_SERVICE_MAP[selectedModel];
    if (!service) return;
    const entry = await getVaultEntryByService(service);
    if (entry) {
      // Key was added! Trigger the reveal
      await triggerLLMReveal();
      await typeWithDelay(
        'Systems connected. I can see the network now. Want to take it for a spin?',
        2000,
      );
      setStep('waiting_test_input');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handler = () => checkVault();
  window.addEventListener('approvals-changed', handler);
  return () => window.removeEventListener('approvals-changed', handler);
}, [step, needsApprovalNav, selectedModel]);
```

**Step 2: Commit**

```bash
git add src/components/Chat/OnboardingFlow.tsx
git commit -m "feat: vault change listener — delayed LLM reveal after API key added"
```

---

## Task Dependencies

```
Task 1 (cost rates)     ← independent
Task 2 (migration)      ← independent
Task 3 (usage logging)  ← depends on Task 1 + 2
Task 4 (sound)          ← independent
Task 5 (model selector) ← independent
Task 6 (reveal)         ← depends on Task 4 + 5
Task 7 (real LLM test)  ← depends on Task 6
Task 8 (vault listener) ← depends on Task 6 + 7
```

Tasks 1, 2, 4, 5 can run in parallel. Then 3 + 6. Then 7 + 8.
