# Jarvis Inc. — God View Dashboard

A hybrid dual-tone dashboard for commanding an autonomous AI workforce. Corporate-cold command center meets retro pixel art surveillance.

![Stack](https://img.shields.io/badge/React_18-TypeScript-blue) ![Stack](https://img.shields.io/badge/Vite_6-Tailwind_CSS_3-purple) ![Stack](https://img.shields.io/badge/SQLite-sql.js_(WASM)-green) ![Stack](https://img.shields.io/badge/No_Backend-Client--Side_Only-orange)

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9

### Clone & Run

```bash
git clone https://github.com/GGCryptoh/jarvis_inc.git
cd jarvis_inc
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Production Build

```bash
npm run build        # TypeScript check + Vite build → dist/
npm run preview      # Preview the production build locally
```

---

## First Run Experience

On first launch, you'll go through a cinematic onboarding sequence:

1. **Founder Ceremony** — A CRT-themed terminal boot sequence registers you as the system commander. Enter your callsign and organization name. Your name is saved as-typed; displayed UPPERCASED during ceremonies.

2. **CEO Ceremony** — Designate your AI CEO: choose a callsign, select an LLM model (14 options across 6 providers), set a management philosophy (4 presets or custom), and pick a risk tolerance level (conservative / moderate / aggressive). Optionally provide an API key for the CEO's model.

3. **Dashboard** — You land on the main dashboard. Navigate using the left rail.

4. **Surveillance** — First visit to the Surveillance page triggers the **CEO Walk-in Ceremony**: the office door opens, the CEO sprite walks in, celebrates with a retro jingle, then walks to their desk. A floating notification invites you to a CEO meeting.

5. **Chat Onboarding** — Click APPROVE on the meeting notification to enter the Chat page. The CEO asks about your primary mission, recommends skills based on keywords, creates a skill-enable approval, and runs a simulated test to demonstrate the flow.

After onboarding, all pages are accessible and data persists across browser sessions via IndexedDB.

---

## Features

### Shipped & Functional

| Feature | Description |
|---------|-------------|
| **Founder Ceremony** | Terminal boot → callsign + org name form → activation animation |
| **CEO Ceremony** | CEO designation form (model, philosophy, risk tolerance) → progress bar → activation |
| **CEO Walk-in Ceremony** | Door animation → walk to center → celebrate dance → jingle → walk to desk |
| **Agent Hire Ceremony** | Same door/walk/celebrate/desk flow for new agents |
| **Chat Onboarding** | Scripted CEO conversation: mission capture → skill recommendation → approval card → test interaction |
| **Skills Page** | 18 skills across 4 categories, org-wide toggles, model dropdowns, filter (All/Enabled/Disabled), search bar |
| **Approvals Page** | Pending queue + history tab, handles `skill_enable` and `api_key_request` types, badge counter |
| **Vault Page** | Full CRUD for API keys, 14 models → 6 services mapping, dependency warnings on delete |
| **Surveillance** | Pixel office with animated sprites, 4 floor tiers (auto-upgrade), floor planner mode, scene modes |
| **Agent Management** | Hire (with live sprite preview), edit (name/role/color/skin/model), fire (with confirmation) |
| **Sprite Animations** | 7 states: idle, walking, working, celebrating, meeting, break, arriving |
| **Floor Tiers** | 4 pre-made pixel art backgrounds that auto-swap as agent count grows |
| **Floor Planner** | Click-to-place agent desks, grid overlay, positions saved to DB |
| **Sound System** | Web Audio API retro jingle (no audio files) |
| **Reset DB** | 3-option dialog: Reset Database / Fire CEO / Shutter Business |

### Placeholder (UI exists, not connected to real data)

| Page | Status |
|------|--------|
| Dashboard | Hardcoded stats, agent cards, mission table |
| Missions | Static 4-column Kanban board, no CRUD |
| Audit | Dummy log with severity filter, export button non-functional |
| Financials | Static bar chart + data table |

### Planned (documented, not implemented)

- CEO autonomous agent (scheduler, decision engine, proactive chat)
- Agent task execution engine (LLM calls with tool use)
- Supabase backend (Postgres, Auth, Realtime, Edge Functions)
- Real budget tracking and cost attribution
- Gallery, System Stats, Channels pages

---

## Navigation

| Tab | Route | Icon | Status |
|-----|-------|------|--------|
| Dashboard | `/dashboard` | BarChart3 | Placeholder |
| Chat | `/chat` | MessageSquare | **Functional** — CEO onboarding + future AI chat |
| Approvals | `/approvals` | ClipboardCheck | **Functional** — Pending queue with badge |
| Missions | `/missions` | Target | Placeholder |
| Surveillance | `/surveillance` | Cctv | **Functional** — Pixel office, agents, ceremonies |
| Skills | `/skills` | Blocks | **Functional** — 18 skills with toggles + filter/search |
| The Vault | `/vault` | Shield | **Functional** — API key management |
| Audit | `/audit` | ScrollText | Placeholder |
| Financials | `/financials` | DollarSign | Placeholder |
| Sample | `/sample-surveillance` | FlaskConical | Demo mode (no DB) |

**Also in the nav rail:**
- **CEO Status Pip** — Shows CEO name initial + status color (green/yellow/red)
- **Approval Badge** — Pending count on the Approvals tab (refreshed every 5s)
- **Reset DB** — Red icon at bottom, opens double-confirm dialog

---

## Architecture

### Dual-Tone Hybrid UI

| Layer | Purpose | Aesthetic |
|-------|---------|-----------|
| **Serious Shell** | Dashboard, Missions, Vault, Audit, Financials | Deep dark mode, Inter font, Slate/Emerald palette, clean data tables |
| **Pixel Surveillance** | Pixel Office with live AI agent sprites | CRT scanlines, Press Start 2P font, Amiga-style beveled windows, vibrant 32-bit palette |

### Database

Client-side **SQLite** via [sql.js](https://github.com/sql-js/sql.js/) (WASM). All data persists in IndexedDB. No backend required.

**8 tables:** `settings`, `agents`, `ceo`, `missions`, `audit_log`, `vault`, `approvals`, `skills`

### Skills System

18 skills across 4 categories:

| Category | Skills |
|----------|--------|
| **Communication** | Read Email, Write Email, Send Slack, Schedule Meeting |
| **Research** | Research Web, Read X/Tweets, Research Reddit, Deep Search, Browse Web, Web Scraping |
| **Creation** | Create Images, Generate Video, Write Document, Generate Code |
| **Analysis** | Analyze Data, Analyze Image, Summarize Document, Translate Text |

Skills are toggled org-wide by the founder. The CEO will assign specific skills per agent (future).

### Surveillance Floor Tiers

| Tier | Agents | Background |
|------|--------|------------|
| 1 (Startup) | 0-1 | CEO desk + window + plants + door |
| 2 | 2-3 | 4 desks + expanded office |
| 3 | 4-6 | 7 desks + whiteboard |
| 4 | 7+ | Multi-room: CEO office, open floor, conference room |

Floor backgrounds auto-swap as you hire more agents.

---

## Tech Stack

- **React 18** + **TypeScript** + **Vite 6**
- **Tailwind CSS 3** — Dual palette (`jarvis-*` serious + `pixel-*` retro)
- **React Router 6** — Client-side SPA routing
- **Lucide React** — Icon library
- **sql.js** — SQLite compiled to WASM, persisted to IndexedDB
- **Web Audio API** — Retro success jingle (no external audio files)
- **No backend** — Fully client-side, zero external dependencies

---

## Docker

### Build & Run

```bash
docker build -t jarvis-inc .
docker run -p 3000:80 jarvis-inc
```

Open [http://localhost:3000](http://localhost:3000).

The Dockerfile is a multi-stage build: `node:20-alpine` (build) → `nginx:alpine` (serve). nginx handles SPA routing via `try_files`.

---

## Design Documents

Architecture and design decisions are documented in `/AI/`:

| Document | Contents |
|----------|----------|
| `AI/CEO-Agent-System.md` | Scheduler options (A-E), decision engine, agent factory, skill assignment, task execution |
| `AI/CEO-Designate.md` | CEO personality archetypes, risk tolerance thresholds, philosophy → prompt mapping |
| `AI/CEO/CEO-Prompts.md` | Every prompt template: CEO system/user, agent system/task, JSON schemas, chat patterns |
| `AI/CEO-Communication-Loop.md` | Proactive CEO behavior, triggers, action cards, notification system |
| `AI/Chat-Onboarding-Flow.md` | Scripted onboarding conversation state machine |
| `AI/Approval-System.md` | Approval types, lifecycle, cross-component sync |
| `AI/Skills-Architecture.md` | 18 skills, categories, connection types, skill-agent assignment model |
| `AI/Data-Layer.md` | DB schema (8 tables), dual-mode plan (sql.js vs Supabase) |
| `AI/Ceremonies.md` | All ceremony state machines (Founder, CEO, Walk-in, Hire) |
| `AI/Surveillance.md` | Pixel office, sprite system, floor tiers, position math |

---

## Project Structure

```
jarvis_inc/
├── index.html                    # Vite entry + Google Fonts + favicon
├── package.json                  # React 18, Vite 6, Tailwind 3, sql.js
├── vite.config.ts                # React plugin
├── tailwind.config.js            # Dual palette (jarvis-* + pixel-*)
├── Dockerfile                    # Multi-stage: node:20-alpine → nginx:alpine
├── TASKS.md                      # Gap analysis: PRD vs implementation
├── PRD.txt                       # Product requirements document
├── CLAUDE.md                     # AI assistant project guide
├── AI/                           # Architecture & design documents (10 files)
├── seed_skills_repo/             # Skill JSON files for GitHub skills repo
├── public/
│   ├── sql-wasm.wasm             # sql.js WebAssembly binary
│   ├── favicon.png               # App favicon
│   └── floors/                   # Pixel art floor backgrounds (4 tiers)
└── src/
    ├── main.tsx                  # React entry (BrowserRouter)
    ├── App.tsx                   # DB gate → Ceremonies | AppLayout
    ├── index.css                 # Tailwind + CRT/retro/sprite/door CSS
    ├── lib/
    │   ├── database.ts           # SQLite singleton, 8-table schema, CRUD
    │   ├── models.ts             # 14 models, model→service mapping
    │   ├── sounds.ts             # Web Audio API success jingle
    │   ├── positionGenerator.ts  # Desk/meeting/break position math
    │   └── skillRecommender.ts   # Keyword → skill matching
    ├── hooks/
    │   └── useDatabase.ts        # Boot hook: ready/initialized/ceoInitialized
    ├── types/
    │   └── index.ts              # Agent, CEO, Mission, Position, AgentStatus
    ├── data/
    │   ├── dummyData.ts          # Mock data for placeholder pages
    │   └── skillDefinitions.ts   # 18 skill definitions (hardcoded)
    └── components/
        ├── FounderCeremony/      # Terminal boot → form → activation
        ├── CEOCeremony/          # CEO designation → API key → progress → done
        ├── Layout/               # AppLayout, NavigationRail, ResetDBDialog
        ├── Surveillance/         # SurveillanceView, PixelOffice, AgentSprite,
        │                         # CEOSprite, HireAgentModal, SurveillanceModule
        ├── Chat/                 # CEO onboarding conversation
        ├── Approvals/            # Pending queue + history
        ├── Skills/               # 18-skill grid with filter/search
        ├── Dashboard/            # Stats cards + ops table (placeholder)
        ├── Missions/             # Kanban board (placeholder)
        ├── Vault/                # API key management
        ├── Audit/                # Event log (placeholder)
        └── Financials/           # Budget charts (placeholder)
```

---

## License

Private — Jarvis Inc.
