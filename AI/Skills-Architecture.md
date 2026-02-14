# Skills Architecture

> Committed project documentation. Defines the skill system end-to-end: definitions,
> three-layer resolution, execution pipeline, CLI handlers, test dialog, and the
> canonical GitHub skills repository.

---

## Implementation Status

| Component | Status | File(s) |
|-----------|--------|---------|
| Skill definitions (hardcoded UI layer) | SHIPPED | `src/data/skillDefinitions.ts` (21 skills) |
| Skill resolution pipeline (three-layer merge) | SHIPPED | `src/lib/skillResolver.ts` |
| Skill execution (LLM + API + CLI) | SHIPPED | `src/lib/skillExecutor.ts` |
| CLI skill handlers (browser HTTP) | SHIPPED | `src/lib/cliSkillHandlers.ts` |
| Edge Function (server-side execution) | SHIPPED | `docker/supabase/functions/execute-skill/index.ts` |
| Skill test dialog | SHIPPED | `src/components/Skills/SkillTestDialog.tsx` |
| Skill recommender | SHIPPED | `src/lib/skillRecommender.ts` |
| Skills page UI | SHIPPED | `src/components/Skills/SkillsView.tsx` |
| GitHub skills repo (canonical) | SHIPPED | `skills_repo/` submodule |
| CEO auto-seed on startup | SHIPPED | `src/lib/ceoDecisionEngine.ts` (throttled, once/hour) |

---

## Overview

A **skill** is a declarative capability descriptor. Skills define *what* an agent can do (search the web, send email, generate images) and *how* via structured command definitions, prompt templates, and execution handler mappings. The runtime resolves the full skill definition from three layers and routes execution to the correct backend.

Skills are **not globally available** to all agents. The CEO assigns specific skills per agent based on role and task requirements.

---

## Skill Definition (Hardcoded Layer)

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

This is Layer 1 of the resolution pipeline. These definitions provide **UI metadata** (icons, descriptions, categories) and are always present even if the GitHub repo is unreachable.

### Service Types

| Type | Meaning | Auth Method |
|------|---------|-------------|
| `llm` | Powered by user-selected LLM | API key for the model's service |
| `fixed` | Hardwired to specific service | API key for that service |

---

## All 22 Skills

### Communication (4)

| ID | Name | Status | Service | Icon |
|----|------|--------|---------|------|
| `read-email` | Read Email | available | Google (fixed) | Mail |
| `write-email` | Write Email | available | Google (fixed) | Send |
| `send-slack` | Send Slack Message | coming_soon | -- | MessageCircle |
| `schedule-meeting` | Schedule Meeting | coming_soon | -- | Calendar |

### Research (8)

| ID | Name | Status | Service | Connection | Icon |
|----|------|--------|---------|------------|------|
| `research-web` | Research Web | available | LLM | llm | Globe |
| `read-tweets` | Read X / Tweets | available | LLM | llm | Twitter |
| `research-reddit` | Research Reddit | available | LLM | llm | Rss |
| `deep-search` | Deep Search | coming_soon | -- | llm | Search |
| `browse-web` | Browse Web | available | LLM | llm | Monitor |
| `web-scraping` | Web Scraping | available | LLM | llm | ScanSearch |
| `whois-lookup` | WHOIS Lookup | available | RDAP.org (free) | cli | ServerCrash |
| `dns-lookup` | DNS Lookup | available | Cloudflare DoH (free) | cli | Network |

### Creation (5)

| ID | Name | Status | Service | Connection | Icon |
|----|------|--------|---------|------------|------|
| `create-images-openai` | Image Generation -- OpenAI | available | OpenAI (fixed) | api_key | Image |
| `create-images-gemini` | Image Generation -- Gemini | available | Google (fixed) | api_key | Sparkles |
| `generate-video` | Generate Video | coming_soon | OpenAI (fixed) | api_key | Video |
| `write-document` | Write Document | available | LLM | llm | FileText |
| `generate-code` | Generate Code | available | LLM | llm | Code |

### Analysis (4)

| ID | Name | Status | Service | Connection | Icon |
|----|------|--------|---------|------------|------|
| `analyze-data` | Analyze Data | coming_soon | -- | llm | BarChart3 |
| `analyze-image` | Analyze Image | available | LLM | llm | Eye |
| `summarize-document` | Summarize Document | available | LLM | llm | BookOpen |
| `translate-text` | Translate Text | available | LLM | llm | Languages |

### Repo-Only (not hardcoded)

| ID | Name | Status | Connection | Source |
|----|------|--------|------------|--------|
| `weather-cli` | Weather Forecast | available | cli | GitHub repo |

