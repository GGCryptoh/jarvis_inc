# CLAUDE.md — Jarvis Inc. God View Dashboard

## Project Overview
Hybrid dual-tone dashboard for commanding an autonomous AI workforce.
Corporate-cold "serious" shell (dark mode, high-density data tables) housing
a retro pixel art surveillance module (CRT scanlines, Amiga-style beveled
windows, frame-by-frame sprite animations). Think: nuclear power plant control
room with one monitor showing the actual reactor core.

## Tech Stack
- **React 18** + **TypeScript** + **Vite 6**
- **Tailwind CSS 3** — custom dual-palette in `tailwind.config.js`
- **React Router 6** — client-side SPA routing
- **Lucide React** — icon library
- **sql.js** — SQLite compiled to WASM, runs in browser, persisted to IndexedDB
- **Web Audio API** — retro sound effects (success jingle, no external audio files)
- **No backend** — fully client-side, no server, no API calls

## Quick Commands
```bash
npm run dev          # Dev server at localhost:5173
npm run build        # Production build → dist/
npm run preview      # Preview production build locally
```

### Docker
```bash
docker build -t jarvis-inc .
docker run -p 3000:80 jarvis-inc
```

## Architecture

### App Boot Sequence
```
main.tsx → BrowserRouter → App.tsx
  ├─ useDatabase() hook boots sql.js WASM
  ├─ if (!ready)           → "LOADING SYSTEMS..." spinner
  ├─ if (!initialized)     → FounderCeremony (terminal boot → form → activation)
  ├─ if (!ceoInitialized)  → CEOCeremony (form → progress → activation)
  └─ if (all ready)        → AppLayout (NavigationRail + Routes)
       └─ First visit to /surveillance triggers CEO walk-in ceremony
       └─ After walk-in → approval notification → CEO chat onboarding
```

### Data Layer
- **Singleton**: `src/lib/database.ts` — one global `db` instance
- **Boot**: `initDatabase()` loads WASM, restores from IndexedDB or creates fresh
- **Schema**: 5 tables:
  - `settings` — key/value pairs (founder_name, org_name, ceo_walked_in, ceo_meeting_done, primary_mission)
  - `agents` — id, name, role, color, skin_tone, model, created_at
  - `missions` — id, title, status, assignee, priority, due_date
  - `audit_log` — id, timestamp, agent, action, details, severity
  - `ceo` — id, name, model, philosophy, risk_tolerance, status, created_at
- **Persistence**: Every write calls `persist()` → exports DB binary → saves to IndexedDB
- **Reset**: `resetDatabase()` closes DB, deletes IndexedDB entry, nulls singleton

### Navigation (10 routes + utilities)
| Tab | Route | Icon | Description |
|-----|-------|------|-------------|
| Dashboard | `/dashboard` | BarChart3 | KPI stats, ops table, agent fleet |
| Chat | `/chat` | MessageSquare | CEO onboarding conversation + future AI chat |
| Approvals | `/approvals` | ClipboardCheck | Pending approval queue (placeholder) |
| Missions | `/missions` | Target | 4-column Kanban board |
| Surveillance | `/surveillance` | Cctv | Pixel office with live agent sprites |
| Skills | `/skills` | Blocks | Agent capability configuration |
| The Vault | `/vault` | Shield | API keys & credentials |
| Audit | `/audit` | ScrollText | Filterable event log |
| Financials | `/financials` | DollarSign | Budget vs actual charts |
| Sample | `/sample-surveillance` | FlaskConical | Demo mode surveillance (no DB) |
| *CEO Pip* | *(indicator)* | Status dot | Above Reset DB in nav rail |
| *Reset DB* | *(modal)* | DatabaseZap | Red icon, double-confirm dialog |

### Two Visual Systems
| | Serious Shell | Pixel Surveillance |
|---|---|---|
| **Font** | Inter (clean sans) | Press Start 2P (pixel) |
| **Colors** | Slate, Emerald, White | Vibrant 32-bit (Pink, Green, Orange, Cyan) |
| **Borders** | 1px solid subtle | Chunky 3D beveled (Amiga-style) |
| **Animations** | Smooth CSS transitions | Frame-by-frame sprite animations |
| **CSS classes** | Tailwind `jarvis-*` namespace | `.retro-window`, `.retro-button`, `.retro-inset` |

