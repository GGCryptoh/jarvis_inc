# CLAUDE.md — Jarvis Inc. God View Dashboard

## Project Overview
Hybrid dual-tone dashboard for commanding an autonomous AI workforce.
"Serious" corporate shell (dark mode, data tables) housing a retro pixel art
surveillance module (CRT, Amiga-style, sprite animations).

## Tech Stack
- React 18 + TypeScript + Vite
- Tailwind CSS (utility-first, custom color palette in tailwind.config.js)
- React Router 6 (client-side routing)
- Lucide React (icons)
- sql.js (SQLite in WASM, persisted to IndexedDB — no backend)

## Quick Commands
- `npm run dev` — Start dev server (localhost:5173)
- `npm run build` — Production build to dist/
- `npx vitest` — Run tests (when added)
- `docker build -t jarvis-inc . && docker run -p 3000:80 jarvis-inc`

## Architecture

### App Boot Sequence
1. `main.tsx` → BrowserRouter wraps App
2. `App.tsx` boots SQLite via `useDatabase()` hook
3. If DB empty → `FounderCeremony` (terminal boot → form → activation)
4. If founder exists → Main app with `AppLayout` (nav rail + routes)

### Data Layer
- **Single source of truth**: sql.js in-memory SQLite, persisted to IndexedDB
- **No backend** — everything runs client-side
- **Database singleton** in `src/lib/database.ts` — call `initDatabase()` once,
  then use `getDB()`, `loadAgents()`, `saveAgent()`, etc.
- **Schema**: settings, agents, missions, audit_log tables
- **Persistence**: Every write calls `persist()` which exports the DB binary
  to IndexedDB under key `jarvis_inc_db`

### Two Visual Systems
| System | Font | Colors | Borders | Used In |
|--------|------|--------|---------|---------|
| Serious | Inter | Slate/Emerald/White | 1px subtle | Dashboard, Missions, Vault, Audit, Financials |
| Pixel/Retro | Press Start 2P | Vibrant 32-bit palette | Chunky 3D beveled | Surveillance module |

### Key Components
- `SurveillanceModule` — owns agent state, scene mode, lerp loop, hire/edit/fire
- `FounderCeremony` — phase state machine (boot→scan→welcome→form→activating→done)
- `HireAgentModal` — hire + edit mode, live sprite preview, color/skin pickers
- `ResetDBDialog` — two-step destructive confirmation (type "RESET JARVIS")
- `NavigationRail` — 6 routes + reset DB icon + CEO status pip

### Surveillance Sprite System
- Agents positioned absolutely using `left/top` percentages
- Movement via lerp: 50ms interval, speed=0.08, snap at dist<0.5
- 5 scene modes: working, meeting, all_hands, break, welcome
- Status → animation class mapping in `AgentSprite.tsx`
- CSS animations defined in `src/index.css` (agent-typing, agent-walking, etc.)
- Agents persisted to SQLite; runtime state (position, status) is ephemeral

## Conventions
- Agent names are UPPERCASED callsigns (max 12 chars)
- Agent IDs: `agent-${Date.now()}`
- Colors use the pixel palette from tailwind.config.js (pixel-green, pixel-pink, etc.)
- Retro UI uses `.retro-window`, `.retro-button`, `.retro-inset` CSS classes from index.css
- Serious UI uses Tailwind's `jarvis-*` color namespace (jarvis-bg, jarvis-surface, etc.)
- No backend — all state is browser-local via sql.js + IndexedDB
- Dummy data in `src/data/dummyData.ts` — used for seeding and for views not yet DB-backed

## File Structure
```
src/
├── lib/database.ts          # SQLite init, schema, CRUD, IndexedDB persistence
├── hooks/useDatabase.ts     # Boot hook: ready/initialized/reset/reinit
├── types/index.ts           # Agent, Mission, SceneMode, Position, etc.
├── data/dummyData.ts        # Default agents, desk positions, mock data
├── components/
│   ├── FounderCeremony/     # Cinematic onboarding terminal sequence
│   ├── Layout/              # AppLayout, NavigationRail, ResetDBDialog
│   ├── Surveillance/        # PixelOffice, AgentSprite, HireAgentModal, CRTFrame, Controls
│   ├── Dashboard/           # Stats cards + operations table (dummy data)
│   ├── Missions/            # Kanban board (dummy data)
│   ├── Vault/               # Credentials table (dummy data)
│   ├── Audit/               # Filterable log viewer (dummy data)
│   └── Financials/          # Budget vs actual chart (dummy data)
```

## Common Pitfalls
- sql.js WASM file must be in `public/sql-wasm.wasm` — Vite serves it statically
- `getDB()` throws if called before `initDatabase()` — App.tsx gates on `ready` state
- The lerp loop runs at 50ms; avoid expensive renders inside AgentSprite
- Position arrays cycle with modulo — adding >6 agents reuses desk/meeting slots
- `isNew` flag on agents is temporary (welcome animation only), never persisted to DB
- Vite build shows fs/path/crypto warnings from sql.js — these are expected and harmless
  (sql.js detects browser environment and uses WASM path)
- The `@import` for Google Fonts is in `index.html`, not in CSS — avoids PostCSS ordering issues
- `persist()` is async but most callers don't await it — writes are fire-and-forget to IndexedDB
