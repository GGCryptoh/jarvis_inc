# Jarvis Inc — Memory, Agent Orchestration & Workspace Architecture

> Design reference for the full Founder <-> CEO <-> Agent stack: memory layers,
> mission delegation, inter-agent coordination, and filesystem workspaces.

---

## Implementation Status

| Section | Status | Notes |
|---------|--------|-------|
| **A) Organizational Memory** | SHIPPED | `org_memory`, `conversation_summaries`, `mission_memory` tables live. `memory.ts` provides CRUD + LLM extraction. Memory injected into CEO system prompt. |
| **B) CEO -> Agent Task Construction** | ASPIRATIONAL | `mission_briefs` table not built. Actual delegation uses `<task_plan>` XML blocks parsed by `taskDispatcher.ts` — much simpler. |
| **C) Inter-Agent Coordination** | ASPIRATIONAL | No `delegations` table, no `agent_collaborators` table, no multi-agent collaboration. Agents don't communicate with each other. |
| **D) Mission Storage & Agent Registry** | PARTIAL | `agent_skills` table exists and is used. `agent_collaborators` does not exist. Mission schema is simpler than proposed (no `parent_mission`, `tags`, `workspace_path`, etc.). |
| **E) Coding Agent Workspace** | ASPIRATIONAL | No `/jarvis-workspace/` filesystem, no `execute-claude-cli` skill, no Docker sidecar. See `AI/Workspace-Gateway.md` for a separate (also unbuilt) design. |

---

## A) Organizational Memory (The Business Brain) — SHIPPED

The business has **three tiers of memory**, all backed by Supabase Postgres.

### Tier 1: Institutional Memory (Long-Term, Org-Wide)

This is the "company knowledge base" — persists across all missions and conversations.

**Actual schema** (from `003_memory_and_autonomy.sql`):

```sql
CREATE TABLE org_memory (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL DEFAULT 'fact',  -- 'fact', 'decision', 'preference', 'insight', 'reminder', 'founder_profile'
  content     TEXT NOT NULL,                  -- the memory text
  source      TEXT DEFAULT NULL,              -- conversation_id, mission_id, or 'system'
  tags        TEXT[] DEFAULT '{}',            -- searchable tags (Postgres array, not TEXT[])
  importance  INTEGER NOT NULL DEFAULT 5,     -- 1-10 scale (NOT "confidence", NOT REAL)
  embedding   VECTOR(1536) DEFAULT NULL,      -- pgvector column EXISTS in schema but is NOT populated or queried
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ DEFAULT NULL        -- column exists but is NOT used by application code
);

CREATE INDEX idx_org_memory_category ON org_memory(category);
CREATE INDEX idx_org_memory_importance ON org_memory(importance DESC);
CREATE INDEX idx_org_memory_tags ON org_memory USING GIN(tags);
CREATE INDEX idx_org_memory_updated ON org_memory(updated_at DESC);
```

**Key differences from original design:**
- `importance` is INTEGER 1-10, not `confidence` REAL 0.0-1.0
- `embedding` column exists in the DDL but is **never populated** — semantic search is not implemented
- `expires_at` column exists in DDL but is never read or written by application code
- `tags` is `TEXT[]` (Postgres array) — works with `overlaps()` queries
- 6 categories (not 5): `fact`, `decision`, `preference`, `insight`, `reminder`, `founder_profile`
- IDs are generated as `mem-${Date.now()}-${random}` strings, not UUIDs

**What goes here:**
- Founder profile details ("The founder lives in Philadelphia", "Founder prefers TypeScript") — category: `founder_profile`, importance 8-10
- Founder preferences ("Always use React", "Prefers detailed status updates") — category: `preference`
- Business decisions ("We chose Supabase over Firebase") — category: `decision`
- Key facts about the org, goals, constraints — category: `fact`
- Strategic insights from conversations — category: `insight`
- Action items and reminders — category: `reminder`

**Who writes:**
- **CEO** — after every meaningful conversation with the founder, `extractMemories()` runs via LLM to pull out key facts/decisions/preferences
- **System** — auto-captures via memory extraction pipeline

**Who reads:**
- **CEO** — loads top 20 memories (by importance, then recency) into system prompt on every chat message
- **Task Dispatcher** — injects founder profile + relevant memories into task execution context

### memory.ts — Shipped Functions

Source: `src/lib/memory.ts` (398 lines)

