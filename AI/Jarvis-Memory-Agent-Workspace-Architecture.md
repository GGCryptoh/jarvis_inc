# Jarvis Inc — Memory, Agent Orchestration & Workspace Architecture

> Design reference for the full Founder ↔ CEO ↔ Agent stack: memory layers,
> mission delegation, inter-agent coordination, and filesystem workspaces.

---

## A) Organizational Memory (The Business Brain)

The business needs **three tiers of memory**, all backed by Supabase Postgres.

### Tier 1: Institutional Memory (Long-Term, Org-Wide)

This is the "company knowledge base" — persists across all missions and conversations.

```sql
CREATE TABLE org_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT NOT NULL,        -- 'decision', 'preference', 'fact', 'lesson_learned', 'context'
  content     TEXT NOT NULL,        -- Natural language memory
  source      TEXT NOT NULL,        -- 'founder', 'ceo', 'agent:{id}', 'system'
  confidence  REAL DEFAULT 1.0,     -- 0.0–1.0, decays or gets reinforced
  tags        TEXT[] DEFAULT '{}',  -- searchable tags
  embedding   VECTOR(1536),         -- pgvector for semantic search
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ DEFAULT NULL  -- NULL = permanent
);

-- Semantic search index
CREATE INDEX idx_org_memory_embedding ON org_memory USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_org_memory_tags ON org_memory USING gin (tags);
CREATE INDEX idx_org_memory_category ON org_memory (category);
```

**What goes here:**
- Founder preferences ("I prefer React over Vue", "Always use TypeScript")
- Business decisions ("We chose Supabase over Firebase on 2026-02-10")
- Learned patterns ("The founder prefers detailed status updates over summaries")
- Org context ("Our primary product is a B2B SaaS platform")
- CEO observations ("Founder tends to approve aggressive timelines")

**Who writes:**
- **CEO** — after every meaningful conversation with the founder, the CEO extracts and persists key facts/decisions
- **Agents** — surface findings that have org-wide relevance (CEO reviews before committing)
- **System** — auto-captures settings changes, skill enables, hires

**Who reads:**
- **CEO** — loads relevant memories into system prompt context on every evaluation tick
- **Agents** — CEO injects relevant org memories into agent task prompts (curated, not raw access)

### Tier 2: Conversation Memory (Session + Cross-Session)

Already partially designed in your `conversations` + `chat_messages` tables. Extend:

```sql
-- Already shipped (keep as-is)
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT,
  participant TEXT NOT NULL,        -- 'founder', 'agent:{id}'
  status      TEXT DEFAULT 'active', -- 'active', 'archived', 'summarized'
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id),
  sender          TEXT NOT NULL,    -- 'ceo', 'user', 'system', 'agent:{id}'
  role            TEXT NOT NULL,    -- 'user', 'assistant', 'system' (for LLM context)
  content         TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}',
  token_count     INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- NEW: Conversation summaries for long-running threads
CREATE TABLE conversation_summaries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id),
  summary         TEXT NOT NULL,
  messages_start  UUID REFERENCES chat_messages(id),
  messages_end    UUID REFERENCES chat_messages(id),
  token_count     INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

**Context window management strategy:**

The CEO (Opus 4.6 with 200K context) assembles its working context like this on every tick:

```
┌─────────────────────────────────────────────────────┐
│  SYSTEM PROMPT (~2K tokens)                         │
│  Personality + Philosophy + Risk + Role definition  │
├─────────────────────────────────────────────────────┤
│  ORG MEMORY — Semantic top-K (~2-4K tokens)         │
│  Retrieved via pgvector similarity to current topic │
├─────────────────────────────────────────────────────┤
│  ACTIVE STATE (~1-3K tokens)                        │
│  Missions, agents, approvals, budget, skill status  │
├─────────────────────────────────────────────────────┤
│  CONVERSATION HISTORY (~10-50K tokens)              │
│  Recent messages raw + older summarized             │
├─────────────────────────────────────────────────────┤
│  CURRENT USER MESSAGE                               │
└─────────────────────────────────────────────────────┘
```

**Sliding window with summarization:**
- Keep last N messages verbatim (tunable, ~50 messages or ~30K tokens)
- When window fills, CEO generates a summary of the oldest chunk → saves to `conversation_summaries`
- Summaries are prepended as `[PREVIOUS CONTEXT]` blocks
- CEO never lies about not remembering — it says "let me check our records" and queries

### Tier 3: Mission Memory (Task-Scoped)

See section D below — each mission gets its own memory context.

---

## B) CEO → Agent Task Construction

When the CEO decides to delegate work, it builds a **mission brief** — a structured package the agent receives as its full context.

### Mission Brief Schema

```sql
CREATE TABLE mission_briefs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id      UUID REFERENCES missions(id),
  agent_id        UUID REFERENCES agents(id),
  
  -- Context the CEO assembles
  objective       TEXT NOT NULL,        -- What to accomplish
  context         TEXT NOT NULL,        -- Background, why this matters
  constraints     JSONB DEFAULT '{}',   -- Budget, time, quality bars
  deliverables    JSONB DEFAULT '[]',   -- Expected outputs
  tools_approved  TEXT[] DEFAULT '{}',  -- Skill IDs the agent can use
  agents_approved TEXT[] DEFAULT '{}',  -- Agent IDs this agent can call (see section C)
  
  -- CEO-curated memory injection
  org_context     TEXT,                 -- Relevant org memories, pre-summarized by CEO
  prior_work      TEXT,                 -- Summary of related past missions
  founder_prefs   TEXT,                 -- Relevant founder preferences
  
  -- Execution state
  status          TEXT DEFAULT 'assigned', -- 'assigned','in_progress','blocked','review','done','failed'
  
  -- Conversation with the agent
  conversation_id UUID REFERENCES conversations(id),
  
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

