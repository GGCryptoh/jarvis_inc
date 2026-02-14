# Jarvis Inc — Workspace Gateway

> Docker service that provides sandboxed filesystem workspaces for skills
> that produce artifacts: images, documents, code, web apps, and more.

**Parent doc**: `AI/Jarvis-Memory-Agent-Workspace-Architecture.md` (Section E)
covers the high-level workspace model. This doc is the **implementation spec**
for the Docker service, API, and frontend integration.

---

## Why a Gateway?

The edge function (`execute-skill`) runs in Deno — it can call HTTP APIs and
LLMs, but it **cannot** run CLI tools, write files, or host web apps. Some
skills need a real filesystem:

| Skill Type | Example | Needs Gateway? |
|------------|---------|----------------|
| LLM text | Research Web, summarize | No — edge function handles |
| API call | DALL-E image gen, weather | No — edge function handles (HTTP fetch) |
| CLI tool | curl, ffmpeg, pandoc | **Yes** — needs shell |
| Code gen | Claude CLI, npm init | **Yes** — needs filesystem + CLI |
| Web app | SPA builder, landing page | **Yes** — needs filesystem + serve |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Docker Compose Stack                                           │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────────┐   │
│  │  Supabase    │   │  Edge Funcs  │   │  jarvis-gateway   │   │
│  │  (Postgres,  │   │  (Deno)      │   │  (Node/Express)   │   │
│  │   Auth,      │◄──┤              ├──►│                   │   │
│  │   Realtime,  │   │ execute-skill│   │  /api/execute     │   │
│  │   Storage)   │   │              │   │  /api/artifacts   │   │
│  └──────────────┘   └──────────────┘   │  /workspace/...   │   │
│                                        │                   │   │
│                                        │  Volume:          │   │
│                                        │  /workspace/      │   │
│                                        └───────────────────┘   │
│                                               │                │
│  ┌────────────────────────────────────────────┘                │
│  │  Persistent Volume: jarvis-workspace                        │
│  │  /workspace/                                                │
│  │  ├── {org_slug}/                                            │
│  │  │   ├── missions/                                          │
│  │  │   │   ├── {mission_id}/                                  │
│  │  │   │   │   ├── .jarvis/        (metadata, read-only)      │
│  │  │   │   │   ├── images/         (DALL-E, Stability, etc)   │
│  │  │   │   │   ├── documents/      (PDFs, reports, data)      │
│  │  │   │   │   ├── code/           (snippets, scripts)        │
│  │  │   │   │   └── webapp/         (SPAs, static sites)       │
│  │  │   └── shared/                                            │
│  │  │       ├── templates/                                     │
│  │  │       └── configs/                                       │
│  │  └── .jarvis-global/                                        │
│  └─────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
/workspace/{org_slug}/missions/{mission_id}/
├── .jarvis/
│   ├── mission.json        # Mission brief snapshot (read-only)
│   ├── agent.json          # Assigned agent info
│   ├── manifest.json       # Artifact registry (what was produced)
│   └── log.jsonl           # Execution log (appended per operation)
├── images/                 # Image artifacts
│   ├── hero-banner.png
│   └── logo-v2.png
├── documents/              # Document artifacts
│   ├── market-report.pdf
│   ├── competitors.xlsx
│   └── summary.md
├── code/                   # Code artifacts
│   ├── scraper.py
│   └── data-pipeline/
│       ├── package.json
│       └── src/
├── webapp/                 # Servable web applications
│   ├── index.html
│   ├── dist/               # Built SPA output
│   └── package.json
└── data/                   # Raw data, JSON, CSV
    ├── results.json
    └── weather-history.csv
