# Skills Repository & Marketplace — Implementation Plan

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
├── skills/
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
│   │   ├── create_images.json
│   │   ├── write_document.json
│   │   └── generate_code.json
│   └── analysis/
│       └── analyze_data.json
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
2. **Create** a new JSON file in the appropriate `skills/<category>/` directory
3. **Validate** against the schema:
   ```bash
   npx ajv validate -s schema/skill.schema.json -d skills/<category>/your_skill.json
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

## Warranty & Liability Disclaimer

THIS SOFTWARE AND ALL SKILL DEFINITIONS ARE PROVIDED "AS IS", WITHOUT WARRANTY
OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

IN NO EVENT SHALL THE AUTHORS, COPYRIGHT HOLDERS, OR CONTRIBUTORS BE LIABLE FOR
ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE, THE SKILL
DEFINITIONS, OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

**Community skills** (marketplace) are provided by third-party contributors and
are not reviewed, endorsed, or guaranteed by Jarvis Inc. Use community skills at
your own risk. Always review skill definitions before enabling them, especially
skills that require OAuth connections or API keys.

**API costs**: Skills that connect to paid APIs (OpenAI, Anthropic, Google, etc.)
will incur charges on your API accounts. Jarvis Inc is not responsible for any
API costs incurred through skill usage.

## License

This repository is licensed under the [Apache License 2.0](LICENSE).
```

---

## 4. Skill Mapping (Current 13 Skills → JSON Schema)

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
| `create-images` | api_key | fixed | OpenAI | null | Image | available |
| `write-document` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | FileText | available |
| `generate-code` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | Code | available |
| `analyze-data` | api_key | llm | null | [Claude Opus 4.6, GPT-5.2, ...] | BarChart3 | coming_soon |

**Note**: `read-email`, `write-email`, `send-slack`, `schedule-meeting` are reclassified from `api_key`/`fixed` to `oauth`/`fixed` since they actually need OAuth flows (Gmail API, Slack API, Google Calendar API).

---

## 5. Seed Skills Repo Structure

Create `/seed_skills_repo/` in the project for local development:

```
seed_skills_repo/
├── skills/
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
│   │   ├── create_images.json
│   │   ├── write_document.json
│   │   └── generate_code.json
│   └── analysis/
│       └── analyze_data.json
├── schema/
│   └── skill.schema.json
├── manifest.json
├── LICENSE
└── README.md
```

The `manifest.json` lists all skill file paths with checksums for efficient sync:

```json
{
  "version": "1.0.0",
  "updated_at": "2026-02-11T00:00:00Z",
  "skills": [
    { "path": "skills/communication/read_email.json", "checksum": "sha256:..." },
    { "path": "skills/communication/write_email.json", "checksum": "sha256:..." }
  ]
}
```

---

## 6. Database Schema Additions

