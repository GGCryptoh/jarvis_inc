# IDEAS: Mission Control — Verification, Scoring & Redo System

> **STATUS: DESIGN DOCUMENT** — Partially implemented as of Feb 2026
>
> **What shipped (from this design):**
> - `MissionDetailPage.tsx` — basic detail view at `/missions/:id` with task outputs
> - Mission review flow — approve/redo from Missions page
> - `task_executions` table — tracks per-task results, cost, tokens
> - Basic review column in Kanban
> - Green nav badge for missions in review
>
> **What has NOT shipped (future work):**
> - CEO Scorecard (quality/completeness/efficiency scoring via LLM)
> - Letter grades (A+ through F)
> - Multi-round redo system with round numbering
> - `mission_rounds` table
> - `mission_artifacts` table (deliverables browser)
> - `mission_activity` table (fine-grained activity log)
> - Reject modal with "Include Collateral" vs "Start Fresh" strategy
> - Cancel mission flow
> - Round history timeline tab
> - Deliverables tab with file preview
> - CEO evaluation prompt integration
> - Redo prompt (rejection feedback → CEO re-delegation)
> - Kanban card enhancements (round badge, score badge)
> - Per-agent leaderboard stats
>
> This remains a valid design document for future implementation.

---

## Overview

Missions today are a Kanban board with no way to inspect results, verify quality, or send work back. This document designs the **Mission Detail Page** (`/missions/:id`) — the command center for reviewing, scoring, accepting, or rejecting any mission.

Every mission execution is a **round**. Round 1 is the first attempt. If rejected, the CEO gets feedback and tries again in Round 2, Round 3, etc. Each round tracks its own agent stats, cost, tokens, duration, CEO score, and deliverables.

---

## Mission Lifecycle

```
                                    ┌──────────────┐
                                    │   BACKLOG     │
                                    └──────┬───────┘
                                           │ CEO assigns agent
                                    ┌──────▼───────┐
                                    │ IN PROGRESS   │ ◄─── Round N starts
                                    │  (Round N)    │
                                    └──────┬───────┘
                                           │ Agent completes
                                    ┌──────▼───────┐
                                    │  CEO REVIEW   │  CEO scores & comments
                                    └──────┬───────┘
                                           │ CEO passes to founder
                                    ┌──────▼───────┐
                                    │FOUNDER REVIEW │  Mission Detail Page
                                    └──┬────────┬──┘
                                       │        │
                              ACCEPT   │        │  REJECT
                                       │        │
                                ┌──────▼──┐  ┌──▼──────────┐
                                │  DONE   │  │ Feedback +   │
                                │  ✓      │  │ Redo strategy│
                                └─────────┘  └──────┬──────┘
                                                    │
                                             Round N+1 starts
                                             Back to IN PROGRESS
```

### Status Values

| Status | Meaning | Implemented? |
|--------|---------|-------------|
| `backlog` | Queued, no agent assigned yet | Yes |
| `in_progress` | Agent actively working (Round N) | Yes |
| `review` | Waiting for founder review | Yes (simplified from ceo_review + founder_review) |
| `done` | Founder accepted | Yes |
| `ceo_review` | Agent done, CEO evaluating | Not yet |
| `founder_review` | CEO scored it, waiting for founder | Not yet |
| `rejected` | Intermediate — triggers new round | Not yet |
| `cancelled` | Founder killed the mission entirely | Not yet |

---

## Mission Detail Page — `/missions/:id`

### URL Structure

```
/missions              → Kanban board (existing)
/missions/:id          → Mission detail page (SHIPPED — basic)
```

Clicking any mission card on the Kanban opens the detail page.

### Layout (target design)

```
┌─────────────────────────────────────────────────────────────────┐
│ ◄ MISSIONS                                        ROUND 2 / 3  │
│─────────────────────────────────────────────────────────────────│
│                                                                 │
│ ══ RESEARCH COMPETITOR PRICING STRATEGY ══                      │
│                                                                 │
│ Status: FOUNDER REVIEW   Priority: HIGH   Agent: SCOUT          │
│ Created: Feb 10 by CEO NEO   Due: Feb 14                       │
│                                                                 │
│ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐       │
│ │  AGENT    │ │   COST    │ │  TOKENS   │ │ DURATION  │       │
│ │  SCOUT    │ │  $0.42    │ │  12.4K    │ │  3m 22s   │       │
│ │  GPT-5.2  │ │  this rnd │ │  this rnd │ │  this rnd │       │
│ └───────────┘ └───────────┘ └───────────┘ └───────────┘       │
│                                                                 │
│ ┌── CEO SCORECARD ─────────────────────────────────────────┐   │
│ │  QUALITY        ████████████████░░░░  80%                │   │
│ │  COMPLETENESS   ████████████████████  100%               │   │
│ │  EFFICIENCY     ████████████░░░░░░░░  60%                │   │
│ │  OVERALL        ████████████████░░░░  80%   GRADE: B+    │   │
│ │                                                           │   │
│ │  CEO NEO: "Solid work. Pricing data is accurate but      │   │
│ │  the enterprise tier comparison could be deeper."         │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│ [RESULTS] [DELIVERABLES] [ACTIVITY] [ROUNDS]                    │
│                                                                 │
│   [ ✓ ACCEPT MISSION ]         [ ✗ REJECT & REDO ]             │
└─────────────────────────────────────────────────────────────────┘
```

