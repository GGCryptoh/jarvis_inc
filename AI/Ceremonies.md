# Ceremonies — Design Reference

> Committed project documentation. Defines all ceremony flows — from founder onboarding
> to CEO walk-in to agent hiring. Each ceremony is a scripted state machine with
> visual animations, sound effects, and DB persistence.

---

## Overview

Ceremonies are the theatrical moments that make Jarvis Inc feel alive. They're scripted sequences — not interactive flows — that play out automatically with timed animations. Each ceremony updates the database to track completion so it only plays once.

---

## 1. Founder Ceremony

### File: `src/components/FounderCeremony/FounderCeremony.tsx`

### Trigger
App boot when `isFounderInitialized()` returns false (no `founder_name` in settings).

### Stages

```
terminal_boot → form → activation → complete
```

1. **terminal_boot**: CRT-themed terminal with line-by-line boot sequence
   - "JARVIS INC. SYSTEMS INITIALIZING..."
   - "LOADING NEURAL NETWORKS..."
   - "ESTABLISHING SECURE CHANNELS..."
   - Lines appear with typewriter effect (~100ms per line)

2. **form**: Founder registration form
   - **CALLSIGN**: Text input, max 12 chars, auto-uppercased
   - **ORGANIZATION**: Text input for org name
   - Both required — submit button disabled until filled
   - CRT visual styling with pixel font

3. **activation**: Success animation
   - "FOUNDER {CALLSIGN} REGISTERED"
   - "ORGANIZATION: {ORG NAME}"
   - "SYSTEMS ONLINE"
   - Brief celebration effect

4. **complete**: Saves to DB, proceeds to CEO ceremony
   - `setSetting('founder_name', callsign)`
   - `setSetting('org_name', orgName)`

### Settings Written
- `founder_name` — uppercased callsign
- `org_name` — organization name as typed

---

## 2. CEO Ceremony

### File: `src/components/CEOCeremony/CEOCeremony.tsx`

### Trigger
App boot when `isFounderInitialized()` is true but `isCEOInitialized()` is false.

### Stages

```
form → progress → activation → complete
```

1. **form**: CEO designation form
   - **CEO CALLSIGN**: Text input, max 12 chars, auto-uppercased
   - **AI MODEL**: Dropdown select from `MODEL_OPTIONS` (12 models)
   - **MANAGEMENT PHILOSOPHY**: Text input (free-form)
   - **RISK TOLERANCE**: Radio buttons — Conservative / Moderate / Aggressive
   - All required

2. **progress**: Installation progress bar
   - "INSTALLING CEO PROTOCOL..."
   - Animated progress bar (0-100% over ~3 seconds)
   - Shows model name and philosophy during progress

3. **activation**: Success animation
   - "CEO {CALLSIGN} ACTIVATED"
   - "MODEL: {model}"
   - Brief celebration

4. **complete**: Saves to DB
   - `saveCEO({ name, model, philosophy, risk_tolerance, status: 'nominal' })`

### Settings Written
- CEO row in `ceo` table

---

## 3. CEO Walk-in Ceremony

### File: `src/components/Surveillance/SurveillanceView.tsx`

### Trigger
First visit to `/surveillance` after CEO is created but `ceo_walked_in` setting is not set.

### State Machine (`ceoStage`)

```
null → entering → celebrating → walking_to_desk → seated → null
```

1. **entering** (door opens, CEO walks in):
   - `doorOpen = true` → CSS `.door-open-left` + `.door-open-right`
   - CEO sprite spawns at `ENTRANCE_POSITION` ({x:50, y:92})
   - CEO walks toward `CENTER_STAGE` ({x:45, y:50})
   - Movement: 50ms tick interval, constant speed via normalized direction vector

2. **celebrating** (CEO dances):
   - `doorOpen = false` → doors close
   - CEO status = `celebrating` → CSS `.agent-celebrating` (bouncy dance)
   - `playSuccessJingle()` plays — Web Audio API ascending arpeggio (~2.5s)
   - Duration: ~2500ms

3. **walking_to_desk** (CEO walks to assigned desk):
   - CEO status = `walking`
   - Target: tier-specific CEO desk position (from `positionGenerator.ts`)
   - Movement continues at constant speed

4. **seated** (ceremony complete):
   - CEO status = `working`
   - `setSetting('ceo_walked_in', 'true')` — prevents replay
   - If `ceo_meeting_done` not set → show approval notification