### New: `skill_definitions` (cached remote skill data)
```sql
CREATE TABLE IF NOT EXISTS skill_definitions (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL DEFAULT 'local',
  source_repo     TEXT DEFAULT NULL,
  json_data       TEXT NOT NULL,
  version         TEXT NOT NULL,
  author          TEXT NOT NULL,
  category        TEXT NOT NULL,
  icon            TEXT NOT NULL,
  connection_type TEXT NOT NULL,
  fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
  checksum        TEXT DEFAULT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### New: `oauth_connections`
```sql
CREATE TABLE IF NOT EXISTS oauth_connections (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  skill_id        TEXT DEFAULT NULL,
  access_token    TEXT NOT NULL,
  refresh_token   TEXT DEFAULT NULL,
  token_type      TEXT NOT NULL DEFAULT 'Bearer',
  expires_at      TEXT DEFAULT NULL,
  scopes          TEXT DEFAULT NULL,
  account_label   TEXT DEFAULT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### New: `skill_repos`
```sql
CREATE TABLE IF NOT EXISTS skill_repos (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  repo_url        TEXT NOT NULL,
  repo_type       TEXT NOT NULL DEFAULT 'official',
  branch          TEXT NOT NULL DEFAULT 'main',
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_synced_at  TEXT DEFAULT NULL,
  sync_error      TEXT DEFAULT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Modified: `skills` table (add source tracking)
```sql
ALTER TABLE skills ADD COLUMN source TEXT DEFAULT 'local';
ALTER TABLE skills ADD COLUMN definition_id TEXT DEFAULT NULL;
```

---

## 7. Refresh Mechanism

### Auto-Refresh
- On Skills page mount: `useEffect` checks each enabled repo's `last_synced_at`
- If older than 24 hours → triggers `syncSkillRepos()`
- Silent background operation — no UI interruption

### Manual Refresh
- Muted `RefreshCw` icon button in Skills page header (zinc-500 text, thin border)
- Animates with `animate-spin` while syncing
- Tooltip: "Refresh skills from repositories"

### Sync Engine (`src/lib/skillsRepository.ts`)

```
Fetch manifest.json → compare checksums → fetch only changed skills → validate → upsert
```

1. `fetchManifest(repoUrl, branch)` — one HTTP call to get file list + checksums
2. Compare each checksum against `skill_definitions.checksum` in DB
3. Only fetch changed skill JSON files (minimize API calls)
4. `parseAndValidateSkill(raw)` — JSON parse + schema validation
5. `saveSkillDefinition()` — upsert into `skill_definitions` table
6. Update `skill_repos.last_synced_at`

**GitHub raw URLs**: `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}`
Public repos have permissive CORS. Private repos need a GitHub token in the vault.

**Rate limits**: Unauthenticated GitHub API: 60/hour. Manifest approach = 1 + N changed files per sync. With daily sync, this is well within limits.

---

## 8. Test Dialog UX

### Component: `src/components/Skills/SkillTestDialog.tsx`

```
+-----------------------------------------------+
|  TEST SKILL: Research Web               [X]   |
|-----------------------------------------------|
|  Command: [search           v]                 |
|                                               |
|  PARAMETERS                                    |
|  +-----------------------------------------+  |
|  | query*     [                           ] |  |
|  | max_results [ 10                       ] |  |
|  +-----------------------------------------+  |
|                                               |
|  [ RUN TEST ]                                 |
|                                               |
|  RESULT                                        |
|  +-----------------------------------------+  |
|  | {                                       |  |
|  |   "status": "success",                 |  |
|  |   "results": [...]                      |  |
|  | }                                       |  |
|  +-----------------------------------------+  |
|                                               |
|  Elapsed: 1.2s  |  Tokens: 847  |  Cost: ~$0.01|
+-----------------------------------------------+
```

**State machine**: `idle → running → success | error`

**Parameter form** (auto-generated from command's `parameters`):
- `string` → text input
- `number` → number input
- `boolean` → toggle switch
- `object` / `array` → JSON textarea
- Required params: asterisk marker
- Optional params: show `default` as placeholder

**Phase 1 (no backend)**: Dry-run mode — shows the interpolated API payload / cURL command
**Phase 2 (with backend)**: Live execution — sends request and shows real response

**Integration**: Test button (FlaskConical icon) on each skill card, visible when skill is enabled and has required credentials.

---

## 9. OAuth Flow (PKCE)

Since there's no backend, OAuth uses Authorization Code + PKCE flow:

1. Generate `code_verifier` (random 43-128 chars) and `code_challenge` (SHA-256, base64url)
2. Open provider's auth URL in a popup with `code_challenge`
3. User authorizes in popup
4. Redirect to `http://localhost:5173/oauth/callback` (dev) or production URL
5. Exchange authorization code + `code_verifier` for tokens
6. Store in `oauth_connections` table

### Callback Route
Add `<Route path="/oauth/callback" element={<OAuthCallback />} />` in App.tsx.

### Token Refresh
Check `expires_at` before each use. Auto-refresh if within 5 minutes of expiry.

### Vault Integration
OAuth connections shown in a new section on the Vault page with: provider, scopes, expiry, account label, disconnect button.

---

## 10. Migration Path

### Phase 1: Dual Source (backward compatible)
- `skillDefinitions.ts` remains as hardcoded fallback
- New `skillResolver.ts` merges: hardcoded → official repo → marketplace
- `resolveSkills()` returns `ResolvedSkillDefinition[]` with user config attached
- SkillsView imports from resolver instead of hardcoded

### Phase 2: Seed Skills Repo
- Create 13 JSON files in `/seed_skills_repo/`
- Add official repo as default entry in `skill_repos` during `initDatabase()`

### Phase 3: Steady State
- Hardcoded `skillDefinitions.ts` serves only as offline/first-boot fallback
- All runtime skill data comes from synced repos
- User's enabled/model preferences always preserved in `skills` table

### Icon Resolution
JSON files use string icon names. New `src/lib/iconResolver.ts` maps strings to Lucide components:
```typescript
import { Mail, Globe, Code, Image, ... } from 'lucide-react';
const iconMap = { Mail, Globe, Code, Image, ... };
export function resolveIcon(name: string): React.ElementType;
// Fallback: Puzzle icon for unknown names
```

---

## 11. New Files Summary

| File | Purpose |
|------|---------|
| `src/lib/skillsRepository.ts` | GitHub sync engine (fetch manifest, diff checksums, fetch changed) |
| `src/lib/skillResolver.ts` | Merge hardcoded + cached + user config |
| `src/lib/iconResolver.ts` | Map string icon names to Lucide components |
| `src/lib/oauthFlow.ts` | PKCE OAuth popup flow + token management |
| `src/types/skills.ts` | ResolvedSkillDefinition, SkillCommand, SkillParameter, OAuthConfig types |
| `src/components/Skills/SkillTestDialog.tsx` | Themed test dialog with param form + result panel |
| `seed_skills_repo/` | 13 JSON files + schema + manifest + LICENSE + README |
