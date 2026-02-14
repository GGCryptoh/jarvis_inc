# Skills Repository & Marketplace — Implementation Plan

> **STATUS: COMPLETED** — Shipped in Sprint 5 (Feb 2026)
>
> **What shipped:**
> - `skills_repo/` git submodule → `GGCryptoh/jarvis_inc_skills` (canonical)
> - `skillResolver.ts` — three-layer merge (hardcoded UI + GitHub JSON + DB state)
> - `skillExecutor.ts` — LLM provider execution with `execution_handler` → `API_HANDLERS` registry
> - `SkillTestDialog.tsx` — in-app skill testing with parameter forms
> - `cliSkillHandlers.ts` — CLI-based execution handlers
> - JSON schema at `skills_repo/schema/skill.schema.json`
> - 19 skill JSON files across 4 categories in `seed_skills_repo/Official/`
> - Manifest-based sync via GitHub raw URLs
>
> **What didn't ship (deferred):**
> - OAuth flow (PKCE) — no OAuth skills implemented yet
> - CLI config / binary skills — connection_type "cli" not wired
> - `skill_repos` multi-repo table — single official repo only
> - `oauth_connections` table — deferred until OAuth skills needed
>
> **Key files:**
> - `src/lib/skillResolver.ts` — runtime resolution (was "Future" in this plan, now shipped)
> - `src/lib/skillExecutor.ts` — execution pipeline
> - `src/lib/cliSkillHandlers.ts` — CLI skill handlers
> - `src/components/Skills/SkillTestDialog.tsx` — test dialog
> - `src/data/skillDefinitions.ts` — hardcoded UI fallback (Phase 1 of migration path)

---

> Defines the JSON schema, GitHub repo structure, database changes, test dialog,
> refresh mechanism, and migration path for the skills system.

---