> **Note:** `weather-cli` exists only in the GitHub repo (`skills_repo/Official/research/weather_cli.json`). It has no hardcoded entry in `skillDefinitions.ts` and appears in the UI only after `seedSkillsFromRepo()` runs. This demonstrates the system's ability to pick up repo-only skills.

---

## Skill Resolution Pipeline

### File: `src/lib/skillResolver.ts` (305 lines)

The resolver merges three layers to produce a `FullSkillDefinition` used by the executor and test dialog.

### Three-Layer Merge

```
Layer 1: Hardcoded (skillDefinitions.ts)
  └─ UI metadata: icons, descriptions, categories, default models
  └─ Always present — the baseline

Layer 2: GitHub Repo JSON (GGCryptoh/jarvis_inc_skills)
  └─ Execution metadata: commands, parameters, prompt templates, execution_handler
  └─ Fetched via seedSkillsFromRepo(), stored in DB `skills.definition` JSONB
  └─ Overrides: title, description, default_model, connection_type, fixed_service

Layer 3: DB State (skills table)
  └─ User runtime state: enabled/disabled, selected model
  └─ Always preserved — never overwritten by seed
```

### FullSkillDefinition (Resolved Type)

```typescript
interface FullSkillDefinition {
  id: string;
  name: string;               // from repo JSON or hardcoded
  description: string;         // from repo JSON or hardcoded
  category: string;
  icon: string;                // icon component name (string, not React.ElementType)
  serviceType: string;         // 'llm' | 'fixed'
  fixedService?: string;
  defaultModel?: string;       // from repo JSON or hardcoded
  status: string;              // 'available' | 'coming_soon' | 'beta'
  enabled: boolean;            // from DB
  model: string | null;        // from DB (user-selected)
  source: string;              // 'seed' | 'github' | 'marketplace' | 'hardcoded'
  commands?: SkillCommand[];   // from repo JSON via DB
  connection?: Record<string, unknown>;
  prerequisites?: string[];
  executionHandler?: string;   // maps to API_HANDLERS key in skillExecutor.ts
}
```

### Resolution Functions

| Function | Description |
|----------|-------------|
| `resolveSkills()` | Merges all three layers, returns `FullSkillDefinition[]`. Hardcoded skills first, then DB-only skills (repo/marketplace). |
| `resolveSkill(id)` | Single skill by ID. Calls `resolveSkills()` and filters. |
| `seedSkillsFromRepo()` | Fetches `manifest.json` from GitHub, loads each skill JSON, upserts to DB. Prunes stale github-sourced entries. Fires `skills-changed` event. |
| `cleanSeedSkillsFromRepo()` | Wipes all skills from DB, then re-seeds from GitHub. |

### Seed Flow

```
ceoDecisionEngine startup (throttled: once/hour)
  └─ seedSkillsFromRepo()
       ├─ fetch manifest.json from GGCryptoh/jarvis_inc_skills (main branch)
       ├─ for each skill path in manifest:
       │    ├─ fetch raw JSON from GitHub
       │    └─ upsertSkillDefinition(id, fullJson, category, 'github')
       ├─ prune stale github-sourced DB entries not in manifest
       └─ dispatch 'skills-changed' event
```

### Merge Precedence

When the same field exists in multiple layers:

| Field | Winner |
|-------|--------|
| `name`, `description` | Repo JSON (if present), else hardcoded |
| `defaultModel` | Repo JSON (if present), else hardcoded |
| `serviceType`, `fixedService` | Repo JSON (if present), else hardcoded |
| `icon`, `category` | Hardcoded always (icons are React components) |
| `commands`, `executionHandler` | Repo JSON via DB definition |
| `enabled`, `model` | DB always (user state) |

---

## Skill Execution

### File: `src/lib/skillExecutor.ts` (581 lines)

The executor takes a resolved skill and routes execution based on `connection_type`.

### Execution Flow

```
executeSkill(skillId, commandName, params, options)
  ├─ 1. resolveSkill(skillId) — get FullSkillDefinition
  ├─ 2. Check enabled
  ├─ 3. Route by connection type:
  │    ├─ connection_type === 'cli'
  │    │    └─ executeCLISkill() → browser-side HTTP handler
  │    ├─ executionHandler in API_HANDLERS
  │    │    └─ Direct API call (image generation, etc.)
  │    └─ else (LLM path)
  │         ├─ Determine model (override > user-selected > default)
  │         ├─ Look up provider + API key from vault
  │         ├─ buildSkillPrompt() → assemble prompt
  │         └─ Stream via LLM provider, collect result
  ├─ 4. Log to audit_log
  ├─ 5. Log to llm_usage (cost tracking)
  └─ 6. Return SkillExecutionResult
```