### How the CEO Builds It

```
CEO Evaluation Tick
  │
  ├─ 1. Identify mission needing work
  │
  ├─ 2. Select best agent (or recommend hire)
  │     └─ Based on: agent skills, current load, model capability, cost tier
  │
  ├─ 3. Query org_memory for relevant context
  │     └─ Semantic search: mission title + description → top-K memories
  │
  ├─ 4. Check founder preferences
  │     └─ "Founder prefers TypeScript", "Founder wants detailed progress updates"
  │
  ├─ 5. Review prior related missions
  │     └─ Query completed missions with similar tags/keywords
  │
  ├─ 6. Assemble mission brief
  │     └─ Structured JSON with all context, constraints, approved tools
  │
  ├─ 7. Determine approval needs
  │     └─ Risk tolerance matrix: auto-approve or ask founder?
  │
  └─ 8. Create conversation + send initial message to agent
        └─ "Here's your mission brief. Execute using {tools}. Report back when done."
```

### Agent System Prompt (Built by CEO)

```
You are {agent_name}, a {role} at {org_name}.
Your CEO is {ceo_name}. You report directly to the CEO.

MISSION BRIEF:
{objective}

CONTEXT:
{org_context}
{prior_work}

FOUNDER PREFERENCES:
{founder_prefs}

CONSTRAINTS:
- Budget: max {token_budget} tokens (${cost_limit})
- Deadline: {deadline or "none specified"}
- Quality bar: {quality_notes}

AVAILABLE TOOLS:
{for each tool_id in tools_approved:
  - {tool.title}: {tool.description}
    Commands: {tool.commands[].name} — {tool.commands[].description}
}

AVAILABLE COLLABORATORS:
{for each agent_id in agents_approved:
  - {agent.name} ({agent.role}): Can help with {agent.skills}
    To request their help, use the delegate_task command.
}

RULES:
1. Stay within your approved tools. If you need a tool you don't have, ask the CEO.
2. Stay within budget. If you're approaching the limit, pause and report.
3. If you encounter something unexpected, report to the CEO before proceeding.
4. When done, provide results in the specified deliverable format.
5. {if agents_approved is empty: "Do NOT attempt to delegate. Work solo."}
   {else: "You may delegate subtasks to approved collaborators. You are responsible for the final deliverable."}
```

---

## C) Inter-Agent Coordination & Approval

### Three Delegation Models

#### Model 1: CEO Pre-Approved (Mission-Level)