| Function | Description |
|----------|-------------|
| `saveMemory(memory)` | Upsert to `org_memory`. Generates ID if not provided. Default importance: 5. |
| `getMemories(limit=50)` | Fetches recent memories ordered by `updated_at DESC`. |
| `getMemoriesByCategory(category, limit=50)` | Filtered fetch by category. |
| `getMemoriesByTags(tags, limit=50)` | Filtered fetch using `overlaps()` on tags array. |
| `queryMemories(text, limit=20)` | **Text-based search using ILIKE** — splits text into keywords, matches any keyword against `content`. Ordered by importance DESC, then updated_at DESC. **NOT semantic/pgvector search.** |
| `deleteMemory(id)` | Removes a memory by ID. |
| `extractMemories(messages, conversationId)` | LLM-based extraction from conversation (see below). |
| `summarizeOldMessages(conversationId, messages)` | LLM-based conversation summarization. Triggers when >50 messages; summarizes oldest 30 into a `conversation_summaries` row. |
| `saveConversationSummary(...)` | Inserts a summary row into `conversation_summaries`. |
| `getConversationSummaries(conversationId)` | Fetches summaries for a conversation, ordered by `created_at`. |

### Memory Extraction Flow

`extractMemories()` is called after meaningful conversations. The flow:

1. **Load CEO archetype** — extraction prompt adapts to CEO personality (e.g., Wall Street focuses on financial targets; MIT Engineer focuses on technical decisions)
2. **Format conversation** — messages formatted as `[SENDER]: text`
3. **LLM call** — system prompt asks for JSON array of `{category, content, tags, importance}`
4. **Parse response** — handles markdown code blocks, validates JSON array
5. **Deduplication** — loads existing 200 memories, checks for exact match or substring containment:
   - If duplicate found with lower importance: bumps existing memory's importance
   - If duplicate found with equal/higher importance: skips
6. **Save new memories** — each validated, non-duplicate memory saved via `saveMemory()`
7. **Batch dedup** — newly saved memories added to dedup list to prevent intra-batch duplicates

**Archetype-aware extraction** (`ARCHETYPE_FOCUS` map in memory.ts):
- `wharton_mba` — market positioning, competitive strategy, ROI
- `wall_street` — financial targets, cost concerns, risk/reward
- `mit_engineer` — technical decisions, architecture choices, optimization
- `sv_founder` — product-market fit, shipping velocity, growth metrics
- `beach_bum` — work-life balance, sustainable pace, long-term vision
- `military_cmd` — mission objectives, operational constraints, contingency planning
- `creative_dir` — design preferences, aesthetic choices, quality standards
- `professor` — evidence-based decisions, analytical frameworks, research priorities

### Memory Injection in CEO System Prompt

The CEO system prompt (built in `chatService.ts` `buildSystemPrompt()`) includes two memory sections:

**Founder Profile section** — always included, assembled from `founder_profile` category memories:
```
## Founder Profile
You know the following about {founderName}:
- The founder lives in Philadelphia
- The founder prefers TypeScript and React
- The founder likes detailed status updates
Use this knowledge naturally in all interactions. Reference it when relevant.
```

**Organizational Memory section** — top 20 general memories sorted by importance DESC, then recency:
```
## Organizational Memory
You have the following memories from past interactions and decisions:
- [decision] We chose Supabase over Firebase (tags: database, infrastructure)
- [preference] Founder prefers dropdown + Other pattern for selections (tags: ui, ux)
- [fact] Primary product is a B2B SaaS platform (tags: product, strategy)
```

If no memories exist yet, placeholder text encourages the CEO to pay attention to details shared by the founder.

### Tier 2: Conversation Memory (Session + Cross-Session)

**Shipped tables:**

