# LLM Reveal, Skill Validation & Token Tracking

## Overview

Enhance the chat onboarding flow so the "LLM: ONLINE" moment is a cinematic reveal after full validation (skill enabled + API key confirmed). Replace scripted test responses with real LLM streaming. Add model selection to skill approval. Track all LLM token usage for cost analysis.

---

## 1. Skill Approval Card Enhancement

The inline `SingleSkillApproval` card in onboarding gets a model selector:

- **Default model** pre-selected (from skill definition or CEO's configured model)
- **All 12 models** listed in a dropdown, grouped by service (Anthropic, OpenAI, Google, DeepSeek, xAI)
- **Key status indicators**: green dot = vault has API key for that service, lock icon = no key
- When user picks a model without a key, subtle note: "API key needed — you'll be prompted after approval"
- **APPROVE** saves the skill with the selected model
- After approve: if key missing → create `api_key_request` approval → prompt for key → reveal after key added
- After approve: if key exists → trigger reveal immediately

---

## 2. LLM: ONLINE Reveal Moment

Fires once all validation passes (skill enabled + API key confirmed in vault).

### Visual Sequence (~2 seconds)

1. **CRT flicker** (100ms) — reuse `.crt-flicker` CSS
2. **Badge slides in** from right with retro pixel-border emerald glow
3. **Sprite animation** — spinning gear or lightning bolt, pixel art, 3-4 frames
4. **Typewriter text**: `LLM: ONLINE` types out character by character (~400ms)

### Sound

New `playOnlineJingle()` in `sounds.ts`:
- Short ascending 3-note chime — "system ready" / modem-connect feel
- Square wave, 2-3 notes, ~0.5s total
- Different from existing `playSuccessJingle()` — shorter, more digital

### After Reveal

CEO types: "Systems connected. I can see the network now. Want to take it for a spin?"

---

## 3. Real LLM Test (No Scripted Fallback)

After reveal, the `testing_skill` stage uses **real LLM streaming only**:

- `streamCEOResponse()` with the user's query
- CEO system prompt already includes enabled skills with full command definitions (Sprint 5)
- Tokens stream in real-time with yellow pulsing cursor
- **No scripted fallback** — the point is validating the real pipeline
- **Error handling**: Inline error message "Connection interrupted — check your API key in The Vault" + retry button

---

## 4. Revised Onboarding Flow

```
... → acknowledging → waiting_skill_approve
                          │
                    Approval card:
                    • Skill name & description
                    • Model dropdown (all 12, key indicators)
                    • APPROVE / LATER
                          │
                    APPROVE clicked
                          │
                    Validate: skill saved, check vault
                          │
                    ┌─────┴─────┐
               key exists    no key
                    │          │
                    │    api_key_request approval
                    │    → vault prompt
                    │    → wait for key
                    │          │
                    ◄──────────┘
                          │
                    ═══ REVEAL ═══
                    CRT flicker → badge slide → typewriter → jingle
                    CEO: "Systems connected..."
                          │
                    waiting_test_input
                    CEO: "Want to take it for a spin?"
                          │
                    user types query → REAL LLM streaming
                    error → retry button (no fallback)
                          │
                    offering_research → ... → done
```

---

## 5. Token & Cost Tracking

### New Table: `llm_usage`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | `usage-{timestamp}-{random}` |
| created_at | TIMESTAMPTZ | Server default |
| provider | TEXT | Anthropic, OpenAI, Google, DeepSeek, xAI |
| model | TEXT | API model ID |
| input_tokens | INTEGER | Prompt tokens |
| output_tokens | INTEGER | Completion tokens |
| total_tokens | INTEGER | Sum |
| estimated_cost | REAL | USD, calculated from per-model rates |
| context | TEXT | `ceo_chat`, `skill_execution`, `memory_extraction`, `conversation_summary` |
| mission_id | TEXT NULL | FK to missions (when skill runs for a mission) |
| agent_id | TEXT NULL | FK to agents |
| conversation_id | TEXT NULL | FK to conversations |

### Cost Rates

Add `inputCostPer1M` and `outputCostPer1M` to model definitions in `models.ts`. Calculate: `(input_tokens / 1_000_000 * inputRate) + (output_tokens / 1_000_000 * outputRate)`.

### Capture Points

All LLM calls go through provider `stream()` functions. After `onDone`, extract usage from response and insert into `llm_usage`. Applies to:
- CEO chat responses (`chatService.ts`)
- Skill execution (`skillExecutor.ts`)
- Memory extraction (`memory.ts` → `callLLM()`)
- Conversation summarization (`memory.ts` → `summarizeOldMessages()`)

### Feeds Into

- **Dashboard**: Total spend KPI, cost per mission
- **Financials**: Budget vs actual, spend over time
- **Per-agent**: Cost attributed to agent's skill executions