The CEO grants delegation authority upfront in the mission brief.

```json
// In mission_briefs.agents_approved
{
  "agents_approved": ["agent-scout-001", "agent-forge-002"],
  "delegation_budget": 5000,  // tokens the lead agent can spend on delegates
  "delegation_rules": "pre_approved"
}
```

The lead agent can directly call approved collaborators without CEO intervention. Used for well-understood workflows where the CEO trusts the lead agent's judgment.

**Example:** CEO assigns ARCHITECT a web app mission, pre-approves FORGE (coding) and SCOUT (research) as collaborators. ARCHITECT can delegate freely within budget.

#### Model 2: CEO Approval Required (Per-Request)

The agent must request delegation through the CEO.

```json
{
  "agents_approved": [],
  "delegation_rules": "request_approval"
}
```

When the agent needs help:

```
Agent → CEO: "I need SCOUT to research React vs Next.js for this project. 
              Estimated cost: ~2000 tokens. Reason: I need framework comparison 
              data before making architecture decisions."

CEO evaluates:
  - Is SCOUT available?
  - Is the budget sufficient?
  - Does this make sense for the mission?
  
CEO → Agent: "Approved. SCOUT will research and report back to you."
CEO → SCOUT: [Creates sub-mission brief with narrowed scope]
SCOUT → CEO: [Results]
CEO → Agent: "Here's what SCOUT found: {results}"
```

#### Model 3: Autonomous Mesh (Aggressive Risk Tolerance)

For founders who set aggressive risk tolerance, the CEO can grant broad delegation:

```json
{
  "agents_approved": ["*"],  // all agents
  "delegation_budget": 50000,
  "delegation_rules": "autonomous",
  "escalation_threshold": 10000  // only ask CEO if subtask > this many tokens
}
```

### Delegation Protocol (Technical)

```sql
CREATE TABLE delegations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_brief_id UUID REFERENCES mission_briefs(id),  -- who's delegating
  child_brief_id  UUID REFERENCES mission_briefs(id),  -- the sub-mission
  requesting_agent UUID REFERENCES agents(id),
  target_agent    UUID REFERENCES agents(id),
  status          TEXT DEFAULT 'requested', -- 'requested','approved','rejected','in_progress','done'
  reason          TEXT NOT NULL,
  approved_by     TEXT,  -- 'ceo', 'pre_approved', 'autonomous'
  tokens_budget   INT,
  tokens_used     INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### Communication Flow

```
Founder ←→ CEO ←→ Lead Agent ←→ Sub-Agents
   │                    │              │
   │  (chat/approvals)  │  (mission    │  (sub-mission
   │                    │   briefs)    │   briefs)
   │                    │              │
   └── org_memory ──────┴── mission ───┴── task results
                            memory         feed back up
```

Key principle: **Agents never talk directly to the founder.** Everything routes through the CEO. The CEO is the single point of accountability.

Exception: The founder can view any agent's conversation history (read-only surveillance), and in the future could @mention an agent in CEO chat to bring them into the conversation.

---

## D) Mission Storage & Agent Tool/Collaborator Registry

### Mission Schema (Extended)

```sql
CREATE TABLE missions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'backlog',
  -- 'backlog','planning','assigned','in_progress','review','done','failed','paused'
  
  priority        TEXT NOT NULL DEFAULT 'medium',
  assignee        UUID REFERENCES agents(id),
  parent_mission  UUID REFERENCES missions(id),  -- for sub-missions
  
  -- Mission memory
  tags            TEXT[] DEFAULT '{}',
  context_notes   TEXT,                -- CEO's notes about this mission
  
  -- Constraints
  token_budget    INT,
  cost_limit      REAL,
  deadline        TIMESTAMPTZ,
  
  -- Results
  deliverables    JSONB DEFAULT '[]',
  outcome_summary TEXT,
  lessons_learned TEXT,                -- CEO writes this post-completion → feeds org_memory
  
  -- Workspace
  workspace_path  TEXT,                -- e.g., '/missions/coding/webapp/app1'
  
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Mission-scoped memory (things learned DURING this mission)
CREATE TABLE mission_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id  UUID REFERENCES missions(id),
  content     TEXT NOT NULL,
  author      TEXT NOT NULL,          -- 'ceo' or 'agent:{id}'
  type        TEXT DEFAULT 'note',    -- 'note','decision','blocker','finding','question'
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### Agent Capability Registry

