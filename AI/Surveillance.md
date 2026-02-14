# Surveillance Module — Design Reference

> Committed project documentation. Captures the visual identity, technical architecture,
> and current implementation state for the `/surveillance` pixel office module.

### Implementation Status (2026-02-13)
- **Shipped**: All 9 components (SurveillanceView, SurveillanceModule, PixelOffice, AgentSprite, CEOSprite, CRTFrame, SurveillanceControls, HireAgentModal, QuickChatPanel)
- **Shipped**: 4 floor tiers, 7 animation states, CEO walk-in + agent hire ceremonies, floor planner mode
- **Shipped**: Door animations (CSS `.door-open-left`/`.door-open-right`) — active during CEO walk-in and agent hire ceremonies
- **Shipped**: QuickChatPanel — compact chat overlay for talking to CEO without leaving surveillance
- **Shipped**: Real-time status updates via Supabase Realtime subscriptions (agents, missions, task_executions)
- **Shipped**: Cost tracking in agent/CEO hover tooltips (via `llmUsage.ts`)
- **Shipped**: Typing hands animation on AgentSprite when status='working'
- **Shipped**: CEO personality archetype + risk tolerance display in hover tooltip
- **Shipped**: Skill picker in HireAgentModal (assign skills at hire time)
- **Shipped**: Agent confidence scores refreshed from task_execution results in real-time
- **Shipped**: CEO proactive action notifications ("CEO WANTS TO CHAT") overlay

---

## Component Map

```
src/components/Surveillance/
├── SurveillanceView.tsx      # Main DB-backed view — ceremonies, sidebar, overlays
├── SurveillanceModule.tsx    # Demo mode (sample-surveillance route, dummy data)
├── PixelOffice.tsx           # Office floor rendering + agent/CEO sprites + holographic board
├── AgentSprite.tsx           # Agent pixel character + hover card with cost tracking
├── CEOSprite.tsx             # CEO pixel character + hover card with archetype + cost
├── CRTFrame.tsx              # Scanline/vignette/phosphor CRT wrapper
├── SurveillanceControls.tsx  # Scene buttons + hire + status panel
├── HireAgentModal.tsx        # Hire/edit form + live sprite preview + skill picker
└── QuickChatPanel.tsx        # Compact CEO chat overlay (bottom-center of CRT frame)
```

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
  - Hair/hat: 24px wide x 10px tall, agent `color`
  - Head: 24px x 19px, agent `skinTone`, with 3px black pixel eyes
  - Body: Arms (5px wide each, with skin-tone hands) flanking a 24px x 24px torso in agent `color`
  - Legs: Two 10px x 14px blocks (slate-700), bob animation when walking
- **Typing hands**: When status='working', two 6px x 4px skin-tone blocks appear below the torso, simulating hands on a keyboard. Arms shorten and animate via `agent-arm-left` / `agent-arm-right` CSS classes.
- **Seated offset**: When working, sprite translates down 22px (`translateY(22px)`) so agents appear to sit behind desks
- **Facing direction**: `facing` prop (`'left'` | `'right'`) applies horizontal flip via `scaleX(-1)`
- **Thought bubbles**: When working or in meeting, a thought bubble with status-specific labels appears (e.g., "compiling...", "debug...", "idea!")
- **Status dot**: Top-right corner, colored by status
- **Working glow**: Radial gradient "monitor" glow (19px x 14px) above sprite when status='working', with screen flicker animation
- **Hover glow**: On hover, a colored glow shadow radiates around the sprite using the agent's suit color
- **Hover tooltip**: Shows agent name, current task, confidence %, base cost. On hover, asynchronously loads real cost data from `getAgentUsage()` (via `llmUsage.ts`) showing task count and total LLM spend.
- **Nametag**: Agent name in agent color, Press Start 2P pixel font below sprite