```sql
-- Shipped in earlier migration
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  participant TEXT NOT NULL,
  status      TEXT DEFAULT 'active',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chat_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  sender          TEXT NOT NULL,
  text            TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Shipped in 003_memory_and_autonomy.sql
CREATE TABLE conversation_summaries (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  summary         TEXT NOT NULL,
  message_range   JSONB NOT NULL,  -- { "from_id": "...", "to_id": "...", "count": N }
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Context window management** (actual implementation):

The CEO system prompt is assembled in `chatService.ts` with this structure:

```
┌─────────────────────────────────────────────────────┐
│  SYSTEM PROMPT (~2-4K tokens)                       │
│  Personality + Philosophy + Risk + Role definition  │
├─────────────────────────────────────────────────────┤
│  FOUNDER PROFILE — founder_profile memories         │
│  Always included, high priority                     │
├─────────────────────────────────────────────────────┤
│  ORG MEMORY — top 20 by importance (~1-3K tokens)   │
│  Keyword text search, NOT pgvector similarity       │
├─────────────────────────────────────────────────────┤
│  ACTIVE STATE (~1-3K tokens)                        │
│  Missions, agents, approvals, budget, skill status  │
├─────────────────────────────────────────────────────┤
│  CONVERSATION HISTORY                               │
│  Recent messages raw + older summarized             │
├─────────────────────────────────────────────────────┤
│  CURRENT USER MESSAGE                               │
└─────────────────────────────────────────────────────┘
```

**Sliding window with summarization** (shipped via `summarizeOldMessages`):
- When conversation exceeds 50 messages, summarize oldest 30 into a `conversation_summaries` row
- Summaries prepended as context blocks
- LLM-powered summarization using CEO's configured model

### Tier 3: Mission Memory (Task-Scoped)

**Shipped table** (from `003_memory_and_autonomy.sql`):

```sql
CREATE TABLE mission_memory (
  id          TEXT PRIMARY KEY,
  mission_id  TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  lesson      TEXT NOT NULL,
  outcome     TEXT NOT NULL DEFAULT 'neutral',  -- success, failure, neutral
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

This table exists but is not heavily used in current application code — lessons learned extraction is not yet automated.

---

## B) CEO -> Agent Task Construction — ASPIRATIONAL (Not Yet Built)

> **Current implementation:** Task delegation uses a much simpler approach via `taskDispatcher.ts`.
> The CEO emits `<task_plan>` XML blocks in its chat responses, which are parsed into missions
> and `task_executions` rows. There is no `mission_briefs` table. See "Actual Task Execution Flow"
> below for what's shipped.

### Actual Task Execution Flow (Shipped)

Source: `src/lib/taskDispatcher.ts`

1. CEO chat response contains `<task_plan>` or `<tool_call>` XML blocks
2. `parseTaskPlan()` extracts `{title, toolCalls[{name, arguments}]}` from the XML
3. `dispatchTaskPlan()` creates:
   - A `missions` row (status: `in_progress`)
   - A `task_executions` row per tool call (status: `pending`)
4. `buildTaskContext()` assembles context for each task:
   - Founder profile memories (from `org_memory` where category = `founder_profile`)
   - Relevant org memories via `queryMemories()` keyword search
   - Last 10 conversation messages (truncated)
5. Dispatches to Supabase Edge Function (`execute-skill`) with browser-side fallback
6. Edge Function calls provider APIs directly using vault-stored API keys
7. Results written back to `task_executions`, mission moves to `review` or `done`
8. For multi-task missions: `synthesizeMissionSummary()` generates a unified report via LLM
9. CEO posts completion summary to chat with action cards

### Aspirational: Mission Brief Schema (Not Built)

The original design proposed a `mission_briefs` table for structured delegation packages:

```sql
-- NOT BUILT — aspirational design
CREATE TABLE mission_briefs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id      UUID REFERENCES missions(id),
  agent_id        UUID REFERENCES agents(id),
  objective       TEXT NOT NULL,
  context         TEXT NOT NULL,
  constraints     JSONB DEFAULT '{}',
  deliverables    JSONB DEFAULT '[]',
  tools_approved  TEXT[] DEFAULT '{}',
  agents_approved TEXT[] DEFAULT '{}',
  org_context     TEXT,
  prior_work      TEXT,
  founder_prefs   TEXT,
  status          TEXT DEFAULT 'assigned',
  conversation_id UUID REFERENCES conversations(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

This would enable the CEO to build rich context packages per agent per mission, including curated org memories, founder preferences, and pre-approved tool/collaborator lists. The current `<task_plan>` approach is functional but lacks this level of structure.

---

## C) Inter-Agent Coordination & Approval — ASPIRATIONAL (Not Yet Built)

> **Current state:** Agents do not communicate with each other. All task execution flows through
> the CEO. There is no `delegations` table, no `agent_collaborators` table, and no multi-agent
> collaboration protocol.

### Aspirational: Three Delegation Models

#### Model 1: CEO Pre-Approved (Mission-Level)

The CEO grants delegation authority upfront in the mission brief.

```json
{
  "agents_approved": ["agent-scout-001", "agent-forge-002"],
  "delegation_budget": 5000,
  "delegation_rules": "pre_approved"
}
```

The lead agent can directly call approved collaborators without CEO intervention.

#### Model 2: CEO Approval Required (Per-Request)

The agent must request delegation through the CEO.

```
Agent -> CEO: "I need SCOUT to research React vs Next.js for this project."
CEO evaluates availability, budget, and relevance.
CEO -> SCOUT: [Creates sub-mission brief]
SCOUT -> CEO: [Results]
CEO -> Agent: "Here's what SCOUT found: {results}"
```

#### Model 3: Autonomous Mesh (Aggressive Risk Tolerance)

For founders with aggressive risk tolerance, the CEO grants broad delegation with escalation thresholds.

### Aspirational: Delegation Protocol

```sql
-- NOT BUILT
CREATE TABLE delegations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_brief_id UUID REFERENCES mission_briefs(id),
  child_brief_id  UUID REFERENCES mission_briefs(id),
  requesting_agent UUID REFERENCES agents(id),
  target_agent    UUID REFERENCES agents(id),
  status          TEXT DEFAULT 'requested',
  reason          TEXT NOT NULL,
  approved_by     TEXT,
  tokens_budget   INT,
  tokens_used     INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### Communication Flow (Aspirational)

```
Founder <-> CEO <-> Lead Agent <-> Sub-Agents
   |                    |              |
   |  (chat/approvals)  |  (mission    |  (sub-mission
   |                    |   briefs)    |   briefs)
   |                    |              |
   +-- org_memory ------+-- mission ---+-- task results
                            memory         feed back up
```

Key principle: **Agents never talk directly to the founder.** Everything routes through the CEO. The CEO is the single point of accountability.

---

## D) Mission Storage & Agent Tool/Collaborator Registry — PARTIAL

### Agent Skills Table — SHIPPED

```sql
-- Shipped in 003_memory_and_autonomy.sql
CREATE TABLE agent_skills (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id    TEXT NOT NULL,
  assigned_by TEXT NOT NULL DEFAULT 'ceo',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, skill_id)
);
```

This table is actively used: the CEO assigns specific skills to specific agents. The HireAgentModal includes a skill picker that writes to this table.

### Agent Collaborators Table — NOT BUILT

```sql
-- NOT BUILT — aspirational
CREATE TABLE agent_collaborators (
  agent_id        UUID REFERENCES agents(id),
  collaborator_id UUID REFERENCES agents(id),
  relationship    TEXT DEFAULT 'peer',
  granted_by      TEXT DEFAULT 'ceo',
  created_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (agent_id, collaborator_id)
);
```

### Mission Schema — Simpler Than Proposed

The actual `missions` table is simpler than the extended schema originally proposed. It does **not** include:
- `parent_mission` (no sub-mission hierarchy)
- `tags` (TEXT[] array)
- `context_notes`
- `token_budget` / `cost_limit` / `deadline`
- `deliverables` (JSONB)
- `outcome_summary` / `lessons_learned`
- `workspace_path`

Task-level tracking happens in the `task_executions` table instead, which captures skill execution, tokens used, cost, and results per individual tool call.

---

## E) Coding Agent Workspace — ASPIRATIONAL (Not Yet Built)

> **Current state:** There is no `/jarvis-workspace/` filesystem, no `execute-claude-cli` skill,
> no Docker sidecar for CLI execution, and no workspace permissions/safety system.
>
> A separate design document — `AI/Workspace-Gateway.md` — covers a related but distinct approach
> to workspace management: Docker gateway service with artifact serving, CLI execution, dynamic
> nginx for web apps, and port registry. That design is also not yet built.

### Aspirational: Workspace Structure

```
/jarvis-workspace/
├── missions/                         # One dir per mission
│   ├── coding/
│   │   └── webapp/
│   │       └── app1/                 # Agent works here
│   │           ├── .jarvis/          # Jarvis metadata
│   │           └── ...               # Whatever the agent builds
│   ├── research/
│   └── design/
├── shared/                           # Cross-mission shared resources
│   ├── templates/
│   ├── configs/
│   └── libraries/
└── .jarvis-global/                   # System-level metadata
```

### Aspirational: The `execute_claude_cli` Skill

A skill that wraps Claude CLI invocations, allowing the coding agent to drive Claude Code as a tool for file creation, testing, and iteration. The agent plans and reviews; Claude CLI handles the actual coding.

### Aspirational: Workspace Permissions & Safety

Sandbox policy with path isolation per mission, read-only access to shared resources, forbidden system paths, network access controls, and process/memory/disk limits.

---

## Aspirational: Full Flow Example (Future Vision)

This demonstrates how all sections would work together once fully implemented:

```
FOUNDER: "I need a web app that tracks my flight training hours and
          expenses. Simple dashboard, login, CRUD for flights."

CEO (Opus 4.6):
  +- Queries org_memory: "founder is a pilot", "prefers React + TypeScript"
  +- Creates mission: "Flight Training Tracker Web App"
  +- Creates workspace: /missions/coding/webapp/flight-tracker/
  +- Selects FORGE (coding agent, Sonnet 4.5)
  +- Pre-approves tools: [execute-claude-cli, research-web, browse-web]
  +- Pre-approves agents: [SCOUT for research if needed]
  +- Builds mission brief with curated org context + founder preferences
  +- Sends structured brief to FORGE

FORGE executes:
  +- Claude CLI: scaffold project
  +- Claude CLI: build auth flow
  +- Claude CLI: build flight CRUD
  +- QUESTION -> CEO: "Dropdown or free text for aircraft type?"
  |   CEO (checks org_memory, no preference) -> Founder
  |   Founder: "Dropdown with common types + 'Other' free text"
  |   CEO saves to org_memory: "Founder prefers dropdown + Other pattern"
  |   CEO -> FORGE: answer
  +- Claude CLI: build dashboard with charts
  +- Claude CLI: write tests
  +- FORGE -> CEO: "Done. 52 files, all tests passing."

CEO -> Founder: "FORGE completed the flight tracker!
  [VIEW FILES] [RUN LOCALLY] [MISSION REPORT]
  Total cost: $3.47 in API tokens."
```

---

## Implementation Priority

| Phase | What | Status | Notes |
|-------|------|--------|-------|
| **1** | `org_memory` table + CEO memory extraction after chats | DONE | Shipped in Sprint 3. `memory.ts` provides full CRUD + LLM extraction with dedup. |
| **2** | Memory injection in CEO system prompt | DONE | Founder Profile + Org Memory sections in `chatService.ts`. |
| **3** | Conversation summarization pipeline | DONE | `summarizeOldMessages()` in `memory.ts`. |
| **4** | `mission_briefs` table + CEO brief assembly | NOT STARTED | Current approach uses simpler `<task_plan>` XML blocks via `taskDispatcher.ts`. |
| **5** | Claude CLI executor (Docker sidecar) | NOT STARTED | See `AI/Workspace-Gateway.md` for related design work. |
| **6** | Workspace filesystem + `.jarvis/` metadata | NOT STARTED | Depends on Phase 5. |
| **7** | Agent question -> CEO -> Founder flow | NOT STARTED | Interactive decision routing during task execution. |
| **8** | `delegations` table + inter-agent protocol | NOT STARTED | Multi-agent collaboration. |
| **9** | pgvector embeddings on org_memory | NOT STARTED | Column exists in schema but never populated. Would replace ILIKE keyword search with semantic similarity. |

---

## Key Architectural Decisions

1. **CEO is always the router.** Agents never bypass the CEO. This gives you a single audit point and lets the CEO learn from every interaction.

2. **Memory is write-many, read-curated.** The CEO curates what goes into agent prompts via `buildTaskContext()`. Prevents context pollution.

3. **Text search is good enough for now.** ILIKE keyword matching on `org_memory.content` works well at the current scale. pgvector semantic search is a future upgrade path — the column exists, just needs population and query functions.

4. **Memory extraction is personality-aware.** The CEO's archetype influences what gets extracted from conversations. A Wall Street CEO notices financial details; an MIT Engineer notices technical decisions.

5. **Deduplication prevents memory bloat.** `extractMemories()` checks for exact matches and substring containment before saving, and bumps importance on re-encountered facts.

6. **Questions bubble up, answers flow down.** Agent -> CEO -> Founder for questions. Founder -> CEO -> Agent for answers. CEO can short-circuit if it has enough context (risk tolerance permitting). *(Aspirational — not yet implemented for agent tasks.)*

7. **Org memory compounds.** Every meaningful conversation triggers memory extraction. Over time, the CEO builds a rich understanding of the founder's preferences, decisions, and organizational context.