```sql
-- What tools/skills each agent has access to (set by CEO)
CREATE TABLE agent_skills (
  agent_id    UUID REFERENCES agents(id),
  skill_id    TEXT REFERENCES skills(id),
  granted_by  TEXT DEFAULT 'ceo',
  granted_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (agent_id, skill_id)
);

-- What agents can collaborate with whom (standing permissions)
CREATE TABLE agent_collaborators (
  agent_id        UUID REFERENCES agents(id),
  collaborator_id UUID REFERENCES agents(id),
  relationship    TEXT DEFAULT 'peer',  -- 'peer', 'subordinate', 'specialist'
  granted_by      TEXT DEFAULT 'ceo',
  created_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (agent_id, collaborator_id)
);
```

### How the CEO Resolves "What Can This Agent Do?"

```typescript
async function buildAgentCapabilities(agentId: string, missionId: string) {
  // 1. Agent's standing skills
  const skills = await db.query(
    `SELECT s.* FROM agent_skills as2 
     JOIN skills s ON s.id = as2.skill_id 
     WHERE as2.agent_id = $1 AND s.enabled = true`, [agentId]
  );
  
  // 2. Agent's standing collaborators
  const collaborators = await db.query(
    `SELECT a.* FROM agent_collaborators ac 
     JOIN agents a ON a.id = ac.collaborator_id 
     WHERE ac.agent_id = $1`, [agentId]
  );
  
  // 3. Mission-specific overrides (from mission_briefs)
  const brief = await db.query(
    `SELECT tools_approved, agents_approved FROM mission_briefs 
     WHERE mission_id = $1 AND agent_id = $2`, [missionId, agentId]
  );
  
  // Mission brief overrides standing permissions (union, not intersection)
  return {
    tools: union(skills, brief.tools_approved),
    collaborators: union(collaborators, brief.agents_approved),
  };
}
```

---

## E) Coding Agent Workspace — Filesystem & Claude CLI Integration

This is the most exciting part. The coding agent gets a **sandboxed filesystem workspace** and uses **Claude CLI** (claude code) as its execution engine.

### Workspace Structure

```
/jarvis-workspace/                    # Root (Docker volume or host mount)
├── missions/                         # One dir per mission
│   ├── coding/
│   │   ├── webapp/
│   │   │   ├── app1/                 # ← Agent works here
│   │   │   │   ├── .jarvis/          # Jarvis metadata (agent can read, shouldn't modify)
│   │   │   │   │   ├── mission.json  # Mission brief snapshot
│   │   │   │   │   ├── agent.json    # Assigned agent info
│   │   │   │   │   └── log.jsonl     # Execution log (appended by wrapper)
│   │   │   │   ├── package.json      # Agent creates this
│   │   │   │   ├── src/              # Agent creates this
│   │   │   │   └── ...               # Whatever the agent builds
│   │   │   └── app2/
│   │   └── api-service/
│   │       └── v1/
│   ├── research/
│   │   └── market-analysis-q1/
│   │       ├── .jarvis/
│   │       ├── report.md
│   │       └── sources.json
│   └── design/
│       └── logo-concepts/
├── shared/                           # Cross-mission shared resources
│   ├── templates/
│   ├── configs/                      # Shared .env templates, docker-compose bases
│   └── libraries/                    # Internal shared code
└── .jarvis-global/                   # System-level metadata
    ├── workspace-config.json
    └── agent-sessions.jsonl
```

### Coding Agent Execution Model

The coding agent doesn't write code directly through LLM responses. Instead, it **drives Claude CLI** as a tool, which handles the actual coding, file creation, testing, and iteration.