## Key Components

### Ceremonies
1. **FounderCeremony** — Terminal boot sequence → callsign + org name form → activation
2. **CEOCeremony** — CEO designation form (callsign, model, philosophy, risk tolerance) → progress bar → activation
3. **CEO Walk-in** (in SurveillanceView) — Multi-stage: door opens → walk to center → celebrate → jingle → walk to desk
4. **Agent Hire Ceremony** — Door opens → walk to center → brief celebrate → jingle → walk to desk

### CEO Walk-in Ceremony (SurveillanceView)
State machine with `ceoStage`:
```
entering       → Door opens, CEO walks from entrance to center {x:45, y:50}
celebrating    → Door closes, dance animation, success jingle plays (~2.5s)
walking_to_desk → CEO walks to CEO_OFFICE_POSITION
seated         → setSetting('ceo_walked_in'), show approval notification
```

### Approval Notification
After CEO walk-in: floating retro notification "CEO [name] would like a meeting" with APPROVE button → navigates to `/chat`.
Shows on subsequent visits too if `ceo_meeting_done` setting not set.

### Chat Onboarding (ChatView)
Scripted CEO conversation flow:
1. CEO welcomes founder by name
2. CEO asks about org's primary mission
3. User types their mission/goal
4. CEO acknowledges, suggests exploring Skills
5. Saves `primary_mission` and `ceo_meeting_done` to settings
6. Shows "Explore Skills" CTA button

### Skills Page (SkillsView)
Grid of placeholder skill cards in 4 categories:
- **Communication**: Read Email, Write Email, Send Slack, Schedule Meeting
- **Research**: Research Web, Read X/Tweets, Research Reddit, Deep Search
- **Creation**: Create Images, Write Document, Generate Code
- **Analysis**: Analyze Data

Toggle switches (visual only — will connect to GitHub skill repo in future).

### Surveillance Modules
- **SurveillanceView** (`/surveillance`) — Real DB-backed, hire/edit/fire agents, CEO walk-in ceremony, approval notifications
- **SurveillanceModule** (`/sample-surveillance`) — Demo mode with dummy data, scene transitions, no DB writes

### Sprite Animation System
```
Agent position: { x: number, y: number }  (percentages, 0-100)
Target position set by scene mode or ceremony

Every 50ms tick:
  distance = √(dx² + dy²)
  if distance < 0.5 → snap to target, check ceremony stage
  else → lerp: position += delta * 0.08, set status = 'walking'

Status → CSS class:
  working     → agent-typing     (subtle hand bob)
  walking     → agent-walking    (bounce + scale alternation)
  celebrating → agent-celebrating (bouncy jump/spin dance)
  meeting     → agent-meeting    (gentle sway)
  break       → agent-break      (relaxed bob)
  idle        → agent-idle       (slow breathing bob)
  arriving    → agent-walking    (same as walking)
```

### Sound System (`src/lib/sounds.ts`)
`playSuccessJingle()` — Web Audio API oscillator-based retro victory jingle.
Square + triangle wave ascending arpeggio (C5→E5→G5→C6) with high sparkle notes.
No external audio files needed.

## Conventions
- Agent names: UPPERCASED callsigns, max 12 chars
- Agent IDs: `agent-${Date.now()}`
- CEO ID: always `'ceo'`
- Pixel palette: `pixel-green`, `pixel-pink`, `pixel-cyan`, etc. (tailwind.config.js)
- Serious palette: `jarvis-bg`, `jarvis-surface`, `jarvis-border`, `jarvis-accent`
- Retro CSS: `.retro-window`, `.retro-window-title`, `.retro-window-body`, `.retro-button`, `.retro-inset`
- CRT CSS: `.crt-screen`, `.crt-flicker`, `.phosphor-glow`, `.pixel-grid`, `.pixel-art`
- Agent CSS: `.agent-sprite`, `.agent-typing`, `.agent-walking`, `.agent-celebrating`, `.agent-nametag`
- Door CSS: `.door-open-left`, `.door-open-right`, `.door-close-left`, `.door-close-right`
- No backend — all state is browser-local via sql.js + IndexedDB
- Settings track ceremony progress: `ceo_walked_in`, `ceo_meeting_done`, `primary_mission`