### CEO Sprite (`CEOSprite.tsx`)
- ~1.2x scale of regular agent sprites (29px head width vs 24px)
- **Crown**: Unicode chess queen symbol in gold (#f1fa8c) with gold text shadow
- **Head**: 29px x 23px with 4px pixel eyes and a subtle mouth
- **Body details**: Suit lapels (darker inner rect via rgba overlay), gold tie (4px stripe), arms with brightness filter
- **Status dot**: Left side of head, gold-ringed with 2px border and glow shadow
- **Seated offset**: When working, translates down 24px
- **Working glow**: 18px x 14px radial gradient monitor glow with screen flicker
- **Hover tooltip**: Shows "CEO [NAME]", personality archetype (e.g., "WHARTON MBA"), current task, model name, status with risk tolerance level, and total LLM cost from `getAgentUsage('ceo')`
- **Name label**: "CEO [NAME]" in gold with text shadow, 9px pixel font
- **Gold hover glow**: On hover, gold-tinted shadow glow around the sprite

### Animation States
| Status | CSS Class | Visual Effect | Dot Color |
|--------|-----------|---------------|-----------|
| working | `agent-typing` | Subtle hand bob + typing hands | Green #50fa7b |
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
Door animations are active during ceremonies (CEO walk-in and agent hire):
- `doorOpen: true` → CSS classes `.door-open-left` + `.door-open-right` (doors slide apart)
- `doorOpen: false` → CSS classes `.door-close-left` + `.door-close-right` (doors slide together)
- `doorOpen: null` → static, no animation playing

### Sound
- **Success jingle** (`src/lib/sounds.ts`): Web Audio API oscillator-based
- Square + triangle wave ascending arpeggio: C5 → E5 → G5 → C6 with high sparkle notes
- No external audio files — pure synthesis
- Plays on: CEO celebration, agent hire celebration

## QuickChatPanel (`QuickChatPanel.tsx`)

Compact CEO chat overlay that lets the founder talk to the CEO without navigating away from the surveillance view.

### Behavior
- **Toggle**: Opened via the "QUICK CHAT" button in the agent detail sidebar or the chat button on surveillance controls
- **Conversation**: On mount, loads the most recent active conversation. If none exists, auto-creates a new one titled "Quick Chat"
- **LLM streaming**: Sends messages via `streamCEOResponse()` from `chatService.ts`. Tokens stream in real-time with a pulsing cursor. Falls back to `getCEOResponse()` (scripted) if LLM is unavailable.
- **Event listeners**: Reloads messages on `chat-messages-changed` and `missions-changed` events (e.g., when `taskDispatcher` posts skill results)
- **Abort handling**: If the user navigates to full chat mid-stream, the partial response is saved and the stream is aborted

### UI
- **Positioned**: Absolute bottom-center of the CRT frame, z-index 30, 600px wide
- **Title bar**: Retro-styled with CEO name, minimize/maximize/close/expand buttons
- **Messages area**: 240px tall scrollable area. User messages right-aligned (emerald), CEO messages left-aligned (zinc) with yellow CEO label
- **Rich content**: CEO messages rendered via `RichMessageContent` (supports tool call blocks)
- **Input**: Pixel-font input field with Send button. Enter key sends.
- **Minimized state**: Collapses to a small "CEO CHAT" button with message count badge

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
- Shows current missions from `loadMissions()` (limited to active/not-done, max 3)
- Before onboarding: shows contextual first-time priorities ("Meet the Founder", "Set Company Goals", "Enable first skill")
- Also displays active task executions (pending/running) with skill name, status, and assigned agent
- `pointer-events-none` — visual overlay, not interactive
- Retro-styled with semi-transparent background and pixel font

### Agent Interaction (Detail Sidebar)
- Click agent sprite → sidebar opens (280px wide, right side) with:
  - Agent name, role, model
  - Current task (or CEO philosophy)
  - Status with colored dot
  - Confidence level (0-100%) with progress bar
  - Real cost from `getAgentUsage()` (total spend + task count)
  - Active mission (title, status, priority) from `loadAgentActivity()`
  - Currently executing task (skill_id, command_name, status)
  - Assigned skills list
  - Edit Look button → HireAgentModal in edit mode
  - Fire button → two-step confirmation → `deleteAgent()`
  - Quick Chat button → opens QuickChatPanel
  - Close button

### HireAgentModal
- **Hire mode**: Form for name (max 12 chars, auto-uppercased), role (presets or custom), model selector, suit color picker, skin tone picker
- **Edit mode**: Pre-filled with existing agent data, name/role fields may be read-only for CEO
- **Skill picker**: Loads enabled skills from `resolveSkills()`. Checkboxes to select skills. On hire, skills are assigned via `assignSkillToAgent()` and stored in `agent_skills` table.
- **Live sprite preview**: Real-time preview of the agent being configured
- **CEO editing**: Supports editing CEO appearance (color, skin tone, name) via `updateCEOAppearance()`

### Meeting Clusters
- In meeting scene mode, agents cluster at midpoints between their positions
- Configurable cluster radius
- Purple glow circle rendered around each meeting group

### Fire Extinguisher Tooltip
- Hover over fire extinguisher area in the office background
- Tooltip: "Break Glass (Coming Soon)"
- Placeholder for future emergency/kill-switch feature

## Real-Time Updates

SurveillanceView subscribes to multiple event channels for live updates:

| Event | Source | Effect |
|-------|--------|--------|
| `chat-messages-changed` | chatService, taskDispatcher | CEO status → 'meeting', QuickChatPanel reloads messages |
| `task-executions-changed` | taskDispatcher, ceoScheduler | CEO/agent status updates, confidence refresh, active tasks board update |
| `missions-changed` | ceoDecisionEngine | Priority board refresh, CEO status update |
| `ceo-actions-changed` | ceoActionQueue | CEO proactive notification overlay |
| `approvals-changed` | approval mutations | Approval badge sync |

CEO real-time status cycle:
- Chat activity → status: `meeting`, task: "Chatting with Founder..."
- Task execution running → status: `working`, task: "Executing: [skill_id]"
- Mission in progress → status: `working`, task: "[mission title]"
- 30s of no activity → status: `idle`, task: "Awaiting instructions..."

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
- `.door-open-left` / `.door-open-right` — sliding door open (used during ceremonies)
- `.door-close-left` / `.door-close-right` — sliding door close (used during ceremonies)

### Agent Animations
- `.agent-sprite` — base positioning container (absolute, translate-centered)
- `.agent-typing` — working animation (subtle bob)
- `.agent-walking` — movement animation (bounce + scale alternation)
- `.agent-celebrating` — celebration dance (bouncy jump/spin)
- `.agent-meeting` — meeting sway
- `.agent-break` — break bob
- `.agent-idle` — idle breathing
- `.agent-nametag` — name label styling (pixel font, tracking)
- `.agent-arm-left` / `.agent-arm-right` — typing arm animation (when working)
- `.agent-humming` — subtle body hum when working
- `.agent-thought-bubble` / `.agent-thought-dot` / `.agent-thought-label` — thought bubble display
- `.typing-hands` — forward-extended hands at keyboard position

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

- **Agent reporting lines**: Visual hierarchy lines showing who reports to whom
- **Blocked state visualization**: Red/amber indicators when agents wait on approval or budget
- **Advanced floor planner**: Drag-and-drop positioning, snap-to-grid, zone definitions
- **Per-group ad-hoc meetings**: Select 2-3 specific agents to form a meeting cluster
- **Conference zone editor**: Define named meeting areas on the floor plan with custom labels
- **Network view**: Interactive graph showing agent communication patterns and data flow
- **Analytics overlay**: Heat map showing per-agent cost, throughput, and performance metrics
- **Ghost desk cursor**: Preview desk follows mouse when agent is selected in floor plan mode
- **Multi-floor navigation**: Tabs or elevator UI to switch between floor tiers
- **Weather/time effects**: Pixel art window showing day/night cycle, weather