```
CEO assigns mission to FORGE (Coding Agent)
  │
  ├─ 1. CEO creates workspace: /missions/coding/webapp/app1/
  │     └─ Writes .jarvis/mission.json with brief
  │
  ├─ 2. CEO sends task to FORGE via mission brief
  │     "Build a React web app with auth. Use Claude CLI. Workspace: /missions/coding/webapp/app1/"
  │
  ├─ 3. FORGE has the `execute_claude_cli` skill
  │     └─ This skill wraps `claude` CLI invocations
  │
  ├─ 4. FORGE plans the work, then executes:
  │
  │     execute_claude_cli({
  │       workspace: "/missions/coding/webapp/app1/",
  │       prompt: "Initialize a new React + TypeScript + Vite project with Tailwind CSS.
  │                Set up the basic folder structure with src/components, src/hooks, src/lib.
  │                Create a basic App.tsx with routing using react-router-dom.",
  │       mode: "yolo",           // ← auto-approve all file operations
  │       timeout_minutes: 10,
  │       token_budget: 50000
  │     })
  │
  ├─ 5. Claude CLI runs in the workspace, creates files, runs npm, etc.
  │     └─ Output streamed back to FORGE
  │
  ├─ 6. FORGE reviews output, plans next step
  │     └─ May run multiple Claude CLI invocations sequentially
  │
  ├─ 7. FORGE encounters a decision point:
  │     "The app needs a database. Should I use Docker Supabase or Supabase Cloud?"
  │
  │     FORGE → CEO: "Decision needed: The web app requires a Supabase instance.
  │                    Options:
  │                    A) Docker (local, free, you control it)
  │                    B) Supabase Cloud (managed, needs account + API keys)
  │                    C) SQLite for now (simplest, migrate later)
  │                    Recommendation: Docker for dev, Cloud for prod."
  │
  │     CEO → Founder: [Action card in chat with A/B/C buttons]
  │     Founder → CEO: "Docker"
  │     CEO → FORGE: "Use Docker Supabase. Here's the standard docker-compose from /shared/configs/"
  │
  ├─ 8. FORGE continues with Claude CLI...
  │
  └─ 9. FORGE → CEO: "Mission complete. Web app running at localhost:5173.
                       Files: 47 created, 0 errors. Test coverage: 82%.
                       Deliverable: /missions/coding/webapp/app1/"
```

### The `execute_claude_cli` Skill

```json
{
  "id": "execute-claude-cli",
  "title": "Execute Claude CLI",
  "description": "Run Claude Code (claude CLI) in a sandboxed workspace to write, test, and iterate on code",
  "category": "creation",
  "connection_type": "cli",
  "cli_config": {
    "binary": "claude",
    "requires": ["node >= 18", "claude-cli >= 1.0"],
    "sandbox": true
  },
  "commands": [
    {
      "name": "execute",
      "description": "Run a Claude CLI coding session in a workspace directory",
      "parameters": [
        { "name": "workspace", "type": "string", "required": true, "description": "Absolute path to the workspace directory" },
        { "name": "prompt", "type": "string", "required": true, "description": "Natural language instructions for what to build/modify" },
        { "name": "mode", "type": "string", "required": false, "default": "yolo", "description": "'yolo' (auto-approve all), 'cautious' (pause on destructive ops), 'plan_only' (output plan, don't execute)" },
        { "name": "context_files", "type": "array", "required": false, "description": "Additional files to include as context (e.g., design docs, API specs)" },
        { "name": "timeout_minutes", "type": "number", "required": false, "default": 15 },
        { "name": "token_budget", "type": "number", "required": false, "default": 50000 },
        { "name": "model", "type": "string", "required": false, "default": "claude-sonnet-4-5-20250929", "description": "Model for CLI to use (can be cheaper than the agent's own model)" }
      ],
      "returns": {
        "type": "object",
        "description": "Execution result with files_created, files_modified, stdout, stderr, exit_code, tokens_used, cost"
      }
    },
    {
      "name": "review",
      "description": "Ask Claude CLI to review existing code in the workspace",
      "parameters": [
        { "name": "workspace", "type": "string", "required": true },
        { "name": "focus", "type": "string", "required": false, "description": "What to focus the review on (e.g., 'security', 'performance', 'architecture')" }
      ],
      "returns": { "type": "object", "description": "Review findings with severity, file, line, suggestion" }
    }
  ]
}
```

