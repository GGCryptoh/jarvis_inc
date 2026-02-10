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
- **Lucide React** — icon library (BarChart3, Cctv, Shield, etc.)
- **sql.js** — SQLite compiled to WASM, runs in browser, persisted to IndexedDB
- **No backend** — fully client-side, no server, no API calls

## Quick Commands
```bash
npm run dev          # Dev server at localhost:5173
npm run build        # Production build → dist/
npm run preview      # Preview production build locally
npx vitest           # Run unit/component tests
npx vitest --coverage # Tests with coverage report
npx playwright test  # E2E tests (when added)
```

### Docker
```bash
docker build -t jarvis-inc .
docker run -p 3000:80 jarvis-inc    # Serves at localhost:3000
```

## Architecture

### App Boot Sequence
```
main.tsx → BrowserRouter → App.tsx
  ├─ useDatabase() hook boots sql.js WASM
  ├─ if (!ready)        → "LOADING SYSTEMS..." spinner
  ├─ if (!initialized)  → FounderCeremony (terminal boot → form → activation)
  └─ if (initialized)   → AppLayout (NavigationRail + Routes)
```

### Data Layer
- **Singleton**: `src/lib/database.ts` — one global `db` instance
- **Boot**: `initDatabase()` loads WASM, restores from IndexedDB or creates fresh
- **Schema**: 4 tables created idempotently on boot:
  - `settings` — key/value pairs (founder_name, org_name, created_at)
  - `agents` — id, name, role, color, skin_tone, model, created_at
  - `missions` — id, title, status, assignee, priority, due_date
  - `audit_log` — id, timestamp, agent, action, details, severity
- **Persistence**: Every write calls `persist()` → exports DB binary → saves to IndexedDB
- **Reset**: `resetDatabase()` closes DB, deletes IndexedDB entry, nulls singleton

### Key Exported Functions (database.ts)
```typescript
initDatabase(): Promise<Database>         // Boot — call once
getDB(): Database                         // Get singleton (throws if not init'd)
getSetting(key): string | null            // Read setting
setSetting(key, value): void              // Upsert setting + persist
isFounderInitialized(): boolean           // Check founder_name exists
getFounderInfo(): { founderName, orgName } | null
loadAgents(): AgentRow[]                  // All agents ordered by created_at
saveAgent(agent: AgentRow): void          // Insert or update + persist
seedAgentsIfEmpty(agents: AgentRow[]): void  // Idempotent bulk seed
deleteAgent(id: string): void             // Remove + persist
resetDatabase(): Promise<void>            // Nuclear option — wipes everything
```

### Two Visual Systems
| | Serious Shell | Pixel Surveillance |
|---|---|---|
| **Font** | Inter (clean sans) | Press Start 2P (pixel) |
| **Colors** | Slate, Emerald, White | Vibrant 32-bit (Pink, Green, Orange, Cyan) |
| **Borders** | 1px solid subtle | Chunky 3D beveled (Amiga-style) |
| **Animations** | Smooth CSS transitions | Frame-by-frame sprite animations |
| **CSS classes** | Tailwind `jarvis-*` namespace | `.retro-window`, `.retro-button`, `.retro-inset` |
| **Views** | Dashboard, Missions, Vault, Audit, Financials | Surveillance tab |

### Navigation (6 tabs + utilities)
| Tab | Route | Icon | Description |
|-----|-------|------|-------------|
| Dashboard | `/dashboard` | BarChart3 | KPI stats, ops table, agent fleet |
| Missions | `/missions` | Target | 4-column Kanban board |
| Surveillance | `/surveillance` | Cctv | Pixel office with live agent sprites |
| The Vault | `/vault` | Shield | API keys & credentials |
| Audit | `/audit` | ScrollText | Filterable immutable log |
| Financials | `/financials` | DollarSign | Budget vs actual charts |
| *Reset DB* | *(modal)* | DatabaseZap | Red icon, double-confirm dialog |
| *CEO Pip* | *(indicator)* | `:)` face | Green/yellow/red status dot |

## Key Components

### FounderCeremony (`src/components/FounderCeremony/`)
Phase state machine with timed transitions:
```
boot (5.6s) → scan (1.8s) → welcome (2s) → form (manual) → activating (~2s) → done (1.8s)
```
- Boot phase: 11 terminal lines with staggered delays
- Form phase: callsign + org name inputs, both required
- Writes `founder_name`, `org_name`, `created_at` to settings table
- Calls `onComplete()` → App re-checks `isFounderInitialized()`

