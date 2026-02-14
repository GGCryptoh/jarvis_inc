# PLAN: AI/ Folder Documentation Updates

> Created: 2026-02-13
> Purpose: Track which AI/*.md files need updating and mark them off as completed

## Summary

The codebase has evolved significantly (sql.js → Supabase, shipped scheduler/memory/skills execution) but many AI/ docs still describe the old architecture or mark shipped features as "planned."

---

## Update Tracker

| # | File | Status | Accuracy | Priority | Updated? |
|---|------|--------|----------|----------|----------|
| 1 | `Data-Layer.md` | ❌ Severely Outdated | ~20% | P1 | ☐ |
| 2 | `CEO-Agent-System.md` | ⚠️ Partially Outdated | ~50% | P1 | ☐ |
| 3 | `CEO-Designate.md` | ⚠️ Partially Outdated | ~65% | P1 | ☐ |
| 4 | `Skills-Architecture.md` | ⚠️ Partially Outdated | ~60% | P2 | ☐ |
| 5 | `CEO-Communication-Loop.md` | ⚠️ Partially Outdated | ~55% | P2 | ☐ |
| 6 | `Surveillance.md` | ⚠️ Partially Outdated | ~70% | P2 | ☐ |
| 7 | `Jarvis-Memory-Agent-Workspace-Architecture.md` | ⚠️ Partially Shipped | ~50% | P2 | ☐ |
| 8 | `CEO/CEO-Prompts.md` | ⚠️ Partially Outdated | ~60% | P3 | ☐ |
| 9 | `Chat-Onboarding-Flow.md` | ✅ Mostly Current | ~85% | P3 | ☐ |
| 10 | `Ceremonies.md` | ⚠️ Partially Outdated | ~75% | P3 | ☐ |
| 11 | `Skill-Execution-Pipeline.md` | ✅ Mostly Current | ~80% | P3 | ☐ |
| 12 | `Workspace-Gateway.md` | ❓ Needs Verification | ? | P4 | ☐ |
| 13 | `Approval-System.md` | ✅ Current | ~95% | — | ☐ |
| 14 | `LLM-Reveal-Token-Tracking.md` | ✅ Current | ~90% | — | ☐ |

### Non-architecture files (PLANs — historical, no update needed)
- `PLAN-SKILLS_REPO.md` — completed plan, archive
- `PLAN-SQLite_Removal.md` — completed plan, archive
- `PLAN-Skill-Execution-Pipeline.md` — completed plan, archive
- `PLAN-LLM-Reveal.md` — completed plan, archive
- `IDEAS-MissionControl.md` — ideas doc, review later

---

## Detailed Gap Analysis Per File

### 1. Data-Layer.md — ❌ SEVERELY OUTDATED (P1)
**Problem**: Entire doc describes sql.js as "current" and Supabase as "planned future."
- Still references sql.js singleton, WASM loading, IndexedDB persistence
- "Future Tables" section lists tables that are NOW LIVE (chat_messages, task_executions, org_memory, conversation_summaries, llm_usage)
- DataService interface section describes planned abstraction that was never built
- Table count says 8 but actual Supabase schema has 15+ tables

**Action**: Complete rewrite around Supabase backend:
- Document actual Supabase schema (all migration files in `docker/supabase/migrations/`)
- Document `src/lib/supabase.ts` client singleton
- Document `src/lib/database.ts` as Supabase-backed CRUD layer (~40 functions)
- Remove all sql.js/IndexedDB/WASM references
- Remove DataService interface (never implemented)

---

### 2. CEO-Agent-System.md — ⚠️ PARTIALLY OUTDATED (P1)
**Problem**: Claims scheduler, decision engine, task dispatcher are "not yet built" — they ARE shipped.
- `src/lib/ceoScheduler.ts` — shipped, uses Visibility API-aware setInterval
- `src/lib/ceoDecisionEngine.ts` — shipped, evaluates state → produces actions
- `src/lib/taskDispatcher.ts` — shipped, parses task plans and dispatches
- `src/lib/ceoActionQueue.ts` — NEW, not documented anywhere

**Action**:
- Update implementation status markers throughout
- Document actual scheduler (Option B: client-side setInterval)
- Document ceoActionQueue.ts
- Document taskDispatcher.ts task plan parsing
- Clarify Option E (Edge Function + pg_cron) is NOT the current approach

---

### 3. CEO-Designate.md — ⚠️ PARTIALLY OUTDATED (P1)
**Problem**: Internal contradictions — says archetypes are "SHIPPED" in header but "Future: Not yet implemented" in body.
- Need to verify actual state in CEOCeremony.tsx
- Personality prompt assembly in chatService.ts needs documenting

**Action**:
- Resolve contradictions
- Document actual personality config flow from CEOCeremony → DB → chatService prompt

---

### 4. Skills-Architecture.md — ⚠️ PARTIALLY OUTDATED (P2)
**Problem**: Missing entire execution pipeline that shipped.
- No mention of `skillResolver.ts` (three-layer merge: hardcoded UI + GitHub JSON + DB state)
- No mention of `skillExecutor.ts` (LLM provider execution, API calls, logging)
- No mention of `execution_handler` field mapping to API_HANDLERS registry
- No mention of `cliSkillHandlers.ts` (CLI-based execution handlers)
- No mention of SkillTestDialog component
- "Future: Runtime Resolution" is NOW shipped

**Action**:
- Document skillResolver.ts three-layer merge
- Document skillExecutor.ts execution flow
- Document execution_handler → API_HANDLERS mapping
- Document cliSkillHandlers.ts
- Document SkillTestDialog
- Update skills_repo submodule documentation

---

### 5. CEO-Communication-Loop.md — ⚠️ PARTIALLY OUTDATED (P2)
**Problem**: Claims proactive evaluation loop is "not yet built" — scheduler IS shipped.
- Chat persistence via conversations + chat_messages tables is LIVE
- Memory system integration not documented (CEO prompt includes memories)

**Action**:
- Mark scheduler and proactive loop as SHIPPED
- Update chat persistence section
- Document memory injection in CEO prompts
- Document actual prompt templates from chatService.ts

---

### 6. Surveillance.md — ⚠️ PARTIALLY OUTDATED (P2)
**Problem**: Missing new components, door animation status unclear.
- `QuickChatPanel.tsx` exists but not documented
- Door animation status contradicts itself
- Recent sprite animation updates not captured

**Action**:
- Add QuickChatPanel documentation
- Clarify door animation status
- Update sprite animation details from current AgentSprite.tsx/CEOSprite.tsx

---

### 7. Jarvis-Memory-Agent-Workspace-Architecture.md — ⚠️ PARTIALLY SHIPPED (P2)
**Problem**: Ambitious design doc, only memory portion is shipped.
- `org_memory` table + `memory.ts` — SHIPPED
- `conversation_summaries` table — SHIPPED
- pgvector embeddings — NOT shipped
- Agent delegation / Claude CLI executor / workspace filesystem — NOT shipped

**Action**:
- Mark shipped sections clearly
- Document actual memory.ts implementation
- Separate shipped vs aspirational sections

---

### 8. CEO/CEO-Prompts.md — ⚠️ PARTIALLY OUTDATED (P3)
**Problem**: Prompt templates are conceptual, don't match actual chatService.ts.
- Actual system prompt in chatService.ts includes memory injection, skill definitions, personality
- Task plan parsing uses `<task_plan>` blocks — not documented

**Action**:
- Extract actual system prompt structure from chatService.ts
- Document memory + skill injection format
- Document task_plan block parsing

---

### 9. Chat-Onboarding-Flow.md — ✅ MOSTLY CURRENT (P3)
**Minor gaps**:
- Doesn't document transition from onboarding to active LLM chat
- Missing RichResultCard.tsx documentation
- Missing ChatSidebar.tsx, ChatThread.tsx as separate components

**Action**: Minor additions for new chat components

---

### 10. Ceremonies.md — ⚠️ PARTIALLY OUTDATED (P3)
**Problem**: Door animation contradiction (says removed, then documents it extensively).

**Action**: Verify door animation status in code, resolve contradiction

---

### 11. Skill-Execution-Pipeline.md — ✅ MOSTLY CURRENT (P3)
**Minor gaps**:
- Edge Function implementation details may have evolved
- CollateralView.tsx now exists

**Action**: Minor verification pass

---

### 12. Workspace-Gateway.md — ❓ NEEDS VERIFICATION (P4)
**Question**: Is the gateway service actually in docker-compose.yml?

**Action**: Verify docker-compose.yml, update or mark as aspirational

---

### 13. Approval-System.md — ✅ CURRENT
No action needed.

---

### 14. LLM-Reveal-Token-Tracking.md — ✅ CURRENT
No action needed.

---

## Undocumented New Components

| File | Purpose | Should Go In |
|------|---------|-------------|
| `src/components/Chat/RichResultCard.tsx` | Rich skill execution results in chat | Chat-Onboarding-Flow.md |
| `src/components/Chat/ChatSidebar.tsx` | Conversation sidebar | Chat-Onboarding-Flow.md |
| `src/components/Chat/ChatThread.tsx` | Chat message thread | Chat-Onboarding-Flow.md |
| `src/components/Chat/OnboardingFlow.tsx` | Onboarding state machine | Chat-Onboarding-Flow.md |
| `src/components/Chat/ToolCallBlock.tsx` | Tool call rendering | Chat-Onboarding-Flow.md |
| `src/components/Missions/MissionDetailPage.tsx` | Mission detail/review view | New or CEO-Agent-System.md |
| `src/components/Surveillance/QuickChatPanel.tsx` | Quick chat in surveillance | Surveillance.md |
| `src/components/Collateral/CollateralView.tsx` | Artifact browser | Workspace-Gateway.md |
| `src/lib/ceoActionQueue.ts` | CEO action queue | CEO-Agent-System.md |
| `src/lib/cliSkillHandlers.ts` | CLI skill execution | Skills-Architecture.md |
| `src/lib/memory.ts` | Memory extraction + retrieval | Jarvis-Memory doc |
| `src/lib/ceoScheduler.ts` | CEO tick scheduler | CEO-Agent-System.md |
| `src/lib/taskDispatcher.ts` | Task plan dispatch | CEO-Agent-System.md |
| `src/lib/llmUsage.ts` | LLM token tracking | LLM-Reveal doc |

---

## Execution Plan

**Phase 1 — P1 Critical (3 files)**
1. Rewrite Data-Layer.md for Supabase
2. Update CEO-Agent-System.md with shipped components
3. Fix CEO-Designate.md contradictions

**Phase 2 — P2 Major Gaps (4 files)**
4. Update Skills-Architecture.md with execution pipeline
5. Update CEO-Communication-Loop.md with shipped scheduler
6. Update Surveillance.md with QuickChatPanel
7. Update Jarvis-Memory doc with shipped vs aspirational

**Phase 3 — P3 Minor Updates (4 files)**
8. Update CEO/CEO-Prompts.md with actual prompts
9. Update Chat-Onboarding-Flow.md with new components
10. Fix Ceremonies.md door animation contradiction
11. Verify Skill-Execution-Pipeline.md

**Phase 4 — P4 Verification (1 file)**
12. Verify Workspace-Gateway.md against docker-compose

**Phase 5 — Cleanup**
13. Review PLAN-*.md files — archive completed plans
14. Update CLAUDE.md file structure section