## 1. Skill JSON Schema

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier. Lowercase, hyphens/underscores. Must match filename (without `.json`). Pattern: `^[a-z][a-z0-9_-]*$` |
| `title` | string | Human-readable display name (max 50 chars) |
| `description` | string | What this skill does (max 200 chars) |
| `version` | string | Semantic version, e.g. `"1.0.0"` |
| `author` | string | Author name or organization |
| `category` | enum | `"communication"` \| `"research"` \| `"creation"` \| `"analysis"` |
| `icon` | string | Lucide icon name in PascalCase (e.g. `"Mail"`, `"Globe"`, `"Code"`) |
| `connection_type` | enum | `"api_key"` \| `"curl"` \| `"cli"` \| `"oauth"` |
| `commands` | array | At least one command definition (see below) |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tags` | string[] | `[]` | Searchable tags for discovery |
| `status` | enum | `"available"` | `"available"` \| `"coming_soon"` \| `"deprecated"` |
| `models` | string \| string[] \| null | `null` | Compatible AI model(s). `"*"` for model-agnostic. Null for fixed-service |
| `default_model` | string \| null | `null` | Default model when skill is enabled |
| `fixed_service` | string \| null | `null` | For fixed provider skills (e.g. `"OpenAI"`, `"Google"`) |
| `service_type` | enum | `"llm"` | `"llm"` (model-selectable) \| `"fixed"` (locked to fixed_service) |
| `oauth_config` | object \| null | `null` | Required when `connection_type` is `"oauth"` |
| `curl_example` | object \| null | `null` | Example HTTP request for `"curl"` type |
| `cli_config` | object \| null | `null` | Required when `connection_type` is `"cli"` |
| `execution_handler` | string \| null | `null` | Named handler in `skillExecutor.ts` API_HANDLERS registry |

### Command Definition

```json
{
  "name": "generate",
  "description": "Generate an image from a text prompt",
  "parameters": [
    {
      "name": "prompt",
      "type": "string",
      "required": true,
      "description": "Text description of the image"
    },
    {
      "name": "size",
      "type": "string",
      "required": false,
      "description": "Image dimensions",
      "default": "1024x1024"
    }
  ],
  "returns": {
    "type": "object",
    "description": "Object containing image URL(s) and metadata"
  }
}
```

Parameter types: `"string"` | `"number"` | `"boolean"` | `"object"` | `"array"`

### OAuth Config (when `connection_type` = `"oauth"`)

```json
{
  "provider": "google",
  "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
  "token_url": "https://oauth2.googleapis.com/token",
  "scopes": ["https://www.googleapis.com/auth/gmail.readonly"],
  "pkce": true
}
```

### cURL Example (when `connection_type` = `"curl"`)

```json
{
  "method": "POST",
  "url": "https://api.openai.com/v1/images/generations",
  "headers": {
    "Authorization": "Bearer {{OPENAI_API_KEY}}",
    "Content-Type": "application/json"
  },
  "body": {
    "model": "dall-e-3",
    "prompt": "A pixel art office with working AI agents",
    "n": 1,
    "size": "1024x1024"
  }
}
```

### CLI Config (when `connection_type` = `"cli"`)

```json
{
  "binary": "ffmpeg",
  "install_url": "https://ffmpeg.org/download.html",
  "version_check": "ffmpeg -version"
}
```

### Full Example: `create_images.json`

```json
{
  "id": "create-images",
  "title": "Create Images",
  "description": "Generate images using AI image models (DALL-E, Midjourney)",
  "version": "1.0.0",
  "author": "Jarvis Inc",
  "category": "creation",
  "icon": "Image",
  "tags": ["image", "generation", "dall-e", "ai-art", "visual", "logo"],
  "status": "available",
  "connection_type": "api_key",
  "models": null,
  "default_model": null,
  "fixed_service": "OpenAI",
  "service_type": "fixed",
  "execution_handler": "create_images",
  "oauth_config": null,
  "curl_example": {
    "method": "POST",
    "url": "https://api.openai.com/v1/images/generations",
    "headers": {
      "Authorization": "Bearer {{OPENAI_API_KEY}}",
      "Content-Type": "application/json"
    },
    "body": {
      "model": "dall-e-3",
      "prompt": "A pixel art office with working AI agents",
      "n": 1,
      "size": "1024x1024"
    }
  },
  "cli_config": null,
  "commands": [
    {
      "name": "generate",
      "description": "Generate an image from a text prompt",
      "parameters": [
        { "name": "prompt", "type": "string", "required": true, "description": "Text description of the image to generate" },
        { "name": "size", "type": "string", "required": false, "description": "Image dimensions", "default": "1024x1024" },
        { "name": "count", "type": "number", "required": false, "description": "Number of images to generate", "default": 1 }
      ],
      "returns": { "type": "object", "description": "Object containing image URL(s) and metadata" }
    },
    {
      "name": "edit",
      "description": "Edit an existing image with a text prompt",
      "parameters": [
        { "name": "image_url", "type": "string", "required": true, "description": "URL of the source image" },
        { "name": "prompt", "type": "string", "required": true, "description": "Instructions for how to edit the image" }
      ],
      "returns": { "type": "object", "description": "Object containing edited image URL and metadata" }
    }
  ]
}
```

---

## 2. License

**Apache License 2.0**

**Rationale**:
- Includes explicit patent grant (important for AI skill ecosystem)
- Requires attribution but doesn't force open source on derivatives
- Commercial-friendly — marketplace contributors can monetize
- Industry standard for AI projects (TensorFlow, LangChain, Kubernetes)
- Compatible with MIT/BSD licenses for community contributions

Full license text: https://www.apache.org/licenses/LICENSE-2.0

---

## 3. README (for the GitHub Skills Repo)

```markdown
# Jarvis Inc — Official Skills Repository

> Pluggable capabilities for the Jarvis Inc autonomous AI workforce platform.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

## What Are Skills?

Skills are modular capability definitions that tell Jarvis Inc agents **what they
can do** and **how to connect** to external services. Each skill is a standalone
JSON file that declares:

- What the skill does (title, description, category)
- How it connects to the outside world (API key, OAuth, cURL, CLI)
- What commands it exposes (with typed parameters and return values)
- Which AI models are compatible (for LLM-powered skills)

Skills are **declarative definitions** — they do not contain executable code. The
Jarvis Inc runtime interprets them to wire agents to external services.

## Repository Structure

```
jarvis-skills/
├── Official/
│   ├── communication/
│   │   ├── read_email.json
│   │   ├── write_email.json
│   │   ├── send_slack.json
│   │   └── schedule_meeting.json
│   ├── research/
│   │   ├── research_web.json
│   │   ├── read_tweets.json
│   │   ├── research_reddit.json
│   │   └── deep_search.json
│   ├── creation/
│   │   ├── create_images_openai.json
│   │   ├── create_images_gemini.json
│   │   ├── write_document.json
│   │   └── generate_code.json
│   └── analysis/
│       └── analyze_data.json
├── Marketplace/
│   └── (community contributions)
├── schema/
│   └── skill.schema.json
├── manifest.json
├── LICENSE
└── README.md
```

## Skill JSON Schema

