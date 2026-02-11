# CLAUDE.md — Jarvis Inc. God View Dashboard

## Project Overview
Hybrid dual-tone dashboard for commanding an autonomous AI workforce.
Corporate-cold "serious" shell (dark mode, high-density data tables) housing
a retro pixel art surveillance module (CRT scanlines, Amiga-style beveled
windows, frame-by-frame sprite animations). Think: nuclear power plant control
room with one monitor showing the actual reactor core.

## Design Documents (`/AI/`)

Detailed architecture docs live in the `AI/` directory. **Read these before making changes to related systems.**

| Document | Covers |
|----------|--------|
| [`AI/CEO-Agent-System.md`](AI/CEO-Agent-System.md) | CEO autonomy: scheduler (5 options), decision engine, personality system, agent factory, skill assignment, task execution, DB schema extensions, Supabase Edge Function |
| [`AI/CEO-Communication-Loop.md`](AI/CEO-Communication-Loop.md) | Proactive CEO behavior: trigger types, "Hey founder we need to chat!", action cards, notification system, prompt strategy (system + user prompts per tick and per task) |
| [`AI/Chat-Onboarding-Flow.md`](AI/Chat-Onboarding-Flow.md) | Scripted onboarding: ConvoStep state machine, single-skill approval flow, approval sync (chat ↔ Approvals page), simulated test interaction, LLM: ENABLED badge |
| [`AI/Approval-System.md`](AI/Approval-System.md) | Approval lifecycle: types (skill_enable, api_key_request, hire_agent, agent_action), cross-component sync via events, rendering per type, future Supabase Realtime |
| [`AI/Skills-Architecture.md`](AI/Skills-Architecture.md) | 18 skill definitions, categories, connection types, skill recommender, skill-agent assignment model (CEO assigns per agent), seed skills repo structure |
| [`AI/Data-Layer.md`](AI/Data-Layer.md) | 8 DB tables (current), 4 future tables, sql.js singleton, dual-mode plan (demo vs Supabase), DataService interface, model→service mapping |
| [`AI/Surveillance.md`](AI/Surveillance.md) | Pixel office: floor tiers, sprite system, animation states, movement, ceremonies (walk-in, hire), position system, CSS classes, color palettes |
| [`AI/Ceremonies.md`](AI/Ceremonies.md) | All ceremony flows: Founder, CEO, Walk-in, Agent Hire — state machines, triggers, settings, sound, door animations |
| [`AI/CEO-Designate.md`](AI/CEO-Designate.md) | CEO personality config: 8 archetypes (Wharton MBA, Wall Street, MIT, etc.), risk tolerance thresholds, philosophy tone mapping, combined prompt assembly |
| [`AI/CEO/CEO-Prompts.md`](AI/CEO/CEO-Prompts.md) | Every prompt template: CEO system/evaluation/delegation prompts, agent system/task prompts, JSON action schema, approval card metadata, conversation persistence |

## Tech Stack
- **React 18** + **TypeScript** + **Vite 6**
- **Tailwind CSS 3** — custom dual-palette in `tailwind.config.js`
- **React Router 6** — client-side SPA routing
- **Lucide React** — icon library
- **sql.js** — SQLite compiled to WASM, runs in browser, persisted to IndexedDB
- **Web Audio API** — retro sound effects (success jingle, no external audio files)
- **No backend yet** — fully client-side; Supabase planned for full mode (see `AI/Data-Layer.md`)

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
- **Full details**: See `AI/Data-Layer.md`
- **Singleton**: `src/lib/database.ts` — one global `db` instance
- **Boot**: `initDatabase()` loads WASM, restores from IndexedDB or creates fresh
- **Schema**: 8 tables: `settings`, `agents`, `ceo`, `missions`, `audit_log`, `vault`, `approvals`, `skills`
- **Persistence**: Every write calls `persist()` → exports DB binary → saves to IndexedDB
- **Reset**: `resetDatabase()` closes DB, deletes IndexedDB entry, nulls singleton

### Navigation (10 routes + utilities)
| Tab | Route | Icon | Description |
|-----|-------|------|-------------|
| Dashboard | `/dashboard` | BarChart3 | KPI stats, ops table, agent fleet |
| Chat | `/chat` | MessageSquare | CEO onboarding → future AI chat |
| Approvals | `/approvals` | ClipboardCheck | Pending approval queue (skill_enable, api_key_request) |
| Missions | `/missions` | Target | 4-column Kanban board |
| Surveillance | `/surveillance` | Cctv | Pixel office with live agent sprites |
| Skills | `/skills` | Blocks | 18 skills in 4 categories, toggles + model selectors |
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

## Key Flows

### Ceremonies → See `AI/Ceremonies.md`
1. **FounderCeremony** — Terminal boot → callsign + org name form → activation
2. **CEOCeremony** — CEO designation form → progress bar → activation
3. **CEO Walk-in** (SurveillanceView) — Door opens → walk → celebrate → jingle → desk
4. **Agent Hire** — Door opens → walk → celebrate → jingle → desk

### CEO Chat Onboarding → See `AI/Chat-Onboarding-Flow.md`
State machine: `welcome → waiting_input → acknowledging → waiting_skill_approve → waiting_test_input → testing_skill → done`

1. CEO welcomes founder, asks primary mission
2. Founder types mission
3. CEO acknowledges, recommends skills, suggests enabling Research Web
4. Single APPROVE button — syncs with Approvals page
5. After approval: CEO offers test — founder types query, gets simulated research
6. LLM: ENABLED badge appears in chat header
7. CTA: GO TO SURVEILLANCE

### Approval System → See `AI/Approval-System.md`
- Types: `skill_enable`, `api_key_request` (future: `hire_agent`, `agent_action`, `budget_override`)
- Cross-component sync via `window.dispatchEvent(new Event('approvals-changed'))`
- NavigationRail badge shows pending count