### Execution Wrapper (Supabase Edge Function or Docker Sidecar)

The actual Claude CLI doesn't run in the browser. It runs server-side:

```typescript
// supabase/functions/claude-cli-executor/index.ts
// OR: docker sidecar service

interface CLIRequest {
  workspace: string;
  prompt: string;
  mode: 'yolo' | 'cautious' | 'plan_only';
  timeout_minutes: number;
  token_budget: number;
  model: string;
  context_files?: string[];
}

async function executeCLI(req: CLIRequest): Promise<CLIResult> {
  // 1. Validate workspace path is within /jarvis-workspace/missions/
  if (!req.workspace.startsWith('/jarvis-workspace/missions/')) {
    throw new Error('Workspace must be within /jarvis-workspace/missions/');
  }
  
  // 2. Ensure directory exists
  await fs.mkdir(req.workspace, { recursive: true });
  
  // 3. Build claude CLI command
  const args = [
    '--print',                              // non-interactive
    '--output-format', 'json',              // structured output
    '--max-turns', '50',                    // limit iterations
    '--model', req.model,
    '--allowedTools', getAllowedTools(req.mode),
  ];
  
  if (req.mode === 'yolo') {
    args.push('--dangerously-skip-permissions');
  }
  
  // 4. Execute with timeout
  const result = await execWithTimeout(
    'claude', [...args, req.prompt],
    { cwd: req.workspace, timeout: req.timeout_minutes * 60 * 1000 }
  );
  
  // 5. Log execution
  await appendLog(req.workspace, {
    timestamp: new Date().toISOString(),
    prompt: req.prompt,
    tokens_used: result.tokens,
    cost: result.cost,
    files_changed: result.files,
    exit_code: result.exitCode
  });
  
  return result;
}
```

### Interactive Questions (Agent ↔ CEO ↔ Founder)

When the coding agent hits a decision point it can't resolve autonomously:

```
┌─────────────────────────────────────────────────────────┐
│  FORGE encounters: "Need a database choice"             │
│                                                         │
│  1. FORGE creates a QUESTION in mission_memory:         │
│     type='question', content='Need DB: Docker/Cloud/SQLite'│
│                                                         │
│  2. FORGE pauses execution, reports to CEO               │
│                                                         │
│  3. CEO evaluates:                                      │
│     - Can I answer this myself? (check org_memory)      │
│     - Does the founder have a stated preference?        │
│     - Is this within my risk tolerance to decide?       │
│                                                         │
│  4a. CEO decides autonomously (if has enough context):  │
│      CEO → FORGE: "Use Docker, here's the config."      │
│      CEO → Founder (async): "FYI, told FORGE to use     │
│      Docker for App1's database."                       │
│                                                         │
│  4b. CEO escalates to founder:                          │
│      CEO → Founder: [Action card in chat]               │
│      "FORGE needs a decision on App1's database..."     │
│      [DOCKER] [SUPABASE CLOUD] [SQLITE FOR NOW]         │
│                                                         │
│  5. Answer flows back: Founder → CEO → FORGE            │
│     CEO saves decision to org_memory for future ref     │
│                                                         │
│  6. FORGE resumes execution with the answer             │
└─────────────────────────────────────────────────────────┘
```

### Workspace Permissions & Safety

```yaml
# Workspace isolation rules
workspace_policy:
  # Agents can ONLY write within their assigned mission workspace
  allowed_write_paths:
    - /jarvis-workspace/missions/{mission_id}/**
  
  # Agents can READ shared resources
  allowed_read_paths:
    - /jarvis-workspace/shared/**
    - /jarvis-workspace/missions/{mission_id}/**
  
  # NEVER writable
  forbidden_paths:
    - /jarvis-workspace/.jarvis-global/**
    - /jarvis-workspace/missions/*/. jarvis/**  # metadata is read-only to agents
    - /etc/**
    - /home/**
  
  # Network access (for npm install, pip install, etc.)
  network:
    allowed: true
    blocked_domains: []  # CEO can restrict per-mission
  
  # Process limits
  limits:
    max_processes: 10
    max_memory_mb: 2048
    max_disk_mb: 5120
    max_runtime_minutes: 30
```

---