### Door Animation
- `doorOpen: true` → `.door-open-left` + `.door-open-right` (CSS keyframes, doors slide apart)
- `doorOpen: false` → `.door-close-left` + `.door-close-right` (doors slide together)
- `doorOpen: null` → static, no animation

### Approval Notification
After walk-in, if `ceo_meeting_done` is not set:
- Floating retro notification: "CEO {name} would like a meeting"
- APPROVE button → navigates to `/chat`
- Shows on every visit to `/surveillance` until meeting is done
- Styled as a retro window with yellow accent

### Refs Pattern
`ceoStageRef` keeps a ref in sync with `ceoStage` state for use inside `setInterval` callbacks (avoids stale closures).

---

## 4. Agent Hire Ceremony

### File: `src/components/Surveillance/SurveillanceView.tsx`

### Trigger
User completes the HireAgentModal form and clicks HIRE.

### State Machine (`hireCeremony.stage`)

```
null → entering → celebrating → walking_to_desk → seated → null
```

Same flow as CEO walk-in but for the new agent:

1. **entering**: Door opens, new agent sprite spawns at ENTRANCE, walks to CENTER_STAGE
2. **celebrating**: Door closes, agent dances, jingle plays (~1.5s, shorter than CEO)
3. **walking_to_desk**: Agent walks to assigned desk position
4. **seated**: Agent starts working, ceremony clears

### Key Differences from CEO Walk-in
- Uses `hireCeremonyRef` instead of `ceoStageRef`
- Shorter celebration duration
- Agent is saved to DB *before* ceremony starts (so sprite data is available)
- Desk position assigned by `positionGenerator.ts` based on agent count and room tier

---

## 5. Future: System Setup Ceremony (Full Mode)

### Planned for Founder Ceremony expansion

When Supabase is available, the Founder Ceremony gains a new phase after the basic form:

```
terminal_boot → form → system_setup → activation → complete
```

**system_setup** phase:
- Live status indicators checking: Docker, Postgres, Auth, Realtime
- Supabase URL/key input (pre-filled for local dev)
- Account creation (signUp during ceremony)
- Progress tracking as each service comes online

---

## Sound System

### File: `src/lib/sounds.ts`

`playSuccessJingle()` — Pure Web Audio API synthesis, no audio files.

- **Waveforms**: Square + triangle wave oscillators
- **Melody**: Ascending arpeggio C5 → E5 → G5 → C6
- **Sparkle**: High-frequency overlay notes
- **Duration**: ~2.5 seconds
- **Plays on**: CEO celebration, agent hire celebration

---

## Position System

### File: `src/lib/positionGenerator.ts`

Provides desk positions based on room tier (determined by agent count).

| Tier | Agents | Floor Image | CEO Position |
|------|--------|-------------|-------------|
| 1 | 0-1 | `/floors/startup.png` | {x:52, y:55.3} |
| 2 | 2-3 | `/floors/level2.jpg` | {x:43, y:47} |
| 3 | 4-6 | `/floors/level3.jpg` | {x:43, y:32} |
| 4 | 7+ | `/floors/level4.jpg` | {x:15, y:52} |

Key positions:
- `ENTRANCE_POSITION`: {x:50, y:92} — bottom center door
- `CENTER_STAGE`: {x:45, y:50} — celebration point

Agent desk positions are either:
1. Loaded from DB (`desk_x`, `desk_y` columns) if set via floor planner
2. Generated by `positionGenerator.ts` preset array for the current tier

---

## CSS Classes

| Class | Used For |
|-------|---------|
| `.door-open-left` / `.door-open-right` | Door opening animation |
| `.door-close-left` / `.door-close-right` | Door closing animation |
| `.agent-celebrating` | Bouncy dance during celebration |
| `.agent-walking` | Movement bounce + scale alternation |
| `.agent-typing` | Working animation (hand bob) |
| `.crt-screen` | CRT scanline + vignette wrapper |

---

## Settings That Track Ceremony Progress

| Setting | Set By | Checked By |
|---------|--------|-----------|
| `founder_name` | FounderCeremony | App.tsx (isFounderInitialized) |
| `org_name` | FounderCeremony | Various components |
| `ceo_walked_in` | SurveillanceView (walk-in ceremony) | SurveillanceView (skip if set) |
| `ceo_meeting_done` | ChatView (finalizeMeeting) | SurveillanceView (hide notification), ChatView (show PostMeetingChat) |
| `primary_mission` | ChatView (finalizeMeeting) | PostMeetingChat, DashboardView |