## File Structure
```
jarvis_inc/
├── index.html                # Vite entry + Google Fonts links + favicon
├── package.json              # React 18, Vite 6, Tailwind 3, sql.js
├── vite.config.ts            # React plugin
├── tailwind.config.js        # Dual palette (jarvis-* + pixel-*)
├── Dockerfile                # Multi-stage: node:20-alpine → nginx:alpine
├── TASKS.md                  # Gap analysis: PRD vs current implementation
├── PRD.txt                   # Product requirements document
├── public/
│   ├── sql-wasm.wasm         # sql.js WebAssembly binary
│   └── favicon.png           # App favicon
└── src/
    ├── main.tsx              # React entry (BrowserRouter)
    ├── App.tsx               # DB gate → Ceremonies | AppLayout with routes
    ├── index.css             # Tailwind + CRT/retro/sprite/door/celebrate CSS
    ├── lib/
    │   ├── database.ts       # SQLite singleton, schema, CRUD, IndexedDB persistence
    │   ├── sounds.ts         # Web Audio API success jingle
    │   └── positionGenerator.ts # Desk/meeting/break/allhands position math
    ├── hooks/
    │   └── useDatabase.ts    # Boot hook: ready/initialized/ceoInitialized/reset/reinit
    ├── types/
    │   └── index.ts          # Agent, CEO, Mission, SceneMode, Position, AgentStatus
    ├── data/
    │   └── dummyData.ts      # Default agents, positions, mock stats/missions
    └── components/
        ├── FounderCeremony/
        │   └── FounderCeremony.tsx   # Terminal boot → form → activation
        ├── CEOCeremony/
        │   └── CEOCeremony.tsx       # CEO designation → progress → activation
        ├── Layout/
        │   ├── AppLayout.tsx         # Nav rail + content outlet
        │   ├── NavigationRail.tsx    # 10 routes + CEO pip + reset DB
        │   └── ResetDBDialog.tsx     # Two-step destructive confirmation
        ├── Surveillance/
        │   ├── SurveillanceView.tsx  # DB-backed: agents, CEO ceremony, approvals
        │   ├── SurveillanceModule.tsx # Demo mode: dummy agents, scene transitions
        │   ├── CRTFrame.tsx          # Scanlines + vignette + phosphor wrapper
        │   ├── PixelOffice.tsx       # Office furniture + door animation + sprites
        │   ├── AgentSprite.tsx       # CSS pixel art character + hover tooltip
        │   ├── CEOSprite.tsx         # Larger CEO sprite with crown + suit
        │   ├── SurveillanceControls.tsx # Scene buttons + hire + status panel
        │   └── HireAgentModal.tsx    # Hire/edit form + live sprite preview
        ├── Chat/
        │   └── ChatView.tsx          # CEO onboarding conversation + future AI chat
        ├── Approvals/
        │   └── ApprovalsView.tsx     # Placeholder — pending approval queue
        ├── Skills/
        │   └── SkillsView.tsx        # Agent capability config (placeholder skills)
        ├── Dashboard/
        │   └── DashboardView.tsx     # Stats cards, ops table, agent fleet
        ├── Missions/
        │   └── MissionsView.tsx      # 4-column Kanban board
        ├── Vault/
        │   └── VaultView.tsx         # Credentials table
        ├── Audit/
        │   └── AuditView.tsx         # Filterable severity log
        └── Financials/
            └── FinancialsView.tsx    # CSS bar chart + data table
```

## Common Pitfalls
- **WASM path**: `public/sql-wasm.wasm` must exist — Vite serves it as a static asset
- **DB guard**: `getDB()` throws if called before `initDatabase()` — App.tsx gates on `ready`
- **Build warnings**: fs/path/crypto from sql.js are expected (browser externalization)
- **Font import**: Google Fonts loaded via `<link>` in `index.html`, NOT CSS `@import`
- **Lerp performance**: 50ms interval × N agents — keep AgentSprite renders cheap
- **Ceremony refs**: `ceoStageRef` and `hireCeremonyRef` keep refs in sync with state for use inside setInterval
- **Door state**: `null` = no animation (static), `true` = opening, `false` = closing
- **persist() is async**: Most callers don't await — writes are fire-and-forget to IndexedDB
- **Tailwind purge**: Both `jarvis-*` and `pixel-*` colors only work if referenced in templates
- **Docker SPA**: nginx config uses `try_files $uri /index.html` for client-side routing
