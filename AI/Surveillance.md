# Surveillance Module — Design Reference

> Committed project documentation. Captures the visual identity, technical architecture,
> and future vision for the `/surveillance` pixel office module.

---

## Visual Identity

- **Aesthetic**: Retro pixel art office inside a CRT frame — "nuclear power plant control room with one monitor showing the actual reactor core"
- **Font**: Press Start 2P (pixel bitmap, loaded via Google Fonts)
- **Palette**: Vibrant 32-bit Dracula-inspired
  | Name | Hex | Usage |
  |------|-----|-------|
  | Pink | #ff6b9d | Agent sprites, accents |
  | Green | #50fa7b | Working status, success |
  | Purple | #bd93f9 | Meeting zones, luxury |
  | Orange | #ffb86c | Walking status, warnings |
  | Cyan | #8be9fd | Break status, info |
  | Yellow | #f1fa8c | CEO crown, celebrate |
  | Red | #ff5555 | Errors, fire |
  | Magenta | #ff79c6 | Celebrating status |
  | Steel | #6272a4 | Neutral, idle |
  | White | #f8f8f2 | Text, highlights |
- **Borders**: Chunky 3D beveled Amiga-style windows (`.retro-window`, `.retro-button`, `.retro-inset`)
- **Animations**: Frame-by-frame sprite animations at 50ms tick interval (20fps effective)
- **CRT effects**: Scanlines overlay, vignette darkening at corners, phosphor glow on elements, pixel grid texture

## Floor System

### Progressive Room Tiers
| Tier | Agents | Image | Layout |
|------|--------|-------|--------|
| 1 | 0-1 | `/floors/startup.png` | CEO desk + window + plants + fire extinguisher + door |
| 2 | 2-3 | `/floors/level2.jpg` | 4 desks + window + plants + fire extinguisher + door |
| 3 | 4-6 | `/floors/level3.jpg` | 7 desks + whiteboard + plants + fire extinguisher |
| 4 | 7+ | `/floors/level4.jpg` | Multi-room: CEO office, open floor, conference room, many desks |

- Background images are pre-made pixel art, served as static assets from `/public/floors/`
- Auto-swap triggered by `getRoomTier(agentCount)` function
- Agent sprites overlay via absolute CSS positioning using percentage coordinates (0-100)

### Position System
- **DB-driven**: `desk_x REAL`, `desk_y REAL` columns on `agents` and `ceo` tables
- **Fallback**: `positionGenerator.ts` provides tier-specific preset positions if DB values are NULL
- **Floor planner mode**: Click-to-place agents, saves via `saveAgentDeskPosition()` / `saveCEODeskPosition()`
- **Key positions**:
  - `ENTRANCE_POSITION`: {x:50, y:92} — bottom center, door location
  - `CENTER_STAGE`: {x:45, y:50} — celebration point for ceremonies
  - CEO desk: tier-specific (tier 1: {x:52, y:55.3}, tier 2: {x:43, y:47}, tier 3: {x:43, y:32}, tier 4: {x:15, y:52})

## Sprite System

### Agent Sprite (`AgentSprite.tsx`)
- **Pixel art character**: CSS-constructed (no image files)
  - Hair/hat: 15px wide x 6px tall, agent `color`
  - Head: 15px x 12px, agent `skinTone`, with 2px black pixel eyes and mouth
  - Body: 18px x 15px, agent `color`
  - Legs: Two 6px x 9px blocks (slate-700), bob animation when walking
- **Status dot**: Top-right corner, colored by status
- **Working glow**: Small "monitor" glow rectangle above sprite when status='working'
- **Nametag**: Agent name in agent color, Press Start 2P pixel font below sprite