## Putting It All Together — Full Flow Example

```
FOUNDER: "I need a web app that tracks my flight training hours and 
          expenses. Simple dashboard, login, CRUD for flights."

CEO (Opus 4.6):
  ├─ Queries org_memory: "founder is a pilot", "prefers React + TypeScript"
  ├─ Creates mission: "Flight Training Tracker Web App"
  ├─ Creates workspace: /missions/coding/webapp/flight-tracker/
  ├─ Selects FORGE (coding agent, Sonnet 4.5 — good balance of speed/cost)
  ├─ Pre-approves tools: [execute-claude-cli, research-web, browse-web]
  ├─ Pre-approves agents: [SCOUT for research if needed]
  ├─ Builds mission brief with:
  │   org_context: "Founder is a pilot, uses this for personal flight tracking"
  │   founder_prefs: "React + TypeScript, prefers Tailwind, likes clean UI"
  │   constraints: { token_budget: 200000, cost_limit: 5.00 }
  │   deliverables: ["Working React app", "README.md", "docker-compose.yml"]
  │
  └─ CEO → Founder: "I'm assigning FORGE to build your flight tracker.
     Tech stack: React + TypeScript + Tailwind + Supabase (Docker).
     Estimated cost: ~$3-5 in API tokens. FORGE will work in YOLO mode
     and check in with me if any big decisions come up. I'll keep you posted."

FORGE executes:
  ├─ Claude CLI: scaffold project
  ├─ Claude CLI: build auth flow  
  ├─ Claude CLI: build flight CRUD
  ├─ QUESTION → CEO: "Should flight entries include aircraft type dropdown 
  │   or free text? Dropdown is cleaner but needs a seed list."
  │   CEO (checks org_memory, finds no preference) → Founder
  │   Founder: "Dropdown with common types + 'Other' free text"
  │   CEO saves to org_memory: "Founder prefers dropdown + Other pattern for selections"
  │   CEO → FORGE: "Dropdown with common aircraft types + 'Other' with free text"
  ├─ Claude CLI: build dashboard with charts
  ├─ Claude CLI: write tests
  └─ FORGE → CEO: "Done. 52 files, all tests passing."

CEO → Founder: "FORGE completed the flight tracker! 
  [VIEW FILES] [RUN LOCALLY] [MISSION REPORT]
  Total cost: $3.47 in API tokens.
  Want me to have FORGE add any features?"
```

---

## Implementation Priority

| Phase | What | Why First |
|-------|------|-----------|
| **1** | `org_memory` table + CEO memory extraction after chats | Foundation — everything else builds on this |
| **2** | `mission_briefs` table + CEO brief assembly | Enables structured delegation |
| **3** | Claude CLI executor (Docker sidecar) | Unlocks the coding agent |
| **4** | Workspace filesystem + `.jarvis/` metadata | Gives coding agent a home |
| **5** | Agent question → CEO → Founder flow | Interactive decision routing |
| **6** | `delegations` table + inter-agent protocol | Multi-agent collaboration |
| **7** | pgvector embeddings on org_memory | Semantic memory retrieval |
| **8** | Conversation summarization pipeline | Long-running context management |

---

## Key Architectural Decisions

1. **CEO is always the router.** Agents never bypass the CEO. This gives you a single audit point and lets the CEO learn from every interaction.

2. **Memory is write-many, read-curated.** Everyone can contribute memories, but the CEO curates what goes into agent prompts. Prevents context pollution.

3. **Workspaces are disposable sandboxes.** If a mission goes sideways, delete the workspace. The mission metadata in Postgres survives.

4. **Claude CLI is the coding primitive.** The coding agent doesn't generate code in its own responses — it drives Claude CLI, which is purpose-built for coding. The agent focuses on planning, reviewing, and decision-making.

5. **Questions bubble up, answers flow down.** Agent → CEO → Founder for questions. Founder → CEO → Agent for answers. CEO can short-circuit if it has enough context (risk tolerance permitting).

6. **Org memory compounds.** Every mission completion triggers a CEO "lessons learned" extraction. Over time, the org gets smarter — the CEO knows the founder's patterns, the agents benefit from accumulated context.