### Connection Type Routing

| Connection Type | Path | API Key Source | Example Skills |
|----------------|------|---------------|----------------|
| `cli` | `cliSkillHandlers.ts` | None (free APIs) | weather-cli, whois-lookup, dns-lookup |
| `api_key` | `API_HANDLERS` registry | Vault (by fixed_service) | create-images-openai, create-images-gemini |
| `llm` | LLM provider stream | Vault (by model's service) | research-web, generate-code, write-document |

### API_HANDLERS Registry

```typescript
const API_HANDLERS: Record<string, ApiHandler> = {
  openai_image_generation: executeImageGeneration,   // DALL-E 3 via OpenAI API
  gemini_image_generation: executeGeminiImageGeneration,  // Gemini 2.5 Flash
};
```

The `execution_handler` field in skill JSON maps to these keys. When present, the executor dispatches directly to the handler function instead of the LLM path.

### buildSkillPrompt()

```typescript
buildSkillPrompt(skill, commandName, params): string
```

1. Finds the matching command definition in `skill.commands`
2. If `command.prompt_template` exists, interpolates `{paramName}` placeholders
3. Otherwise, builds a generic prompt with skill name, command description, and JSON params

### SkillExecutionResult

```typescript
interface SkillExecutionResult {
  success: boolean;
  output: string;       // The actual result text / markdown
  tokens_used: number;  // 0 for CLI and API skills
  cost_usd: number;     // Estimated cost
  duration_ms: number;
  error?: string;
}
```

---

## CLI Skill Handlers

### File: `src/lib/cliSkillHandlers.ts` (230 lines)

Browser-side HTTP execution for skills with `connection_type: 'cli'`. These skills wrap public HTTP APIs and execute directly via `fetch()`. No LLM model required, no API key needed.

### Handler Registry

```typescript
const CLI_HANDLERS: Record<string, CLIHandler> = {
  'weather-cli':  executeWeatherCli,   // wttr.in API
  'whois-lookup': executeWhoisLookup,  // rdap.org WHOIS/RDAP API
  'dns-lookup':   executeDnsLookup,    // Cloudflare DNS-over-HTTPS
};
```

### Handler Details

| Skill ID | API | Commands |
|----------|-----|----------|
| `weather-cli` | `wttr.in` (JSON format) | `get_forecast`, `get_current`, `get_moon_phase` |
| `whois-lookup` | `rdap.org` | `domain_lookup`, `ip_lookup` |
| `dns-lookup` | `cloudflare-dns.com/dns-query` (DoH) | `query` (single type), `full_report` (A, AAAA, MX, NS, TXT, SOA) |

### Public API

```typescript
hasCLIHandler(skillId: string): boolean       // Check if a handler exists
executeCLISkill(skillId, commandName, params): Promise<CLISkillResult | null>
```

Returns `null` if no handler exists (the executor falls through to the LLM path).

---

## Edge Function: execute-skill

### File: `docker/supabase/functions/execute-skill/index.ts` (769 lines)

Server-side skill execution for the Supabase deployment. Runs as a Deno Edge Function behind Kong.

### Flow

```
POST /functions/v1/execute-skill { task_execution_id }
  ├─ 1. Load task_execution from DB
  ├─ 2. Mark as running
  ├─ 3. Load skill definition from DB
  ├─ 4. Route by connection_type:
  │    ├─ 'cli'     → CLI_HTTP_HANDLERS (weather, etc.)
  │    ├─ 'api_key' → API_KEY_HANDLERS (image generation)
  │    └─ 'llm'     → callLLM() (Anthropic, OpenAI, Google, DeepSeek, xAI)
  ├─ 5. Update task_execution with result
  ├─ 6. Log to llm_usage
  ├─ 7. Log to audit_log
  └─ 8. If all mission tasks complete → update mission status, post CEO summary in chat
```

### Supported Providers (server-side)

| Provider | Endpoint | Auth |
|----------|----------|------|
| Anthropic | `api.anthropic.com/v1/messages` | x-api-key header |
| OpenAI | `api.openai.com/v1/chat/completions` | Bearer token |
| Google | `generativelanguage.googleapis.com/v1beta` | Query param key |
| DeepSeek | `api.deepseek.com/v1/chat/completions` | Bearer token |
| xAI | `api.x.ai/v1/chat/completions` | Bearer token |

### Key Differences from Browser Executor

- **Non-streaming**: Server-side uses synchronous LLM calls (no SSE)
- **Vault lookup**: Reads API keys from Supabase `vault` table directly
- **Mission completion**: Checks if all sibling tasks are done, updates mission status, posts CEO summary to chat
- **Image generation**: Returns URLs instead of base64 data URIs

---

## Skill Test Dialog

### File: `src/components/Skills/SkillTestDialog.tsx` (315 lines)

Modal dialog for testing any enabled skill interactively.

### Features

- **Command selector**: Dropdown of all commands defined in the skill
- **Parameter form**: Auto-generated from command parameter definitions (type-aware: text, number, textarea for objects/arrays)
- **Dry Run**: Builds and shows the prompt that would be sent to the LLM (not available for CLI skills)
- **Execute**: Calls `executeSkill()` and displays the result with cost/token/duration stats
- **Rich results**: Images (base64 data URIs) and links auto-detected and rendered via `RichResultCard`
- **CLI badge**: Shows "HTTP / CLI -- no model needed" for CLI-type skills

### Test Flow

```
User clicks TEST on skill card
  └─ SkillTestDialog opens
       ├─ Select command from dropdown
       ├─ Fill in parameters
       ├─ DRY RUN → shows buildSkillPrompt() output
       └─ EXECUTE → calls executeSkill() → shows result + stats
```

---

## Skills Page (SkillsView)

Grid of skill cards grouped by category. Each card shows:
- Skill icon, name, description
- Status badge (available / coming_soon)
- Toggle switch to enable/disable
- Model selector dropdown (for LLM skills)
- **Test button** — opens SkillTestDialog (requires enabled + commands defined)

Toggles write to `skills` table via `saveSkill(id, enabled, model)`.

When enabling a skill that requires a service without a vault key, an `api_key_request` approval is created automatically.

Syncs with approvals via `window.dispatchEvent(new Event('approvals-changed'))`.

---

## Skill Recommender

### File: `src/lib/skillRecommender.ts`

Keyword-based matching against the founder's mission text.

```typescript
const KEYWORD_MAP: [RegExp, string[]][] = [
  [/logo|image|design|visual|graphic|art|photo/i, ['create-images-openai', 'create-images-gemini', 'research-web']],
  [/email|mail|inbox|outreach|newsletter/i, ['read-email', 'write-email']],
  [/tweet|twitter|x\.com|social\s*media/i, ['read-tweets', 'research-web']],
  [/reddit|forum|community|subreddit/i, ['research-reddit', 'research-web']],
  [/write|document|report|content|blog/i, ['write-document', 'research-web']],
  [/code|develop|program|software|app/i, ['generate-code', 'research-web']],
  [/data|analytics|metric|dashboard/i, ['research-web']],
  [/research|search|find|investigate/i, ['research-web']],  // broad catch-all, last
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
  id         TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  model      TEXT DEFAULT NULL,
  category   TEXT DEFAULT NULL,
  source     TEXT DEFAULT 'hardcoded',
  status     TEXT DEFAULT 'available',
  definition JSONB DEFAULT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Key Columns

| Column | Purpose |
|--------|---------|
| `enabled` | User toggle state |
| `model` | User-selected LLM model (null for fixed/CLI) |
| `category` | Skill category for grouping |
| `source` | Origin: `'hardcoded'`, `'github'`, `'marketplace'` |
| `status` | `'available'`, `'coming_soon'`, `'beta'` |
| `definition` | Full skill JSON from repo (commands, params, execution_handler, etc.) |

### CRUD

```typescript
loadSkills(): SkillRow[]
saveSkill(id: string, enabled: boolean, model: string | null): void
updateSkillModel(id: string, model: string | null): void
upsertSkillDefinition(id, definition, category, source): 'created' | 'updated' | 'unchanged'
clearAllSkills(): void
```

---

## Skill JSON Schema

### File: `skills_repo/schema/skill.schema.json`

Defines the structure of skill JSON files in the repository.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Kebab-case unique ID (e.g. `research-web`) |
| `title` | string | Human-readable name |
| `description` | string | What the skill does (10-500 chars) |
| `version` | string | Semver (e.g. `1.0.0`) |
| `author` | string | Author name |
| `category` | enum | `communication`, `research`, `creation`, `analysis` |
| `icon` | string | Lucide icon name (e.g. `Globe`, `Code`) |
| `connection_type` | enum | `llm`, `oauth`, `api_key`, `cli`, `none` |
| `commands` | array | Command definitions (name, description, parameters, returns) |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `tags` | string[] | Kebab-case tags for search/filtering |
| `status` | enum | `available`, `coming_soon`, `beta`, `deprecated` |
| `models` | string[] | Available LLM models (required when `connection_type: 'llm'`) |
| `default_model` | string | Default model (required when `connection_type: 'llm'`) |
| `fixed_service` | string | Fixed service name (e.g. `OpenAI`, `Google`) |
| `oauth_config` | object | OAuth 2.0 provider/scopes/URLs |
| `cli_config` | object | CLI binary, install command, version check |
| `api_config` | object | Base URL, auth header/prefix, vault service |
| `execution_handler` | string | Named handler in `skillExecutor.ts` API_HANDLERS |
| `output_type` | enum | `text`, `image`, `audio`, `data`, `mixed` |
| `collateral` | boolean | Whether results save to Collateral page |

### Conditional Requirements

- When `connection_type: 'llm'` -> `models` and `default_model` are required
- When `connection_type: 'oauth'` -> `oauth_config` is required

---

## Skill-Agent Assignment Model

### Flow

1. **Founder enables skills org-wide** -- Skills page toggles
2. **CEO checks enabled skills** during evaluation cycle
3. **CEO requests more** -- if a mission needs a disabled skill, CEO asks founder to enable it
4. **CEO assigns skill IDs per agent** -- stored in `agents.skills` (JSON array)
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

**CEO -> Agent task prompt**:
```
Task: {task_description}
Context: {context}
Use these tools: {specific_skill_ids_for_this_task}
Expected output: {output_format}
```

---

## Skills Repository

### Canonical Repo

**Git submodule**: `skills_repo/` -> `https://github.com/GGCryptoh/jarvis_inc_skills`

This is the single source of truth for skill execution metadata. New skills go here, push to GitHub to sync.

### Structure

```
skills_repo/                   # git submodule -> GGCryptoh/jarvis_inc_skills
├── Official/
│   ├── communication/         (not yet pushed — hardcoded only)
│   ├── research/
│   │   ├── research_web.json
│   │   └── weather_cli.json
│   ├── creation/
│   │   ├── create_images_openai.json
│   │   └── create_images_gemini.json
│   └── analysis/              (not yet pushed — hardcoded only)
├── Marketplace/               (community-contributed, empty)
├── schema/
│   └── skill.schema.json
└── manifest.json              (4 skills currently published)
```

### Local Reference Copy

```
seed_skills_repo/              # Local reference (NOT synced by app)
├── Official/
│   ├── communication/         (4 JSON files)
│   ├── research/              (8 JSON files)
│   ├── creation/              (5 JSON files)
│   └── analysis/              (4 JSON files)
├── manifest.json              (test/small version)
├── other-manifest.json        (complete manifest)
└── schema/ (removed — lives in skills_repo/ now)
```

### Sync Flow

```
1. Author new skill JSON in skills_repo/
2. Update manifest.json with path + checksum
3. git push -> GitHub (GGCryptoh/jarvis_inc_skills)
4. App startup: ceoDecisionEngine calls seedSkillsFromRepo() (throttled: 1x/hour)
5. skillResolver fetches manifest.json from GitHub raw URL
6. For each skill in manifest: fetch JSON, upsert to DB
7. Stale github-sourced DB entries pruned
8. 'skills-changed' event fired -> UI refreshes
```

---

## Key Files

| File | Role |
|------|------|
| `src/data/skillDefinitions.ts` | 21 hardcoded skill definitions (Layer 1: UI metadata, icons) |
| `src/lib/skillResolver.ts` | Three-layer merge: hardcoded + GitHub repo + DB state |
| `src/lib/skillExecutor.ts` | Execution router: CLI, API, and LLM paths |
| `src/lib/cliSkillHandlers.ts` | Browser-side HTTP handlers for CLI-type skills |
| `src/lib/skillRecommender.ts` | Mission text -> recommended skill IDs |
| `src/lib/database.ts` | Skills CRUD (saveSkill, loadSkills, upsertSkillDefinition) |
| `src/components/Skills/SkillsView.tsx` | Skills grid UI with toggles, model selectors, test buttons |
| `src/components/Skills/SkillTestDialog.tsx` | Interactive test dialog for any skill |
| `docker/supabase/functions/execute-skill/index.ts` | Server-side skill execution Edge Function |
| `skills_repo/` | Git submodule -> GGCryptoh/jarvis_inc_skills (canonical) |
| `skills_repo/schema/skill.schema.json` | JSON Schema for skill definition files |
| `seed_skills_repo/` | Local reference copy of all 21 skill JSONs (not app-synced) |