### CEO Sprite (`CEOSprite.tsx`)
- 2.5-3x larger than agent sprites
- **Crown**: Unicode chess queen symbol in gold (#f1fa8c)
- **Body details**: Suit lapels (darker inner rect), gold tie (3px stripe), arms
- **Status dot**: Gold-ringed with 2px border and glow shadow
- **Working glow**: Larger 15px x 12px monitor glow
- **Name label**: "CEO [NAME]" in gold with text shadow

### Animation States
| Status | CSS Class | Visual Effect | Dot Color |
|--------|-----------|---------------|-----------|
| working | `agent-typing` | Subtle hand bob | Green #50fa7b |
| walking | `agent-walking` | Bounce + scale alternation | Orange #ffb86c |
| celebrating | `agent-celebrating` | Bouncy jump/spin dance | Magenta #ff79c6 |
| meeting | `agent-meeting` | Gentle sway | Purple #bd93f9 |
| break | `agent-break` | Relaxed bob | Cyan #8be9fd |
| idle | `agent-idle` | Slow breathing bob | Gray #64748b |
| arriving | `agent-walking` | Same as walking | Yellow #f1fa8c |

### Movement
- 50ms tick interval via `setInterval`
- Constant speed: 0.6% of viewport per tick
- Distance calculation: `sqrt(dx^2 + dy^2)`
- Snap to target when distance < 0.5%
- Direction normalized to prevent overshoot

## Ceremonies

### CEO Walk-in (First Visit to `/surveillance`)
**Trigger**: CEO exists in DB but `ceo_walked_in` setting is not set.
**State machine** (`ceoStage`):
```
null → entering → celebrating → walking_to_desk → seated → null
```
1. **entering**: Door opens (CSS `.door-open-left`/`.door-open-right`), CEO walks from ENTRANCE to CENTER_STAGE
2. **celebrating**: Door closes, CEO dance animation, `playSuccessJingle()` plays (~2.5s)
3. **walking_to_desk**: CEO walks to tier-specific CEO desk position
4. **seated**: `setSetting('ceo_walked_in', 'true')`, show approval notification if meeting not done

### Agent Hire Ceremony
**Trigger**: User clicks HIRE AGENT and submits form.
**State machine** (`hireCeremony.stage`):
```
null → entering → celebrating → walking_to_desk → seated → null
```
Same flow as CEO walk-in but for the new agent. Uses `hireCeremonyRef` to sync state inside setInterval.

### Door Animation
- `doorOpen: true` → CSS classes `.door-open-left` + `.door-open-right` (doors slide apart)
- `doorOpen: false` → CSS classes `.door-close-left` + `.door-close-right` (doors slide together)
- `doorOpen: null` → static, no animation playing

### Sound
- **Success jingle** (`src/lib/sounds.ts`): Web Audio API oscillator-based
- Square + triangle wave ascending arpeggio: C5 → E5 → G5 → C6 with high sparkle notes
- No external audio files — pure synthesis
- Plays on: CEO celebration, agent hire celebration

## Interactive Elements

### Top Menu
Four buttons as HTML overlay on the office viewport:
- **[OVERVIEW]** — current default view (functional)
- **[FLOOR PLAN]** — toggle floor planner mode (functional)
- **[NETWORK]** — future: agent communication graph (decorative)
- **[ANALYTICS]** — future: performance heat map (decorative)

### Floor Plan Mode
- Activated via FLOOR PLAN button toggle
- Green grid overlay appears on the office
- Click an agent sprite to select it (highlight ring)
- Click anywhere on the office floor to set that agent's desk position
- Position saved to DB via `saveAgentDeskPosition(id, x, y)` / `saveCEODeskPosition(x, y)`

### Today's Priorities
- Holographic "TODAY'S PRIORITIES" panel positioned top-right of the office
- Shows current missions from `loadMissions()` (limited to critical/high priority)
- `pointer-events-none` — visual overlay, not interactive
- Retro-styled with semi-transparent background and pixel font

### Agent Interaction
- Click agent sprite → sidebar opens with:
  - Agent name, role, model
  - Current status and task
  - Confidence level (0-100%)
  - Cost so far (token spend)
  - Edit button → HireAgentModal in edit mode
  - Fire button → confirmation dialog → `deleteAgent()`

### Meeting Clusters
- In meeting scene mode, agents cluster at midpoints between their positions
- Configurable cluster radius
- Purple glow circle rendered around each meeting group

### Fire Extinguisher Tooltip
- Hover over fire extinguisher area in the office background
- Tooltip: "Break Glass (Coming Soon)"
- Placeholder for future emergency/kill-switch feature

## CSS Classes Reference

### Retro Window System
- `.retro-window` — main container with beveled border
- `.retro-window-title` — title bar with drag-handle dots
- `.retro-window-body` — content area
- `.retro-button` — beveled push button
- `.retro-inset` — recessed panel (for monitors, input areas)

### CRT Effects
- `.crt-screen` — container applying all CRT effects
- `.crt-flicker` — subtle brightness oscillation
- `.phosphor-glow` — green/amber glow on text elements
- `.pixel-grid` — fine pixel grid texture overlay
- `.pixel-art` — image-rendering: pixelated for crisp pixel art scaling

### Door Animations
- `.door-open-left` / `.door-open-right` — sliding door open
- `.door-close-left` / `.door-close-right` — sliding door close

### Agent Animations
- `.agent-sprite` — base positioning container
- `.agent-typing` — working animation
- `.agent-walking` — movement animation
- `.agent-celebrating` — celebration dance
- `.agent-meeting` — meeting sway
- `.agent-break` — break bob
- `.agent-idle` — idle breathing
- `.agent-nametag` — name label styling

## Color Palettes (for Agent Customization)

### Suit Colors (10 options)
| Color | Hex | Label |
|-------|-----|-------|
| Pink | #ff6b9d | Pink |
| Green | #50fa7b | Green |
| Purple | #bd93f9 | Purple |
| Orange | #ffb86c | Orange |
| Cyan | #8be9fd | Cyan |
| Yellow | #f1fa8c | Yellow |
| Red | #ff5555 | Red |
| Steel | #6272a4 | Steel |
| Magenta | #ff79c6 | Magenta |
| White | #f8f8f2 | White |

### Skin Tones (6 options)
| Hex | Label |
|-----|-------|
| #ffcc99 | Light |
| #f0b88a | Fair |
| #e8a872 | Medium |
| #c8956c | Tan |
| #a0704e | Brown |
| #6b4226 | Dark |

## Future Vision

- **Real-time agent status**: Reflect actual LLM execution state (thinking, generating, waiting for API, etc.)
- **Agent reporting lines**: Visual hierarchy lines showing who reports to whom
- **Blocked state visualization**: Red/amber indicators when agents wait on approval or budget
- **Advanced floor planner**: Drag-and-drop positioning, snap-to-grid, zone definitions
- **Per-group ad-hoc meetings**: Select 2-3 specific agents to form a meeting cluster
- **Conference zone editor**: Define named meeting areas on the floor plan with custom labels
- **Network view**: Interactive graph showing agent communication patterns and data flow
- **Analytics overlay**: Heat map showing per-agent cost, throughput, and performance metrics
- **Agent desk offset**: `translateY(14px)` when working so agents appear to sit behind desks
- **Ghost desk cursor**: Preview desk follows mouse when agent is selected in floor plan mode
- **Multi-floor navigation**: Tabs or elevator UI to switch between floor tiers
- **Weather/time effects**: Pixel art window showing day/night cycle, weather