### SurveillanceModule (`src/components/Surveillance/`)
Owns all surveillance state. Key internals:
- **agents**: `Agent[]` loaded from DB on mount, seeded from `initialAgents` if empty
- **sceneMode**: `'working' | 'meeting' | 'all_hands' | 'break' | 'welcome'`
- **Position lerp loop**: 50ms `setInterval`, speed=0.08, snaps at distance<0.5
- **Scene transitions**: each mode maps to a position array (DESK, MEETING, ALL_HANDS, WATER_COOLER)
- **Hire flow**: saveAgent → spawn at ENTRANCE → welcome animation → 4s timer → desks
- **Edit flow**: same modal pre-filled → saveAgent → update state + selectedAgent
- **Fire flow**: inline confirm → deleteAgent → re-assign desk positions

### HireAgentModal (`src/components/Surveillance/HireAgentModal.tsx`)
Dual-mode modal (hire vs edit, determined by `editAgent` prop):
- Left: form (callsign, role presets/custom, model, color palette, skin tones)
- Right: live 3x-scale sprite preview that updates in real-time
- Validation: `name.trim().length > 0 && role.trim().length > 0`
- Names auto-uppercased, max 12 chars

### ResetDBDialog (`src/components/Layout/ResetDBDialog.tsx`)
Two-step destructive confirmation:
- Step 1: Warning list of what gets destroyed
- Step 2: Type "RESET JARVIS" to enable the button
- 800ms delay for dramatic "DESTROYING..." spinner
- Calls `resetDatabase()` → App falls back to FounderCeremony

### Sprite Animation System
```
Agent position: { x: number, y: number }  (percentages, 0-100)
Target position set by scene mode

Every 50ms tick:
  distance = √(dx² + dy²)
  if distance < 0.5 → snap to target, set status from modeToStatus()
  else → lerp: position += delta * 0.08, set status = 'walking'

Status → CSS class:
  working  → agent-typing   (subtle hand bob)
  walking  → agent-walking  (bounce + scale alternation)
  meeting  → agent-meeting  (gentle sway)
  break    → agent-break    (relaxed bob)
  idle     → agent-idle     (slow breathing bob)
  arriving → agent-walking  (same as walking)
```

Position arrays (in `dummyData.ts`):
- `DESK_POSITIONS[6]` — 2 rows of 3 desks
- `MEETING_POSITIONS[6]` — circle around conference table
- `ALL_HANDS_POSITIONS[6]` — center cluster
- `WATER_COOLER_POSITIONS[6]` — top-right cluster
- `ENTRANCE_POSITION` — bottom center door (x:50, y:92)

## Testing Strategy

### Tier 1: Unit Tests (Vitest — highest priority)
**Database layer** — pure logic against real sql.js, no mocking needed:
- Settings CRUD round-trips
- `isFounderInitialized()` before/after setting founder_name
- `loadAgents()` / `saveAgent()` / `deleteAgent()` consistency
- `seedAgentsIfEmpty()` idempotency (no-op when agents exist)

**Position math** — extract and test:
- `modeToStatus()` mapping (5 modes → statuses)
- Lerp convergence: position approaches target over N ticks
- Snap threshold: dist < 0.5 triggers arrival
- Index modulo wrapping for position assignment

**Form validation** (HireAgentModal):
- `isValid` logic with various empty/filled combinations
- Name normalization (trim + uppercase)
- Role preset vs custom detection

### Tier 2: Component Tests (Vitest + React Testing Library)
- FounderCeremony phase progression (fake timers)
- ResetDBDialog two-step flow + confirmation phrase matching
- HireAgentModal hire vs edit mode, form pre-population
- SurveillanceControls button highlighting and callbacks
- AgentSprite animation class selection per status

### Tier 3: Integration Tests
- Full hire flow: open modal → fill form → submit → verify DB + state
- Full edit flow: select agent → edit → save → verify changes persist
- Full fire flow: select → fire → confirm → verify removal
- Scene transitions: click mode → verify target positions assigned

### Tier 4: E2E Tests (Playwright)
- Golden path: ceremony → dashboard → surveillance → hire → edit → reset
- Persistence: hire agent → reload → verify agent still present

### What NOT to test (yet)
- Dummy data views (Dashboard, Missions, Vault, Audit, Financials) — static renders
- CSS animations — trust the class names
- CRT visual effects — purely decorative
- Pixel office furniture — static divs