---

## CEO Scorecard (NOT YET IMPLEMENTED)

The CEO scores every completed round before it reaches the founder. Four dimensions, each 0-100:

| Dimension | What it measures |
|-----------|-----------------|
| **Quality** | How well does the output meet the stated objective? |
| **Completeness** | Were all requirements addressed? |
| **Efficiency** | Cost and time relative to expectation |
| **Overall** | Weighted composite with CEO judgment override |

### Letter Grades

| Score | Grade | Color |
|-------|-------|-------|
| 90-100 | A / A+ | `pixel-green` |
| 80-89 | B+ / B | `pixel-cyan` |
| 70-79 | B- / C+ | `pixel-yellow` |
| 60-69 | C / C- | `pixel-orange` |
| 0-59 | D / F | `pixel-pink` |

---

## Accept Flow (BASIC VERSION SHIPPED)

1. Founder clicks **ACCEPT MISSION**
2. Mission status → `done`
3. Audit log: `MISSION_APPROVED`
4. Dashboard updates

Future enhancements (not shipped):
- Agent celebration sprite
- CEO learning notification
- Toast confirmation

---

## Reject & Redo Flow (NOT YET IMPLEMENTED)

### Reject Modal (target design)

```
┌── SEND BACK FOR REDO ──────────────────────────────────────┐
│  ROUND 2 → ROUND 3                                         │
│                                                             │
│  WHAT WENT WRONG?                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ [feedback text area]                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  REDO STRATEGY                                              │
│  [■] INCLUDE ALL COLLATERAL                                 │
│  [ ] START FRESH                                            │
│                                                             │
│      [ CANCEL ]        [ ▶ SEND BACK — START ROUND 3 ]     │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Model (NOT YET IMPLEMENTED)

### New Tables Needed

#### `mission_rounds`
One row per execution attempt with agent, status, scores, cost, conversation snapshot.

#### `mission_artifacts`
Deliverables produced by agents (documents, images, data, code).

#### `mission_activity`
Fine-grained activity log per mission (separate from global audit_log).

### Modifications to `missions` Table
- `current_round` INTEGER
- `description` TEXT
- `total_cost` REAL
- `total_tokens` INTEGER
- `total_duration_ms` INTEGER
- `cancelled_reason` TEXT

---

## CEO Evaluation Prompt (NOT YET IMPLEMENTED)

Template for CEO to score agent output:

```
You are CEO {ceo_name} of {org_name}.

An agent has completed a task. Evaluate the results.

MISSION: {mission_title}
AGENT OUTPUT: {result_summary}
TOKENS USED: {tokens}  COST: ${cost}  DURATION: {duration}

Score each dimension 0-100 and provide an overall grade.
Respond in JSON:
{
  "quality": <0-100>,
  "completeness": <0-100>,
  "efficiency": <0-100>,
  "overall": <0-100>,
  "grade": "<A+|A|B+|B|B-|C+|C|C-|D|F>",
  "review": "<2-3 sentence evaluation>",
  "recommendation": "<approve|reject|needs_revision>"
}
```

---

## Component Structure (target)

```
src/components/Missions/
├── MissionsView.tsx          # Kanban board (existing, enhanced)
├── MissionDetailPage.tsx     # /missions/:id (SHIPPED — basic)
├── MissionScorecard.tsx      # CEO score bars + grade (NOT YET)
├── MissionResults.tsx        # Results tab (NOT YET)
├── MissionDeliverables.tsx   # File browser (NOT YET)
├── MissionActivity.tsx       # Filtered log (NOT YET)
├── MissionRounds.tsx         # Round history (NOT YET)
├── RejectMissionModal.tsx    # Reject + redo (NOT YET)
└── CancelMissionModal.tsx    # Cancel confirm (NOT YET)
```

---

## Implementation Order

1. DB schema — mission_rounds, mission_artifacts, mission_activity tables
2. MissionDetailPage enhancement — stats cards + tabs
3. Scorecard component — progress bars + grade badge
4. Accept flow enhancement — celebration + learning
5. Reject modal — feedback + redo strategy
6. Rounds tab — timeline
7. Activity tab — filtered log
8. Deliverables tab — file browser
9. Kanban enhancements — round badge, score badge, REVIEW column
10. CEO evaluation prompt — wire into review step
11. Redo prompt — rejection feedback → CEO re-delegation

---

## Theme Notes

Mission Detail Page uses the **serious shell** aesthetic. CEO scorecard bridges both visual systems with pixel-art progress bars and retro color grades. Reject modal uses CRT-glow treatment.