### Skills → See `AI/Skills-Architecture.md`
- 18 skills across 4 categories (communication, research, creation, analysis)
- Skill-agent assignment: CEO assigns specific skills per agent, NOT global
- Skills page: grid with toggles, model selectors
- Skill recommender: keyword matching mission text → skill IDs
- Seed repo: `seed_skills_repo/` mirrors https://github.com/GGCryptoh/jarvis_inc_skills

### CEO Autonomy → See `AI/CEO-Agent-System.md` + `AI/CEO-Communication-Loop.md`
- Scheduler: 5 options documented (Option B for demo, Option E for Supabase full mode)
- Decision engine: evaluates state → produces actions each tick
- Proactive chat: CEO initiates conversations, requests meetings
- Agent task execution: persistent conversation in `task_executions`, mid-task approvals

## Key Components

### Surveillance → See `AI/Surveillance.md`
- **SurveillanceView** (`/surveillance`) — Real DB-backed, hire/edit/fire agents, ceremonies
- **SurveillanceModule** (`/sample-surveillance`) — Demo mode with dummy data
- 4 floor tiers based on agent count, progressive room upgrades
- CSS pixel art sprites with 7 animation states

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
- No backend yet — all state is browser-local via sql.js + IndexedDB
- Settings track ceremony progress: `ceo_walked_in`, `ceo_meeting_done`, `primary_mission`
- Cross-component communication: `window.dispatchEvent()` with custom events (`approvals-changed`, future: `ceo-wants-to-chat`, `agent-hired`, etc.)

## File Structure
```
jarvis_inc/
├── index.html                # Vite entry + Google Fonts links + favicon
├── package.json              # React 18, Vite 6, Tailwind 3, sql.js
├── vite.config.ts            # React plugin
├── tailwind.config.js        # Dual palette (jarvis-* + pixel-*)
├── Dockerfile                # Multi-stage: node:20-alpine → nginx:alpine
├── CLAUDE.md                 # This file — project guide for Claude
├── TASKS.md                  # Gap analysis: PRD vs current implementation
├── PRD.txt                   # Product requirements document
├── PLAN-SKILLS_REPO.md       # Skills repo creation plan
├── AI/                       # Architecture & design docs (READ BEFORE MODIFYING)
│   ├── CEO-Agent-System.md   # CEO autonomy, scheduler, decision engine, agent factory
│   ├── CEO-Communication-Loop.md  # Proactive CEO behavior, prompt strategy
│   ├── Chat-Onboarding-Flow.md    # Scripted onboarding state machine
│   ├── Approval-System.md         # Approval types, lifecycle, sync
│   ├── Skills-Architecture.md     # 18 skills, assignment model, seed repo
│   ├── Data-Layer.md              # DB schema, dual-mode, DataService
│   ├── Surveillance.md            # Pixel office, sprites, floors, animations
│   └── Ceremonies.md              # All ceremony state machines
├── seed_skills_repo/          # Mirrors https://github.com/GGCryptoh/jarvis_inc_skills
│   ├── Official/              # 18 skill JSON files in 4 category folders
│   ├── Marketplace/           # Community-contributed (empty)
│   ├── schema/skill.schema.json
│   ├── manifest.json          # Test version
│   └── real-manifest.json     # Complete manifest with checksums
├── public/
│   ├── sql-wasm.wasm          # sql.js WebAssembly binary
│   ├── favicon.png            # App favicon
│   └── floors/                # Pixel art floor backgrounds (tier 1-4)
└── src/
    ├── main.tsx               # React entry (BrowserRouter)
    ├── App.tsx                # DB gate → Ceremonies | AppLayout with routes
    ├── index.css              # Tailwind + CRT/retro/sprite/door/celebrate CSS
    ├── lib/
    │   ├── database.ts        # SQLite singleton, schema, CRUD, IndexedDB persistence
    │   ├── models.ts          # 12 LLM models, model→service map, key hints
    │   ├── sounds.ts          # Web Audio API success jingle
    │   ├── skillRecommender.ts # Mission text → recommended skill IDs
    │   └── positionGenerator.ts # Desk/meeting/break/allhands position math
    ├── hooks/
    │   └── useDatabase.ts     # Boot hook: ready/initialized/ceoInitialized/reset/reinit
    ├── types/
    │   └── index.ts           # Agent, CEO, Mission, SceneMode, Position, AgentStatus
    ├── data/
    │   ├── dummyData.ts       # Default agents, positions, mock stats/missions
    │   └── skillDefinitions.ts # 18 skill definitions (id, name, icon, category, status)
    └── components/
        ├── FounderCeremony/
        │   └── FounderCeremony.tsx   # Terminal boot → form → activation
        ├── CEOCeremony/
        │   └── CEOCeremony.tsx       # CEO designation → progress → activation
        ├── Layout/
        │   ├── AppLayout.tsx         # Nav rail + content outlet
        │   ├── NavigationRail.tsx    # 10 routes + CEO pip + approval badge + reset DB
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
        │   └── ChatView.tsx          # CEO onboarding (scripted) + PostMeetingChat
        ├── Approvals/
        │   └── ApprovalsView.tsx     # Handles skill_enable + api_key_request types
        ├── Skills/
        │   └── SkillsView.tsx        # 18 skills grid with toggles + model selectors
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
- **Approval sync**: Always dispatch `approvals-changed` event after any approval mutation
- **Skill enable flow**: `skill_enable` approval in chat syncs with Approvals page via events — see `AI/Approval-System.md`
- **real-manifest.json**: This is the complete manifest — `manifest.json` is a test/small version. Keep both.