```

### Artifact Manifest (`.jarvis/manifest.json`)

Every file produced by a skill gets registered here so the frontend knows
what exists and can link to it from Collateral/Chat.

```json
{
  "mission_id": "mission-abc123",
  "org_slug": "jarvis-inc",
  "artifacts": [
    {
      "id": "art-001",
      "type": "image",
      "path": "images/hero-banner.png",
      "mime_type": "image/png",
      "skill_id": "create-images",
      "command": "generate",
      "created_at": "2026-02-13T14:30:00Z",
      "size_bytes": 245760,
      "metadata": {
        "prompt": "futuristic office dashboard",
        "model": "dall-e-3",
        "revised_prompt": "A sleek futuristic..."
      }
    },
    {
      "id": "art-002",
      "type": "webapp",
      "path": "webapp/",
      "mime_type": "text/html",
      "skill_id": "execute-claude-cli",
      "command": "execute",
      "created_at": "2026-02-13T15:00:00Z",
      "serve_url": "/workspace/jarvis-inc/missions/mission-abc123/webapp/dist/",
      "metadata": {
        "framework": "react",
        "build_command": "npm run build"
      }
    }
  ]
}
```

---

## Gateway Docker Service

### Dockerfile (`docker/gateway/Dockerfile`)

```dockerfile
FROM node:20-alpine

RUN apk add --no-cache curl ffmpeg pandoc python3 py3-pip

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY . .

EXPOSE 3100

ENV WORKSPACE_ROOT=/workspace
ENV SUPABASE_URL=http://supabase-kong:8000
ENV SUPABASE_SERVICE_ROLE_KEY=

CMD ["node", "server.js"]
```

### docker-compose addition

```yaml
jarvis-gateway:
  build: ./docker/gateway
  ports:
    - "3100:3100"
  volumes:
    - jarvis-workspace:/workspace
  environment:
    - SUPABASE_URL=http://supabase-kong:8000
    - SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
    - WORKSPACE_ROOT=/workspace
  depends_on:
    - supabase-kong
  networks:
    - jarvis-network

volumes:
  jarvis-workspace:
```

---

## Gateway API

### `POST /api/execute`

Execute a CLI skill in a sandboxed workspace.

```json
{
  "task_execution_id": "task-123",
  "skill_id": "weather-cli",
  "command_name": "get_forecast",
  "params": { "location": "Philadelphia" },
  "mission_id": "mission-abc",
  "org_slug": "jarvis-inc"
}
```

The gateway:
1. Creates `/workspace/{org_slug}/missions/{mission_id}/` if needed
2. Writes `.jarvis/mission.json` metadata
3. Executes the skill command (CLI binary, Claude CLI, etc.)
4. Captures output (stdout, files created, exit code)
5. Registers artifacts in `.jarvis/manifest.json`
6. Updates `task_executions` in Supabase with result
7. Returns result to caller

### `GET /api/artifacts/:org/:mission`

List all artifacts for a mission.

```json
{
  "artifacts": [
    { "id": "art-001", "type": "image", "path": "images/hero.png", "url": "/workspace/jarvis-inc/missions/m-123/images/hero.png" }
  ]
}
```

### `GET /workspace/:org/missions/:mission/*`

Static file serving. Any file in a mission workspace is accessible via URL.
This is how the frontend displays images, opens PDFs, previews web apps.

**Security**: Validate `org_slug` matches the current session. No path
traversal (`..`). Only serve from within `/workspace/`.

### `POST /api/claude-cli`

Special endpoint for coding agent — runs Claude CLI in a workspace.

```json
{
  "workspace": "/workspace/jarvis-inc/missions/m-456/code/webapp/",
  "prompt": "Build a React app with auth",
  "mode": "yolo",
  "model": "claude-sonnet-4-5-20250929",
  "timeout_minutes": 15,
  "token_budget": 50000
}
```

Requires Claude CLI installed in the gateway container.

---

## Edge Function → Gateway Flow

When the edge function gets a `cli` skill that needs a real filesystem:

```
Edge Function (execute-skill)
  │
  ├─ connection_type === "cli"
  │   ├─ Has CLI_HTTP_HANDLER? (e.g. weather via wttr.in)
  │   │   └─ Handle directly via HTTP fetch ✓
  │   │
  │   └─ No HTTP handler? Route to gateway:
  │       POST http://jarvis-gateway:3100/api/execute
  │       { task_execution_id, skill_id, command_name, params, ... }
  │
  └─ Gateway returns result → edge function updates task_execution
```

For skills that produce files (images from DALL-E, code from Claude CLI):

```
Edge Function
  │
  ├─ Skill produces artifact (image URL, generated files)
  │
  ├─ POST gateway /api/artifacts/register
  │   { mission_id, artifact: { type, url/content, mime_type } }
  │
  ├─ Gateway downloads/saves to workspace filesystem
  │   /workspace/{org}/missions/{mission}/images/generated-123.png
  │
  └─ Gateway returns serve URL:
     http://localhost:3100/workspace/{org}/missions/{mission}/images/generated-123.png
```

---

## Artifact Types & Skill Mapping

| output_type | Storage Dir | Served As | Collateral View |
|-------------|-------------|-----------|-----------------|
| `text` | `documents/` | Raw text or markdown | Inline text card |
| `image` | `images/` | Direct URL `<img>` | Thumbnail + lightbox |
| `audio` | `audio/` | `<audio>` player | Audio player card |
| `data` | `data/` | JSON download | Table or chart card |
| `webapp` | `webapp/dist/` | Static site (`index.html`) | "Open App" button → iframe or new tab |
| `code` | `code/` | Syntax-highlighted view | Code viewer card |
| `document` | `documents/` | PDF.js viewer / download | Document card with preview |

---

## Frontend Integration

### Chat: Artifact Links

When the CEO says "Done — generated your banner image", the chat message
metadata includes:

```json
{
  "type": "mission_complete",
  "artifacts": [
    {
      "type": "image",
      "url": "http://localhost:3100/workspace/jarvis-inc/missions/m-123/images/hero.png",
      "thumbnail_url": "http://localhost:3100/workspace/jarvis-inc/missions/m-123/images/hero.png?w=300",
      "label": "Hero Banner"
    }
  ]
}
```

The `RichResultCard` component renders this as an inline image card with
"VIEW IN COLLATERAL" link.

### Collateral Page

The Collateral page queries the gateway for all artifacts across missions:

```
GET /api/artifacts/{org}?type=image&limit=50
```

Renders a grid of artifact cards grouped by mission, with type-specific
previews (image thumbnails, document icons, "Open App" buttons for webapps).

### Surveillance: Agent Activity

When an agent is working in a workspace, the `.jarvis/log.jsonl` file
is tailed and shown in the agent's thought bubble or detail panel:

```
"compiling..."  →  "47 files created"  →  "running tests..."
```

---

## setup.mjs Integration

The `docker/setup.mjs` script needs to:

1. **Build the gateway image**: `docker compose build jarvis-gateway`
2. **Create the workspace volume**: Automatically via docker-compose
3. **Health check**: `GET http://localhost:3100/health` → `{ "status": "ok" }`
4. **Initialize org workspace**: `POST /api/init` with org slug from settings
5. **Print URL**: `Workspace Gateway: http://localhost:3100`

---

## Security

- **Path validation**: All file paths validated against `/workspace/{org}/missions/` prefix. No `..` traversal.
- **Org isolation**: Each org gets its own root directory. Gateway validates org matches the authenticated session.
- **Read-only metadata**: `.jarvis/` directories are written by the gateway only, not by skill execution.
- **Resource limits**: Claude CLI executions have timeout + token budget. Process killed if exceeded.
- **No network escape**: Workspace container on internal Docker network only. Internet access only through explicit proxy for skills that need it (curl, npm install).
- **Volume cleanup**: Completed/archived missions can be cleaned up (artifacts moved to Supabase Storage for long-term, workspace dir deleted).

---

## Dynamic App Serving (nginx reverse proxy)

When a coding agent builds a web app in a workspace, it needs to be
**servable at a known URL** so the founder can click "Open App" in
Collateral/Chat and see it live.

### The Problem

Built SPAs need a web server. Dev servers (`npm run dev`) need ports.
Multiple missions could each produce a web app. We can't hardcode ports.

### Solution: Dynamic nginx + port registry

```
┌────────────────────────────────────────────────────────┐
│  jarvis-gateway container                              │
│                                                        │
│  ┌─────────────┐    ┌──────────────────────────────┐   │
│  │  Express     │    │  nginx (reverse proxy)       │   │
│  │  :3100       │    │  :3200                       │   │
│  │              │    │                              │   │
│  │  /api/*      │    │  /apps/{mission_id}/         │   │
│  │  /workspace/ │    │    → localhost:{port}/       │   │
│  └─────────────┘    └──────────────────────────────┘   │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Port Registry (in-memory + Supabase)            │  │
│  │                                                  │  │
│  │  mission-abc → :4001 (React SPA, npm run dev)    │  │
│  │  mission-def → :4002 (Next.js app)               │  │
│  │  mission-ghi → static (pre-built, nginx direct)  │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

### Two serving modes

**1. Static (pre-built)** — For SPAs that run `npm run build` and produce
a `dist/` folder. nginx serves directly from the workspace filesystem:

```nginx
location /apps/{mission_id}/ {
    alias /workspace/{org}/missions/{mission_id}/webapp/dist/;
    try_files $uri $uri/ /apps/{mission_id}/index.html;
}
```

**2. Dev server (dynamic port)** — For apps that need a running process
(`npm run dev`, `python -m http.server`, etc.). The gateway:

1. Allocates a port from the pool (4001-4099)
2. Starts the dev server as a child process in the workspace directory
3. Registers the port in the registry
4. nginx proxies `/apps/{mission_id}/` → `localhost:{port}/`
5. Process lifecycle tracked — killed on mission archive/cleanup

### Port allocation

```json
{
  "port_pool": { "start": 4001, "end": 4099 },
  "active": {
    "mission-abc": { "port": 4001, "pid": 12345, "command": "npm run dev", "started_at": "..." },
    "mission-def": { "port": 4002, "pid": 12346, "command": "npx next dev", "started_at": "..." }
  }
}
```

### nginx config generation

When a new app is registered, the gateway regenerates the nginx config
and signals nginx to reload (`nginx -s reload`):

```
# Auto-generated by jarvis-gateway
# Static apps
location /apps/mission-ghi/ {
    alias /workspace/jarvis-inc/missions/mission-ghi/webapp/dist/;
    try_files $uri $uri/ /apps/mission-ghi/index.html;
}

# Dev server proxies
location /apps/mission-abc/ {
    proxy_pass http://127.0.0.1:4001/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";  # WebSocket support for HMR
}
```

### Frontend "Open App" flow

1. CEO/Collateral shows: `[OPEN APP →]` button
2. Button href: `http://localhost:3200/apps/{mission_id}/`
3. Opens in new tab (or iframe in Collateral preview panel)
4. The gateway's nginx serves the app transparently

### API endpoints

```
POST /api/apps/start
  { mission_id, org_slug, command: "npm run dev", cwd: "webapp/" }
  → { port: 4001, url: "http://localhost:3200/apps/mission-abc/" }

POST /api/apps/stop
  { mission_id }
  → { stopped: true }

GET /api/apps
  → [{ mission_id, port, url, status, started_at }]

POST /api/apps/build
  { mission_id, org_slug, build_command: "npm run build", output_dir: "dist/" }
  → { url: "http://localhost:3200/apps/mission-abc/", mode: "static" }
```

---

## Implementation Order

1. **Phase 1: File serving** — Static file server at `/workspace/`, artifact registration API, docker-compose service. Enough for image/document skills to save and serve files.
2. **Phase 2: CLI executor** — Shell command execution with output capture. Weather CLI, curl-based skills, ffmpeg.
3. **Phase 3: App serving + Collateral UI** — nginx reverse proxy, port registry, `POST /api/apps/start|stop|build`. Collateral page shows running apps grid with on/off toggle, "Open" button, port/URL info, and resource usage.
4. **Phase 4: Claude CLI** — Install Claude CLI in container, implement `/api/claude-cli` endpoint, sandbox policies, log streaming.
5. **Phase 5: Full Collateral integration** — Artifact browser grouped by mission, type-specific previews (image lightbox, PDF viewer, code syntax highlighting, app iframe), download/share links.

---

## Migration from Current State

Currently:
- Image gen returns URLs from OpenAI (temporary, expire after 1 hour)
- Weather uses HTTP fetch in edge function (no gateway needed)
- No CLI execution capability

After gateway:
- Image gen downloads to workspace, permanent URLs via gateway
- Weather still uses HTTP fetch (fast path stays)
- CLI skills route to gateway when no HTTP handler exists
- Coding agent gets full workspace + Claude CLI