Every skill file must conform to the [Skill JSON Schema](schema/skill.schema.json).

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (lowercase, hyphens/underscores) |
| `title` | string | Human-readable display name (max 50 chars) |
| `description` | string | What this skill does (max 200 chars) |
| `version` | string | Semantic version (e.g., `1.0.0`) |
| `author` | string | Author name or organization |
| `category` | string | `communication` \| `research` \| `creation` \| `analysis` |
| `icon` | string | [Lucide](https://lucide.dev/icons/) icon name in PascalCase |
| `connection_type` | string | `api_key` \| `curl` \| `cli` \| `oauth` |
| `commands` | array | At least one command definition |

### Connection Types

| Type | Description | Config Required |
|------|-------------|-----------------|
| `api_key` | Needs an API key stored in the Vault | `fixed_service` or `models` |
| `curl` | Makes HTTP requests with parameters | `curl_example` |
| `cli` | Runs a local CLI tool | `cli_config` |
| `oauth` | Needs an OAuth connection | `oauth_config` |

### Command Definition

Each command declares its name, description, typed parameters, and return type:

```json
{
  "name": "search",
  "description": "Search the web for information",
  "parameters": [
    { "name": "query", "type": "string", "required": true },
    { "name": "max_results", "type": "number", "required": false, "default": 10 }
  ],
  "returns": { "type": "array", "description": "Search result objects" }
}
```

## How to Contribute

### Adding a New Skill

1. **Fork** this repository
2. **Create** a new JSON file in the appropriate `Official/<category>/` directory
3. **Validate** against the schema:
   ```bash
   npx ajv validate -s schema/skill.schema.json -d Official/<category>/your_skill.json
   ```
4. **Submit** a pull request with:
   - A clear description of what the skill does
   - Which services/APIs it connects to
   - Any required setup instructions

### Conventions

- `id` must match filename (e.g., `research_web.json` → `"id": "research-web"`)
- Use lowercase + hyphens for IDs
- Icons must be valid [Lucide icon names](https://lucide.dev/icons/) in PascalCase
- Keep descriptions under 200 characters

### Testing Your Skill

1. Add the JSON to a Jarvis Inc instance (or point it at your fork)
2. Navigate to **Skills** page
3. Find your skill and click the **Test** button
4. Fill in parameters and execute
5. Verify the response matches your `returns` definition

## Versioning

Skills follow [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes to commands or parameters
- **MINOR**: New commands or optional parameters
- **PATCH**: Description updates, tag changes, bug fixes

## License

This repository is licensed under the [Apache License 2.0](LICENSE).
```

---

## 4. Skill Mapping (19 Skills → JSON Schema)

| Skill ID | connection_type | service_type | fixed_service | models | icon | status |
|----------|----------------|-------------|---------------|--------|------|--------|
| `read-email` | oauth | fixed | Google | null | Mail | available |
| `write-email` | oauth | fixed | Google | null | Send | available |
| `send-slack` | oauth | fixed | Slack | null | MessageCircle | coming_soon |
| `schedule-meeting` | oauth | fixed | Google | null | Calendar | coming_soon |
| `research-web` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | Globe | available |
| `read-tweets` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | Twitter | available |
| `research-reddit` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | Rss | available |
| `deep-search` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | Search | coming_soon |
| `browse-web` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | Monitor | available |
| `web-scraping` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | ScanSearch | available |
| `create-images` | api_key | fixed | OpenAI | null | Image | available |
| `create-images-gemini` | api_key | fixed | Google | null | Image | available |
| `generate-video` | api_key | fixed | OpenAI | null | Video | coming_soon |
| `write-document` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | FileText | available |
| `generate-code` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | Code | available |
| `analyze-data` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | BarChart3 | coming_soon |
| `analyze-image` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | Eye | available |
| `summarize-document` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | BookOpen | available |
| `translate-text` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | Languages | available |

### Skill-Agent Assignment Model

Skills are NOT globally available to all agents. The CEO controls which tools each agent can use:
1. Founder enables skills org-wide (Skills page toggle)
2. CEO checks enabled skills during evaluation cycle
3. CEO assigns specific skill IDs per agent (stored in agent's `skills` column as JSON array)
4. Agent's system prompt lists only its assigned skills as callable tools
5. CEO's user prompt per task tells agent which specific skills to use

---

## 5. Seed Skills Repo Structure

The canonical skills repo is `skills_repo/` (git submodule → https://github.com/GGCryptoh/jarvis_inc_skills).

Local reference copy at `seed_skills_repo/` mirrors the structure:

```
seed_skills_repo/
├── Official/
│   ├── communication/
│   │   ├── read_email.json
│   │   ├── write_email.json
│   │   ├── send_slack.json
│   │   └── schedule_meeting.json
│   ├── research/
│   │   ├── research_web.json
│   │   ├── read_tweets.json
│   │   ├── research_reddit.json
│   │   ├── deep_search.json
│   │   ├── browse_web.json
│   │   ├── web_scraping.json
│   │   ├── dns_lookup.json
│   │   └── whois_lookup.json
│   ├── creation/
│   │   ├── create_images_openai.json
│   │   ├── create_images_gemini.json
│   │   ├── generate_video.json
│   │   ├── write_document.json
│   │   └── generate_code.json
│   ├── analysis/
│   │   ├── analyze_data.json
│   │   ├── analyze_image.json
│   │   ├── summarize_document.json
│   │   └── translate_text.json
│   └── README.md
├── Marketplace/
│   └── (empty — future community contributions)
├── schema/
│   └── skill.schema.json
├── manifest.json
└── other-manifest.json
```

The `manifest.json` lists all skill file paths with checksums for efficient sync:

```json
{
  "version": "1.0.0",
  "updated_at": "2026-02-11T00:00:00Z",
  "skills": [
    { "path": "Official/communication/read_email.json", "checksum": "sha256:..." },
    { "path": "Official/communication/write_email.json", "checksum": "sha256:..." }
  ]
}
```

---

## 6. Database Schema

The `skills` table in Supabase stores user-facing skill state (enabled/disabled, selected model). Skill definitions are resolved at runtime by `skillResolver.ts` from three sources:

1. **Hardcoded** — `skillDefinitions.ts` (offline/first-boot fallback)
2. **GitHub** — fetched from `skills_repo` manifest via raw URLs
3. **DB** — user preferences (enabled, model) from `skills` table

The three-layer merge in `resolveSkills()` produces `ResolvedSkillDefinition[]` with full JSON definition + user config attached.

---

## 7. Refresh Mechanism

### Auto-Refresh
- On Skills page mount: `useEffect` checks `last_synced_at` in localStorage
- If older than 24 hours → triggers sync from GitHub
- Silent background operation — no UI interruption

### Manual Refresh
- Muted `RefreshCw` icon button in Skills page header
- Animates with `animate-spin` while syncing
- Tooltip: "Refresh skills from repositories"

### Sync Engine (`src/lib/skillResolver.ts`)

```
Fetch manifest.json → compare checksums → fetch only changed skills → validate → merge with DB state
```

**GitHub raw URLs**: `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}`

---

## 8. Test Dialog UX

### Component: `src/components/Skills/SkillTestDialog.tsx`

**State machine**: `idle → running → success | error`

**Parameter form** (auto-generated from command's `parameters`):
- `string` → text input
- `number` → number input
- `boolean` → toggle switch
- `object` / `array` → JSON textarea
- Required params: asterisk marker
- Optional params: show `default` as placeholder

**Integration**: Test button (FlaskConical icon) on each skill card, visible when skill is enabled and has required credentials.

---

## 9. Migration Path (COMPLETED)

### Phase 1: Dual Source (backward compatible) — SHIPPED
- `skillDefinitions.ts` remains as hardcoded fallback
- `skillResolver.ts` merges: hardcoded → official repo → DB state
- `resolveSkills()` returns `ResolvedSkillDefinition[]` with user config attached
- SkillsView imports from resolver instead of hardcoded

### Phase 2: Seed Skills Repo — SHIPPED
- 19+ JSON files in `seed_skills_repo/` and canonical `skills_repo/`
- Official repo as default source

### Phase 3: Steady State — SHIPPED
- Hardcoded `skillDefinitions.ts` serves only as offline/first-boot fallback
- All runtime skill data comes from synced repo + DB
- User's enabled/model preferences always preserved in `skills` table

### Icon Resolution
`skillResolver.ts` maps string icon names to Lucide components using an internal icon map. Fallback: Puzzle icon for unknown names.

---

## 10. Files Summary

| File | Purpose | Status |
|------|---------|--------|
| `src/lib/skillResolver.ts` | Three-layer merge: hardcoded + GitHub + DB | SHIPPED |
| `src/lib/skillExecutor.ts` | LLM provider execution + API_HANDLERS registry | SHIPPED |
| `src/lib/cliSkillHandlers.ts` | CLI-based skill execution handlers | SHIPPED |
| `src/components/Skills/SkillTestDialog.tsx` | Themed test dialog with param form + result panel | SHIPPED |
| `src/data/skillDefinitions.ts` | Hardcoded UI fallback definitions | SHIPPED |
| `skills_repo/` | Git submodule → canonical GitHub repo | SHIPPED |
| `seed_skills_repo/` | Local reference copy (knowledge only) | SHIPPED |
