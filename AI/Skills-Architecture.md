# Skills Architecture — Design Reference

> Committed project documentation. Defines the skill system — from JSON definitions
> to the UI toggle grid, skill recommendation engine, and CEO-driven agent assignment model.

---

## Overview

A **skill** is a declarative capability descriptor. Skills define *what* an agent can do (search the web, send email, generate code) but not *how* — the runtime interprets the skill definition to route agent tasks to the correct backend/API.

Skills are **not globally available** to all agents. The CEO assigns specific skills per agent based on role and task requirements.

---

## Skill Definition (Local)

### SkillDefinition Interface

```typescript
// src/data/skillDefinitions.ts
interface SkillDefinition {
  id: string;                                          // kebab-case unique ID
  name: string;                                        // Human-readable title
  description: string;                                 // What the skill does
  icon: React.ElementType;                             // Lucide icon component
  category: 'communication' | 'research' | 'creation' | 'analysis';
  status: 'available' | 'coming_soon';
  serviceType: 'llm' | 'fixed';                       // How it connects
  fixedService?: string;                               // e.g., 'Google', 'OpenAI'
  defaultModel?: string;                               // e.g., 'Claude Opus 4.6'
}
```

### Service Types

| Type | Meaning | Auth Method |
|------|---------|-------------|
| `llm` | Powered by user-selected LLM | API key for the model's service |
| `fixed` | Hardwired to specific service | OAuth or API key for that service |

### Connection Resolution

```typescript
function getRequiredService(skill, model): string | null {
  if (skill.serviceType === 'fixed') return skill.fixedService;  // e.g., 'Google'
  if (model) return getServiceForModel(model);                    // e.g., 'Anthropic'
  return null;
}
```

---

## All 18 Skills

### Communication (4)

| ID | Name | Status | Service | Icon |
|----|------|--------|---------|------|
| `read-email` | Read Email | available | Google (fixed) | Mail |
| `write-email` | Write Email | available | Google (fixed) | Send |
| `send-slack` | Send Slack Message | coming_soon | — | MessageCircle |
| `schedule-meeting` | Schedule Meeting | coming_soon | — | Calendar |

### Research (6)

| ID | Name | Status | Service | Icon |
|----|------|--------|---------|------|
| `research-web` | Research Web | available | LLM | Globe |
| `read-tweets` | Read X / Tweets | available | LLM | Twitter |
| `research-reddit` | Research Reddit | available | LLM | Rss |
| `deep-search` | Deep Search | coming_soon | — | Search |
| `browse-web` | Browse Web | available | LLM | Monitor |
| `web-scraping` | Web Scraping | available | LLM | ScanSearch |

### Creation (4)

| ID | Name | Status | Service | Icon |
|----|------|--------|---------|------|
| `create-images` | Create Images | available | OpenAI (fixed) | Image |
| `generate-video` | Generate Video | coming_soon | OpenAI (fixed) | Video |
| `write-document` | Write Document | available | LLM | FileText |
| `generate-code` | Generate Code | available | LLM | Code |

### Analysis (4)

| ID | Name | Status | Service | Icon |
|----|------|--------|---------|------|
| `analyze-data` | Analyze Data | coming_soon | — | BarChart3 |
| `analyze-image` | Analyze Image | available | LLM | Eye |
| `summarize-document` | Summarize Document | available | LLM | BookOpen |
| `translate-text` | Translate Text | available | LLM | Languages |

---

## Skills Page (SkillsView)

Grid of skill cards grouped by category. Each card shows:
- Skill icon, name, description
- Status badge (available / coming_soon)
- Toggle switch to enable/disable
- Model selector dropdown (for LLM skills)

Toggles write to `skills` table via `saveSkill(id, enabled, model)`.

When enabling a skill that requires a service without a vault key, an `api_key_request` approval is created automatically.

---

## Skill Recommender

### File: `src/lib/skillRecommender.ts`

Keyword-based matching against the founder's mission text.