## Conventions
- Agent names: UPPERCASED callsigns, max 12 chars
- Agent IDs: `agent-${Date.now()}`
- Pixel palette: `pixel-green`, `pixel-pink`, `pixel-cyan`, etc. (tailwind.config.js)
- Serious palette: `jarvis-bg`, `jarvis-surface`, `jarvis-border`, `jarvis-accent`
- Retro CSS: `.retro-window`, `.retro-window-title`, `.retro-window-body`, `.retro-button`, `.retro-inset`
- CRT CSS: `.crt-screen`, `.crt-flicker`, `.phosphor-glow`, `.pixel-grid`, `.pixel-art`
- Agent CSS: `.agent-sprite`, `.agent-typing`, `.agent-walking`, `.agent-nametag`
- No backend — all state is browser-local via sql.js + IndexedDB
- Dummy data in `src/data/dummyData.ts` — seeding defaults and views not yet DB-backed

## File Structure
```
jarvis_inc/
├── index.html                # Vite entry + Google Fonts links
├── package.json              # React 18, Vite 6, Tailwind 3, sql.js
├── vite.config.ts            # React plugin
├── tsconfig.json             # Strict TS, bundler resolution
├── tailwind.config.js        # Dual palette (jarvis-* + pixel-*)
├── postcss.config.js         # Tailwind + autoprefixer
├── Dockerfile                # Multi-stage: node:20-alpine → nginx:alpine
├── .dockerignore
├── .gitignore                # .env, secrets, IDE, logs, coverage, *.db
├── public/
│   └── sql-wasm.wasm         # sql.js WebAssembly binary
└── src/
    ├── main.tsx              # React entry (BrowserRouter)
    ├── App.tsx               # DB gate → Ceremony | AppLayout
    ├── index.css             # Tailwind + CRT/retro/sprite CSS system
    ├── lib/
    │   └── database.ts       # SQLite singleton, schema, CRUD, IndexedDB persistence
    ├── hooks/
    │   └── useDatabase.ts    # Boot hook: ready/initialized/reset/reinit
    ├── types/
    │   └── index.ts          # Agent, Mission, SceneMode, Position, etc.
    ├── data/
    │   └── dummyData.ts      # Default agents, positions, mock stats/missions/etc.
    └── components/
        ├── FounderCeremony/
        │   └── FounderCeremony.tsx   # Terminal boot → form → activation sequence
        ├── Layout/
        │   ├── AppLayout.tsx         # Nav rail + content outlet
        │   ├── NavigationRail.tsx    # 6 routes + reset DB + CEO pip
        │   └── ResetDBDialog.tsx     # Two-step destructive confirmation
        ├── Surveillance/
        │   ├── SurveillanceModule.tsx # State owner: agents, scenes, hire/edit/fire
        │   ├── CRTFrame.tsx          # Scanlines + vignette + phosphor wrapper
        │   ├── PixelOffice.tsx       # Office furniture + agent sprite rendering
        │   ├── AgentSprite.tsx       # CSS pixel art character + hover tooltip
        │   ├── SurveillanceControls.tsx # Scene buttons + hire + status panel
        │   └── HireAgentModal.tsx    # Hire/edit form + live sprite preview
        ├── Dashboard/
        │   └── DashboardView.tsx     # Stats cards, ops table, agent fleet
        ├── Missions/
        │   └── MissionsView.tsx      # 4-column Kanban board
        ├── Vault/
        │   └── VaultView.tsx         # Credentials table with rotation status
        ├── Audit/
        │   └── AuditView.tsx         # Filterable severity log
        └── Financials/
            └── FinancialsView.tsx    # CSS bar chart + data table
```

## Common Pitfalls
- **WASM path**: `public/sql-wasm.wasm` must exist — Vite serves it as a static asset
- **DB guard**: `getDB()` throws if called before `initDatabase()` — App.tsx gates on `ready`
- **Build warnings**: fs/path/crypto from sql.js are expected (browser detection, uses WASM)
- **Font import**: Google Fonts loaded via `<link>` in `index.html`, NOT CSS `@import` (PostCSS order issue)
- **Lerp performance**: 50ms interval × N agents — keep AgentSprite renders cheap
- **Position overflow**: Arrays cycle with `i % positions.length` — >6 agents reuse slots
- **isNew flag**: Temporary (welcome animation only), never written to DB, cleared on scene change
- **persist() is async**: Most callers don't await — writes are fire-and-forget to IndexedDB
- **Tailwind purge**: Both `jarvis-*` and `pixel-*` colors only work if referenced in templates
- **Docker SPA**: nginx config uses `try_files $uri /index.html` for client-side routing
