# Jarvis Inc. — God View Dashboard

A hybrid dual-tone dashboard for commanding an autonomous AI workforce. Corporate-cold command center meets retro pixel art surveillance.

![Stack](https://img.shields.io/badge/React_18-TypeScript-blue) ![Stack](https://img.shields.io/badge/Vite_6-Tailwind_CSS_3-purple) ![Stack](https://img.shields.io/badge/SQLite-sql.js_(WASM)-green) ![Supabase](https://img.shields.io/badge/Supabase-Self--Hosted-darkgreen) ![Caddy](https://img.shields.io/badge/Caddy-Reverse_Proxy-blue)

---

## Quick Start

### One Command (Full Stack)

Boots Docker + Supabase + Postgres, writes configs, starts the dev server. Zero prompts.

```bash
git clone https://github.com/GGCryptoh/jarvis_inc.git
cd jarvis_inc
npm install
npm run jarvis
```

This runs `setup --auto` (generates secrets, starts Docker, waits for all services) then `npm run dev`. Open [http://localhost:5173](http://localhost:5173).

### Demo Mode (No Backend)

Runs entirely in-browser with sql.js + IndexedDB. No Docker, no Supabase.

```bash
npm install
npm run dev
```

### NPM Scripts

| Command | What it does |
|---------|-------------|
| `npm run jarvis` | One-command full stack: auto-setup Docker + Supabase + dev server |
| `npm run dev` | Vite dev server only (no Docker) |
| `npm run setup` | Interactive setup — prompts for domain, SSL, passwords, Studio auth |
| `npm run setup:check` | Health-check all running services |
| `npm run build` | TypeScript check + Vite production build → `dist/` |
| `npm run preview` | Preview production build locally |

### Docker (Frontend Only)

```bash
docker build -t jarvis-inc .
docker run -p 3000:80 jarvis-inc
```

Open [http://localhost:3000](http://localhost:3000). Multi-stage build: `node:20-alpine` → `nginx:alpine`.

---

## Full Stack Setup (Supabase + Caddy + Passkeys)

For persistent server-side data, auth, real-time updates, and CEO autonomous scheduling.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Caddy (reverse proxy)                                  │
│  ├── jarvis.local          → Jarvis frontend            │
│  ├── api.jarvis.local      → Supabase API (Kong)        │
│  └── studio.jarvis.local   → Supabase Studio (auth'd)   │
├─────────────────────────────────────────────────────────┤
│  Jarvis Frontend (React SPA)                            │
│  ├── Demo mode: sql.js + IndexedDB (browser-local)      │
│  └── Full mode: Supabase client (Postgres + Realtime)   │
├─────────────────────────────────────────────────────────┤
│  Supabase Self-Hosted                                   │
│  ├── Postgres 15 (data)                                 │
│  ├── GoTrue (auth + passkeys/WebAuthn)                  │
│  ├── PostgREST (REST API)                               │
│  ├── Realtime (WebSocket subscriptions)                 │
│  ├── Kong (API gateway)                                 │
│  ├── Studio (DB admin UI, basic-auth protected)         │
│  └── pg_meta (Studio metadata)                          │
└─────────────────────────────────────────────────────────┘
```

### Prerequisites

- **Node.js** >= 18 (for the setup script)
- **Docker** & Docker Compose v2
- A machine with **2GB+ RAM** (Supabase runs ~8 containers)
- (Optional) A domain name pointed at your server for Let's Encrypt HTTPS

### Step 1: Run the Setup Script

The interactive setup script generates all secrets, configures `.env`, starts Docker, and verifies services.

```bash
npm run setup
```

It will walk you through:
1. **Domain** — `jarvis.local` for LAN, or your real domain for internet
2. **SSL mode** — Self-signed (default), Let's Encrypt, or off
3. **Postgres password** — hidden input
4. **Studio credentials** — username + password for the admin UI
5. **Auto-generates**: JWT secret, Supabase anon/service keys, Realtime secret
6. **Writes** `docker/.env` with all values
7. **Starts** `docker compose up -d`
8. **Health-checks** each service (Jarvis, API, Auth, Studio)

> **Future**: This will also be available as a one-liner curl install:
> `curl -fsSL https://raw.githubusercontent.com/GGCryptoh/jarvis_inc/main/docker/setup.mjs | node`

### Step 2: Add Hosts Entries (LAN only)

If using `jarvis.local` (or any non-public domain), add to your hosts file:

**Windows** (`C:\Windows\System32\drivers\etc\hosts`):
```
127.0.0.1  jarvis.local
127.0.0.1  api.jarvis.local
127.0.0.1  studio.jarvis.local
```

**macOS / Linux** (`/etc/hosts`):
```
127.0.0.1  jarvis.local
127.0.0.1  api.jarvis.local
127.0.0.1  studio.jarvis.local
```

### Step 3: Verify

```bash
npm run setup:check
```

This runs health checks against all services. You should see:

```
  ✓ Jarvis Frontend — online
  ✓ Supabase API (Kong) — online
  ✓ Supabase Auth (GoTrue) — online
  ✓ Supabase Studio — online
```

| Service | URL |
|---------|-----|
| Jarvis Dashboard | `https://jarvis.local` |
| Supabase API | `https://api.jarvis.local` |
| Supabase Studio | `https://studio.jarvis.local` (basic auth) |

### Manual Setup (alternative)

If you prefer to configure manually instead of using the script:

```bash
cd docker
cp .env.example .env
# Edit .env — see .env.example for all values and generation instructions
docker compose up -d
```

### SSL Options

| Mode | `.env` Setting | Use Case |
|------|---------------|----------|
| **Self-signed** (default) | `CADDY_TLS=internal` | LAN / local dev. Browser will warn — accept the cert. |
| **Let's Encrypt** | `CADDY_TLS=` (empty) | Internet-facing. Port 80 must be reachable for HTTP challenge. |
| **No SSL** | `CADDY_TLS=off` | Behind another proxy, or trusted LAN only. |

For Let's Encrypt with HTTP verification:
1. Point your domain's DNS A record to your server IP
2. Ensure port 80 is open (Caddy needs it for the ACME HTTP-01 challenge)
3. Set `CADDY_TLS=` (empty string) in `.env`
4. Set `DOMAIN=yourdomain.com`
5. `docker compose up -d` — Caddy provisions certs automatically

### Passkey Auth (WebAuthn)

Passkeys are enabled by default via Supabase GoTrue. Requirements:
- HTTPS (self-signed OK for dev, Let's Encrypt for production)
- A consistent `DOMAIN` (the WebAuthn RP ID)

Users can register with email + password, then enroll a passkey for passwordless login.

### Studio Protection

Supabase Studio (the admin UI) is protected by Caddy basic auth. Only users with the `STUDIO_USER` / `STUDIO_PASS_HASH` credentials can access `studio.${DOMAIN}`.

To restrict Studio to specific IPs instead (or in addition):

```caddyfile
# In docker/Caddyfile, add to the studio block:
studio.{$DOMAIN} {
    @blocked not remote_ip 192.168.1.0/24 10.0.0.0/8
    respond @blocked 403
    basicauth { ... }
    reverse_proxy supabase-studio:3000
}
```

---

## First Run Experience

1. **Founder Ceremony** — CRT terminal boot sequence. Enter callsign + org name.
2. **CEO Ceremony** — Designate AI CEO: callsign, LLM model (14 options / 6 providers), personality archetype (8 options), philosophy, risk tolerance. Optionally provide an API key.
3. **Dashboard** — Land on main dashboard with live stats from DB.
4. **Surveillance** — First visit triggers **CEO Walk-in Ceremony**: sprite walks in, celebrates with retro jingle, takes their desk.
5. **Chat Onboarding** — CEO asks about your mission, recommends skills, runs a test interaction. LLM streaming when API key is vaulted.

Data persists across browser sessions (IndexedDB in demo mode, Postgres in full mode).

---

## Features

### Shipped & Functional

| Feature | Description |
|---------|-------------|
| **Founder Ceremony** | Terminal boot → callsign + org form → activation |
| **CEO Ceremony** | 8 personality archetypes, model/philosophy/risk selection, API key validation |
| **CEO Walk-in** | Sprite walk → celebrate → jingle → desk |
| **Agent Hire Ceremony** | Same walk/celebrate/desk flow for new agents |
| **Chat System** | Onboarding + persistent conversations, sidebar, archive/delete |
| **LLM Streaming** | Real API calls to Anthropic, OpenAI, Google, DeepSeek, xAI with token-by-token streaming |
| **CEO Personality** | System prompt assembled from archetype + philosophy + risk tolerance + org context |
| **Dashboard** | Live stats from DB: agent count, missions, budget. Editable primary mission. |
| **Missions Kanban** | 4-column board from DB with recurring mission support |
| **Skills Page** | 18 skills / 4 categories, toggles, model selectors, filter + search |
| **Approvals** | Pending queue + history, `skill_enable` + `api_key_request` types, cross-component sync |
| **Vault** | API key CRUD, 14 models → 6 services, dependency warnings, setup hints |
| **Surveillance** | Pixel office, 4 floor tiers (auto-upgrade), floor planner mode, 7 animation states |
| **Agent Management** | Hire (live sprite preview), edit, fire with confirmation |
| **Financials** | Budget editing with CRT-themed UI, bar chart + table |
| **Sound System** | Web Audio API synthesized jingles (no audio files). Test at [`/soundtest`](http://localhost:5173/soundtest) — keyboard: Space (play/pause), Esc (stop), N/P (next/prev) |
| **Reset DB** | Fire CEO / Shutter Business / Full Reset |

### Partial (UI exists, wiring needed)

| Feature | Status |
|---------|--------|
| Audit Log | Dummy log with filter — needs real event recording |
| CEO Pip | Shows name + color — needs real heartbeat state |

### Planned

| Phase | Features |
|-------|----------|
| **Supabase** | Dual-mode boot, auth with passkeys, Postgres backend, Realtime |
| **CEO Autonomy** | Scheduler, decision engine, proactive chat, agent factory |
| **Agent Runtime** | Task execution with LLM, mid-task approvals, cost tracking |
| **Governance** | Permissions, budget enforcement, kill switch, extended approvals |
| **Modules** | Gallery, System Stats, Channels/Telegram |

---

## Navigation

| Tab | Route | Status |
|-----|-------|--------|
| Dashboard | `/dashboard` | **Live** — real DB stats |
| Chat | `/chat` | **Live** — LLM streaming + history |
| Approvals | `/approvals` | **Live** — pending queue + badge |
| Missions | `/missions` | **Live** — Kanban from DB (CRUD planned) |
| Surveillance | `/surveillance` | **Live** — pixel office + ceremonies |
| Skills | `/skills` | **Live** — 18 skills with toggles |
| The Vault | `/vault` | **Live** — API key management |
| Audit | `/audit` | Placeholder |
| Financials | `/financials` | **Live** — editable budget |
| Sample | `/sample-surveillance` | Demo mode (no DB) |
| Sound Test | `/soundtest` | Jingle player with keyboard controls |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite 6 |
| Styling | Tailwind CSS 3 (dual palette: `jarvis-*` + `pixel-*`) |
| Routing | React Router 6 |
| Icons | Lucide React |
| Demo DB | sql.js (SQLite → WASM) + IndexedDB |
| Full DB | Supabase self-hosted (Postgres 15) |
| Auth | Supabase GoTrue (email + passkeys/WebAuthn) |
| Realtime | Supabase Realtime (WebSocket) |
| Reverse Proxy | Caddy 2 (auto HTTPS) |
| LLM Providers | Anthropic, OpenAI, Google, DeepSeek, xAI |
| Audio | Web Audio API (retro jingle) |

---

## Design Documents

Architecture docs in `/AI/`:

| Document | Contents |
|----------|----------|
| `CEO-Agent-System.md` | Scheduler, decision engine, agent factory, task execution |
| `CEO-Designate.md` | 8 personality archetypes, prompt assembly |
| `CEO/CEO-Prompts.md` | All prompt templates: CEO, agent, chat |
| `CEO-Communication-Loop.md` | Proactive CEO behavior, triggers, action cards |
| `Chat-Onboarding-Flow.md` | Scripted onboarding state machine |
| `Approval-System.md` | Types, lifecycle, cross-component sync |
| `Skills-Architecture.md` | 18 skills, categories, agent assignment model |
| `Data-Layer.md` | Schema, dual-mode plan (sql.js vs Supabase) |
| `Ceremonies.md` | All ceremony state machines |
| `Surveillance.md` | Pixel office, sprites, floors, animations |

---

## Project Structure

```
jarvis_inc/
├── index.html                    # Vite entry + Google Fonts + favicon
├── package.json                  # React 18, Vite 6, Tailwind 3, sql.js
├── vite.config.ts                # React plugin + LLM API proxy
├── tailwind.config.js            # Dual palette (jarvis-* + pixel-*)
├── Dockerfile                    # Frontend only: node:20-alpine → nginx:alpine
├── CLAUDE.md                     # AI assistant project guide
├── TASKS.md                      # Phased roadmap & gap analysis
├── docker/
│   ├── docker-compose.yml        # Full stack: Supabase + Caddy + Jarvis
│   ├── Caddyfile                 # Reverse proxy config (3 routes)
│   ├── .env.example              # All environment variables
│   └── supabase/
│       ├── kong.yml              # API gateway routes
│       └── migrations/           # Postgres schema + RLS
├── AI/                           # Architecture & design docs (10 files)
├── seed_skills_repo/             # 18 skill JSON files + schema + manifest
├── public/
│   ├── sql-wasm.wasm             # sql.js WebAssembly binary
│   ├── favicon.png
│   └── floors/                   # Pixel art floor backgrounds (4 tiers)
└── src/
    ├── main.tsx                  # React entry
    ├── App.tsx                   # DB gate → Ceremonies | AppLayout
    ├── index.css                 # Tailwind + CRT/retro/sprite CSS
    ├── lib/
    │   ├── database.ts           # SQLite singleton, 10-table schema, CRUD
    │   ├── models.ts             # 14 models, model→service map, API model IDs
    │   ├── sounds.ts             # Web Audio API jingle
    │   ├── ceoResponder.ts       # Scripted CEO fallback responses
    │   ├── skillRecommender.ts   # Keyword → skill matching
    │   ├── positionGenerator.ts  # Desk/meeting position math
    │   └── llm/
    │       ├── types.ts          # LLMMessage, StreamCallbacks, LLMProvider
    │       ├── chatService.ts    # CEO prompt builder + stream orchestrator
    │       └── providers/        # Anthropic, OpenAI, Google streaming
    ├── hooks/
    │   └── useDatabase.ts        # Boot hook
    ├── types/
    │   └── index.ts              # Agent, CEO, Mission types
    ├── data/
    │   ├── dummyData.ts          # Mock data for placeholder pages
    │   └── skillDefinitions.ts   # 18 skill definitions
    └── components/
        ├── FounderCeremony/      # Terminal boot → form → activation
        ├── CEOCeremony/          # CEO designation + archetype + API key
        ├── Layout/               # AppLayout, NavigationRail, ResetDBDialog
        ├── Surveillance/         # PixelOffice, AgentSprite, CEOSprite, etc.
        ├── Chat/                 # ChatView, ChatThread, ChatSidebar, OnboardingFlow
        ├── Approvals/            # Pending queue + history
        ├── Skills/               # 18-skill grid
        ├── Dashboard/            # Stats + ops table + fleet
        ├── Missions/             # Kanban board
        ├── Vault/                # API key management
        ├── Audit/                # Event log
        └── Financials/           # Budget charts
```

---

## License

Private — Jarvis Inc.