```typescript
const KEYWORD_MAP: [RegExp, string[]][] = [
  [/logo|image|design|visual/i, ['create-images', 'research-web']],
  [/email|mail|inbox/i, ['read-email', 'write-email']],
  [/tweet|twitter|social/i, ['read-tweets', 'research-web']],
  // ... more patterns
  [/research|search|find/i, ['research-web']],  // broad catch-all, last
];
```

- Always includes `research-web` as a baseline
- Only recommends skills with `status !== 'coming_soon'`
- Returns deduplicated skill ID array
- Used during CEO onboarding chat to suggest first skill

---

## Skills Database Table

```sql
CREATE TABLE IF NOT EXISTS skills (
  id         TEXT PRIMARY KEY,        -- matches skillDefinition.id
  enabled    INTEGER NOT NULL DEFAULT 0,
  model      TEXT DEFAULT NULL,       -- selected LLM model (null for fixed service)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### CRUD

```typescript
loadSkills(): SkillRow[]
saveSkill(id: string, enabled: boolean, model: string | null): void
updateSkillModel(id: string, model: string | null): void
```

---

## Skill-Agent Assignment Model

### Flow

1. **Founder enables skills org-wide** — Skills page toggles
2. **CEO checks enabled skills** during evaluation cycle
3. **CEO requests more** — if a mission needs a disabled skill, CEO asks founder to enable it
4. **CEO assigns skill IDs per agent** — stored in `agents.skills` (JSON array)
5. **Agent's system prompt** lists only assigned skills as callable tools
6. **CEO's task prompt** tells the agent which specific skills to use for that task

### Agent Schema Extension

```sql
ALTER TABLE agents ADD COLUMN skills TEXT DEFAULT '[]';
-- Example: '["research-web", "write-document", "summarize-document"]'
```

### Prompt Templates

**Agent system prompt**:
```
You are {agent_name}, a {role} at {org_name}.
Your CEO is {ceo_name}. Report results back to the CEO.

You have access to the following tools:
{for each assigned skill: title - description, commands: [...]}

Do NOT attempt to use tools not listed above.
If you need a tool you don't have, report this to the CEO.
```

**CEO → Agent task prompt**:
```
Task: {task_description}
Context: {context}
Use these tools: {specific_skill_ids_for_this_task}
Expected output: {output_format}
```

---

## Seed Skills Repository

External GitHub repo: `https://github.com/GGCryptoh/jarvis_inc_skills`

Local mirror: `seed_skills_repo/` in this project

### Structure

```
seed_skills_repo/
├── Official/
│   ├── communication/    (4 JSON files)
│   ├── research/         (6 JSON files)
│   ├── creation/         (4 JSON files)
│   └── analysis/         (4 JSON files)
├── Marketplace/          (community-contributed)
├── schema/
│   └── skill.schema.json
├── manifest.json         (test/small version)
├── real-manifest.json    (complete manifest with checksums)
└── README.md
```

### JSON Schema

Each skill JSON file conforms to `schema/skill.schema.json`. Includes:
- Required: id, title, description, version, author, category, icon, connection_type, commands
- Optional: tags, status, models, default_model, fixed_service, oauth_config, cli_config
- Commands: name, description, parameters (typed), returns

### Future: Runtime Resolution

Skills page will fetch from the GitHub repo (or local mirror) instead of hardcoded `skillDefinitions.ts`. The resolver will:
1. Fetch `manifest.json` for the skill index
2. Load individual skill JSONs on demand
3. Match `icon` field to Lucide component dynamically
4. Cache in IndexedDB for offline access

---

## Key Files

| File | Role |
|------|------|
| `src/data/skillDefinitions.ts` | 18 hardcoded skill definitions (current source of truth) |
| `src/lib/skillRecommender.ts` | Mission text → recommended skill IDs |
| `src/lib/database.ts` | Skills CRUD (saveSkill, loadSkills, updateSkillModel) |
| `src/components/Skills/SkillsView.tsx` | Skills grid UI with toggles and model selectors |
| `seed_skills_repo/` | JSON skill files for the external GitHub repo |
| `seed_skills_repo/schema/skill.schema.json` | Validation schema for skill JSON files |
