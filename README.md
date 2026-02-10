# Jarvis Inc. — God View Dashboard

A hybrid dual-tone dashboard for commanding an autonomous AI workforce. Corporate-cold command center meets retro pixel art surveillance.

![Stack](https://img.shields.io/badge/React_18-TypeScript-blue) ![Stack](https://img.shields.io/badge/Vite-Tailwind_CSS-purple) ![Stack](https://img.shields.io/badge/SQLite-sql.js_(WASM)-green)

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

On first launch, the **Founder Ceremony** will boot — a cinematic terminal sequence that registers you as the system commander. After activation, you enter the main dashboard.

### Production Build

```bash
npm run build
npm run preview   # preview the production build locally
```

The built files are output to `dist/`.

---

## Docker

### Build & Run

```bash
docker build -t jarvis-inc .
docker run -p 3000:80 jarvis-inc
```

Open [http://localhost:3000](http://localhost:3000).

### Docker Compose (optional)

Create a `docker-compose.yml`:

```yaml
version: "3.8"
services:
  jarvis:
    build: .
    ports:
      - "3000:80"
    restart: unless-stopped
```

```bash
docker compose up -d
```

---

## Architecture

### Dual-Tone Hybrid UI

| Layer | Purpose | Aesthetic |
|-------|---------|-----------|
| **Serious Shell** | Dashboard, Missions, Vault, Audit, Financials | Deep dark mode, Inter font, Slate/Emerald, clean data tables |
| **Surveillance Module** | Pixel Office with live AI agent sprites | CRT scanlines, Press Start 2P font, Amiga-style beveled windows, vibrant 32-bit palette |

### Navigation

| Tab | Icon | Description |
|-----|------|-------------|
| Dashboard | Bar Chart | KPI stats, active operations, agent fleet overview |
| Missions | Target | Kanban board (Backlog → Done) |
| Surveillance | CCTV | Pixel office with interactive agent sprites |
| The Vault | Shield | API keys & credentials management |
| Audit | Scroll | Immutable, filterable activity log |
| Financials | Dollar | Budget vs. actual burn rate charts |

### Surveillance Controls

Click buttons in the left panel to trigger agent animations:

- **WORKING** — agents at desks, typing
- **TEAM MEETING** — agents walk to conference table
- **ALL HANDS** — everyone gathers center
- **BREAK TIME** — agents head to water cooler
- **WELCOME AGENT** — new agent spawns at entrance, walks in

### Database

Client-side **SQLite** via [sql.js](https://github.com/sql-js/sql.js/) (WASM). Data persists in IndexedDB. No backend required.

- **Reset DB**: Red icon in the navigation rail. Double-confirmation dialog (type `RESET JARVIS`) wipes all data and returns to the Founder Ceremony.

---

## Tech Stack

- **React 18** + **TypeScript**
- **Vite** (build tooling)
- **Tailwind CSS** (utility-first styling)
- **React Router 6** (client-side routing)
- **Lucide React** (icons)
- **sql.js** (SQLite in WASM, persisted to IndexedDB)
- **Nginx** (Docker production serving)

## Project Structure

```
src/
├── App.tsx                          # Root: DB boot → ceremony or dashboard
├── main.tsx                         # React entry point
├── index.css                        # Tailwind + CRT/pixel art styles
├── lib/
│   └── database.ts                  # SQLite init, schema, CRUD, persistence
├── hooks/
│   └── useDatabase.ts               # React hook for DB lifecycle
├── types/
│   └── index.ts                     # Shared TypeScript types
├── data/
│   └── dummyData.ts                 # Mock agents, missions, financials
├── components/
│   ├── FounderCeremony/
│   │   └── FounderCeremony.tsx      # Cinematic onboarding sequence
│   ├── Layout/
│   │   ├── AppLayout.tsx            # Shell: nav rail + content outlet
│   │   ├── NavigationRail.tsx       # 72px sidebar with icons + reset
│   │   └── ResetDBDialog.tsx        # Double-confirm DB destruction
│   ├── Dashboard/
│   │   └── DashboardView.tsx        # Stats, operations table, agent fleet
│   ├── Missions/
│   │   └── MissionsView.tsx         # 4-column Kanban board
│   ├── Surveillance/
│   │   ├── SurveillanceModule.tsx   # State manager + layout
│   │   ├── CRTFrame.tsx             # CRT monitor wrapper
│   │   ├── PixelOffice.tsx          # Office furniture + agent rendering
│   │   ├── AgentSprite.tsx          # CSS pixel art character
│   │   └── SurveillanceControls.tsx # Scene trigger buttons
│   ├── Vault/
│   │   └── VaultView.tsx            # Credentials table
│   ├── Audit/
│   │   └── AuditView.tsx            # Filterable log viewer
│   └── Financials/
│       └── FinancialsView.tsx       # Budget chart + data table
```

## License

Private — Jarvis Inc.
