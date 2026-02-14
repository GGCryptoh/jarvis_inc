# LLM Reveal & Token Tracking Implementation Plan

> **STATUS: COMPLETED** — Shipped in Sprint 5 (Feb 2026)
>
> **What shipped:**
> - `MODEL_COSTS` map in `models.ts` — per-model input/output cost rates
> - `estimateCost()` function for cost estimation
> - `llm_usage` table (migration 004) — tracks all LLM calls
> - `src/lib/llmUsage.ts` — `logUsage()`, `getTotalUsage()`, `getAgentUsage()`, `getMonthlyUsage()`, `getCurrentMonthSpend()`
> - Usage logging wired into `chatService.ts` `onDone` callback
> - `StreamCallbacks.onDone` extended with usage data
> - `playOnlineJingle()` — digital system-connected chime
> - Model selector in skill approval card (OnboardingFlow)
> - LLM: ONLINE reveal animation (CRT flicker + typewriter + jingle)
> - Real-only LLM streaming in onboarding test (no scripted fallback)
> - Vault change listener for delayed reveal after API key added
>
> **All 8 tasks shipped. No deferred items.**

---

**Goal:** Make the "LLM: ONLINE" moment a cinematic reveal with real validation, add model selection to skill approval, replace scripted test with real LLM streaming, and track all token usage/costs.

**Architecture:** Enhance OnboardingFlow's approval card with model dropdown + key indicators. Add a reveal animation sequence (CRT flicker + typewriter + jingle) triggered after full validation. Replace scripted test fallback with real-only LLM streaming + retry. Add `llm_usage` table and logging wrapper around all LLM calls.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Web Audio API, Supabase (Postgres + JS client)

---

### Task 1: Cost Rates in models.ts — SHIPPED

`MODEL_COSTS` map with `[input, output]` per 1M tokens for all 12 models.
`estimateCost(model, inputTokens, outputTokens)` helper function.

**Key file:** `src/lib/models.ts`

---

### Task 2: llm_usage Table Migration — SHIPPED

**Key file:** `docker/supabase/migrations/004_llm_usage.sql`

Schema: `id, created_at, provider, model, input_tokens, output_tokens, total_tokens (generated), estimated_cost, context, mission_id, agent_id, conversation_id`

Context values: `'ceo_chat' | 'skill_execution' | 'memory_extraction' | 'conversation_summary'`

---

### Task 3: Usage Logging Service — SHIPPED

**Key file:** `src/lib/llmUsage.ts`

Functions:
- `logUsage(entry)` — inserts row with cost estimate
- `getTotalUsage()` — aggregate totals
- `getAgentUsage(agentId)` — per-agent stats
- `getMonthlyUsage()` — monthly aggregation for Financials
- `getCurrentMonthSpend()` — current month LLM + channel costs

Wired into `chatService.ts` — every CEO chat response logs usage.

---

### Task 4: Online Jingle — SHIPPED

**Key file:** `src/lib/sounds.ts`

`playOnlineJingle()` — 3-note ascending chime (F5 → A5 → C6) with high sparkle. Square wave + triangle wave, ~0.5s duration.

---

### Task 5: Model Selector in Skill Approval — SHIPPED

**Key file:** `src/components/Chat/OnboardingFlow.tsx`

Model dropdown in SingleSkillApproval card. Groups by service. Green dot for services with vault keys, lock for those without.

---

### Task 6: LLM: ONLINE Reveal Animation — SHIPPED

**Key files:**
- `src/components/Chat/OnboardingFlow.tsx` — reveal sequence state machine
- `src/index.css` — `llm-reveal-flicker`, `llm-reveal-slide`, `llm-reveal-glow` keyframes

Phases: `hidden → flicker → typing → done`

---

### Task 7: Real-Only LLM Streaming — SHIPPED

**Key file:** `src/components/Chat/OnboardingFlow.tsx`

Scripted test fallback (`generateTestResponse()`) removed. Onboarding test uses `streamCEOResponse()` with error retry instead.

---

### Task 8: Vault Change Listener — SHIPPED

**Key file:** `src/components/Chat/OnboardingFlow.tsx`

Listens for `approvals-changed` event. When API key is added from Vault page, triggers delayed LLM reveal automatically.

---

## Task Dependencies (all completed)

```
Task 1 (cost rates)     ← independent      ✓
Task 2 (migration)      ← independent      ✓
Task 3 (usage logging)  ← depends on 1 + 2 ✓
Task 4 (sound)          ← independent      ✓
Task 5 (model selector) ← independent      ✓
Task 6 (reveal)         ← depends on 4 + 5 ✓
Task 7 (real LLM test)  ← depends on 6     ✓
Task 8 (vault listener) ← depends on 6 + 7 ✓
```
