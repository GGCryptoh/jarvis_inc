# IDEAS: Mission Control — Verification, Scoring & Redo System

> Design document for the mission detail page, CEO scoring, accept/reject flow, versioned rounds, and artifact browsing.

### Implementation Status (2026-02-12)
- **Status**: Design phase only — nothing from this doc is implemented yet
- **Current state**: Basic 4-column Kanban board exists at `/missions`, no detail page
- **Roadmap**: Phase 3 (Agent Runtime + Mission Verification) in TASKS.md, items #36-41

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

| Status | Meaning |
|--------|---------|
| `backlog` | Queued, no agent assigned yet |
| `in_progress` | Agent actively working (Round N) |
| `ceo_review` | Agent done, CEO evaluating |
| `founder_review` | CEO scored it, waiting for founder accept/reject |
| `done` | Founder accepted |
| `rejected` | Intermediate — triggers new round (not a final state) |
| `cancelled` | Founder killed the mission entirely |

---

## Mission Detail Page — `/missions/:id`

### URL Structure

```
/missions              → Kanban board (existing)
/missions/:id          → Mission detail page (new)
```

Clicking any mission card on the Kanban opens the detail page.

### Layout

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
│ │                                                           │   │
│ │  QUALITY        ████████████████░░░░  80%                │   │
│ │  COMPLETENESS   ████████████████████  100%               │   │
│ │  EFFICIENCY     ████████████░░░░░░░░  60%                │   │
│ │  ─────────────────────────────────────                    │   │
│ │  OVERALL        ████████████████░░░░  80%   GRADE: B+    │   │
│ │                                                           │   │
│ │  CEO NEO: "Solid work. Pricing data is accurate but      │   │
│ │  the enterprise tier comparison could be deeper.          │   │
│ │  Recommend approval with minor caveat."                   │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│ [RESULTS] [DELIVERABLES] [ACTIVITY] [ROUNDS]     ← tab bar     │
│                                                                 │
│ ┌── RESULTS ───────────────────────────────────────────────┐   │
│ │                                                           │   │
│ │  Agent SCOUT completed the competitive pricing analysis.  │   │
│ │  Findings:                                                │   │
│ │  • Competitor A charges $49/mo for similar features       │   │
│ │  • Competitor B has a freemium model with $29/mo pro      │   │
│ │  • Market average sits at $39/mo for our tier             │   │
│ │  • Enterprise pricing varies wildly ($200-$800/seat)      │   │
│ │                                                           │   │
│ │  Recommendation: Price at $39/mo with annual discount.    │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│                                                                 │
│   [ ✓ ACCEPT MISSION ]         [ ✗ REJECT & REDO ]             │
│                                                                 │
│   [ ☠ CANCEL MISSION ]  (small, muted, bottom-left)            │
└─────────────────────────────────────────────────────────────────┘
```

### Tabs

#### RESULTS (default)

The agent's final output — summary text, conclusions, recommendations. This is the "what did the agent actually produce?" view. Rendered as markdown.

#### DELIVERABLES

File/artifact browser for anything the agent generated:

```
┌── DELIVERABLES (3) ────────────────────────────────────────┐
│                                                             │
│  📄  competitor-analysis.md              2.3 KB   PREVIEW  │
│  📊  pricing-comparison.csv              1.1 KB   DOWNLOAD │
│  🖼  market-position-chart.png           45 KB    PREVIEW  │
│                                                             │
│  Total: 48.4 KB across 3 files                             │
│                                                             │
│  No deliverables? Agent may have only produced text output  │
│  (see Results tab).                                         │
└─────────────────────────────────────────────────────────────┘
```

Clicking PREVIEW opens an inline viewer (markdown rendered, images displayed, CSV as table). DOWNLOAD saves to local filesystem.

Deliverables persist across rounds. If "Include all collateral" is chosen on reject, previous round deliverables are available to the agent and visible in a "Prior Rounds" section.

#### ACTIVITY

Pre-filtered audit log showing only events for this mission:

```
┌── ACTIVITY ────────────────────────────────────────────────┐
│                                                             │
│  14:22:01  SYSTEM    Mission assigned to SCOUT              │
│  14:22:03  SCOUT     Started skill: Research Web            │
│  14:22:15  SCOUT     Browsed 3 competitor websites          │
│  14:23:01  SCOUT     Generated pricing spreadsheet          │
│  14:24:30  SCOUT     Completed — submitted for review       │
│  14:24:35  CEO NEO   Reviewing results...                   │
│  14:25:10  CEO NEO   Scored: Quality 80%, Overall B+        │
│  14:25:12  CEO NEO   Forwarded to founder for approval      │
│                                                             │
│  Showing Round 2 activity. [View all rounds ▾]              │
└─────────────────────────────────────────────────────────────┘
```

#### ROUNDS

History of all rounds for this mission:

```
┌── ROUND HISTORY ───────────────────────────────────────────┐
│                                                             │
│  ROUND 1  ✗ REJECTED                           3m 05s      │
│  Agent: SCOUT  •  $0.38  •  10.2K tokens  •  Score: C+     │
│  Rejected: "Missing enterprise tier pricing entirely.       │
│  Need at least 3 enterprise competitors."                   │
│  Strategy: Include collateral                               │
│                                                             │
│  ROUND 2  ✗ REJECTED                           2m 48s      │
│  Agent: SCOUT  •  $0.31  •  8.8K tokens  •  Score: B       │
│  Rejected: "Enterprise numbers don't match their website.   │
│  Verify against actual pricing pages, not blog posts."      │
│  Strategy: Include collateral                               │
│                                                             │
│  ROUND 3  ⏳ IN REVIEW                         3m 22s      │
│  Agent: SCOUT  •  $0.42  •  12.4K tokens  •  Score: B+     │
│  CEO: "Solid work. Enterprise data verified. Recommend      │
│  approval with minor caveat about annual pricing."          │
│                                                             │
│  ── TOTALS ──                                               │
│  3 rounds  •  9m 15s total  •  $1.11 total  •  31.4K tkns  │
└─────────────────────────────────────────────────────────────┘
```

---

## CEO Scorecard

The CEO scores every completed round before it reaches the founder. Four dimensions, each 0-100:

| Dimension | What it measures |
|-----------|-----------------|
| **Quality** | How well does the output meet the stated objective? Accuracy, depth, correctness. |
| **Completeness** | Were all requirements and sub-tasks addressed? Nothing missing? |
| **Efficiency** | Cost and time relative to what was expected. Under budget = high score. |
| **Overall** | Weighted composite. CEO can override the math with judgment. |

### Letter Grades

| Score | Grade | Color |
|-------|-------|-------|
| 90-100 | A / A+ | `pixel-green` |
| 80-89 | B+ / B | `pixel-cyan` |
| 70-79 | B- / C+ | `pixel-yellow` (#f1fa8c) |
| 60-69 | C / C- | `pixel-orange` (#ffb86c) |
| 0-59 | D / F | `pixel-pink` (#ff79c6) |

### Score Persistence

CEO scores are generated via LLM — the CEO evaluates the agent's output against the original objective and constraints. The evaluation prompt (from `CEO-Prompts.md`) produces structured JSON:

```json
{
  "quality": 80,
  "completeness": 100,
  "efficiency": 60,
  "overall": 80,
  "grade": "B+",
  "review": "Solid work. Pricing data is accurate but the enterprise tier comparison could be deeper. Recommend approval with minor caveat.",
  "recommendation": "approve"
}
```

CEO recommendation is advisory — the founder always has final say.

---

## Accept Flow

1. Founder clicks **ACCEPT MISSION**
2. Confirmation toast: "Mission accepted. Nice work, SCOUT."
3. Current round status → `accepted`
4. Mission status → `done`
5. Audit log: `MISSION_ACCEPTED` with round number, agent, total cost
6. Agent sprite briefly celebrates (if surveillance is open)
7. Dashboard updates: done count +1
8. CEO receives notification for learning (improves future delegation)

---

## Reject & Redo Flow

### Reject Modal

```
┌── SEND BACK FOR REDO ──────────────────────────────────────┐
│                                                             │
│  ROUND 2 → ROUND 3                                         │
│                                                             │
│  WHAT WENT WRONG?                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Enterprise pricing numbers don't match their actual  │   │
│  │ website. Looks like agent pulled from a 2024 blog    │   │
│  │ post. Need current data from pricing pages directly. │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  REDO STRATEGY                                              │
│                                                             │
│  [■] INCLUDE ALL COLLATERAL                                 │
│      Agent keeps all work product, research, and context    │
│      from this round. Builds on what was done — just fix    │
│      the specific issues.                                   │
│      Best for: minor corrections, missing details, tweaks   │
│                                                             │
│  [ ] START FRESH                                            │
│      Wipe the slate. Agent starts from scratch with only    │
│      the original objective + your feedback. Prior work     │
│      is archived but not passed to the agent.               │
│      Best for: fundamentally wrong approach, bad data       │
│                                                             │
│                                                             │
│  Cumulative: 2 rounds • $0.69 spent • 19K tokens           │
│                                                             │
│      [ CANCEL ]        [ ▶ SEND BACK — START ROUND 3 ]     │
└─────────────────────────────────────────────────────────────┘
```

### Reject Processing

1. Founder fills in rejection reason (required) and picks strategy
2. On submit:
   - Current round status → `rejected`
   - Save: `rejection_reason`, `redo_strategy` to the round
   - Increment mission round counter
   - Create new `mission_round` row (round N+1)
   - Mission status → `in_progress`
   - CEO receives structured feedback:
     ```
     MISSION REJECTED — ROUND 2
     Founder feedback: "Enterprise pricing numbers don't match..."
     Strategy: INCLUDE COLLATERAL (all prior work available)
     Original objective: [mission title + description]
     ```
   - If "include collateral": CEO/agent gets full conversation history + deliverables from prior round
   - If "start fresh": CEO/agent gets only original objective + rejection feedback
   - Audit log: `MISSION_REJECTED` with round, reason, strategy

### Round Numbering

Simple incrementing integers. Display format: **ROUND N**

The header badge shows: `ROUND 2 / 3` meaning "currently on round 3, this was attempt 2". Or just `ROUND 3` for the current view.

In the Kanban board, missions with multiple rounds show a badge:

```
┌─────────────────────────┐
│ Research Competitors     │
│ SCOUT • HIGH            │
│ ⟳ Round 3               │  ← only shown if round > 1
└─────────────────────────┘
```

---

## Cancel Mission

A muted "CANCEL MISSION" link at the bottom of the detail page. Opens a confirmation:

```
┌── CANCEL MISSION ──────────────────────────────────────────┐
│                                                             │
│  ⚠ This will permanently stop this mission.                │
│  All rounds and deliverables are preserved in the archive.  │
│                                                             │
│  REASON (optional):                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ No longer relevant — competitor shut down.           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│      [ GO BACK ]        [ ☠ CANCEL THIS MISSION ]          │
└─────────────────────────────────────────────────────────────┘
```

Sets status → `cancelled`. Preserved in audit and visible in a "Cancelled" column or archive view.

---

## Data Model

### New/Modified Tables

#### `missions` (modified)

Add columns:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `current_round` | INTEGER | 1 | Active round number |
| `description` | TEXT | NULL | Detailed objective/brief |
| `total_cost` | REAL | 0 | Sum across all rounds |
| `total_tokens` | INTEGER | 0 | Sum across all rounds |
| `total_duration_ms` | INTEGER | 0 | Sum across all rounds |
| `cancelled_reason` | TEXT | NULL | If cancelled |

#### `mission_rounds` (new)

One row per execution attempt:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | `round-{mission_id}-{round_number}` |
| `mission_id` | TEXT FK | References missions.id |
| `round_number` | INTEGER | 1, 2, 3, ... |
| `agent_id` | TEXT | Which agent executed |
| `status` | TEXT | `in_progress`, `ceo_review`, `founder_review`, `accepted`, `rejected` |
| `started_at` | TEXT | ISO timestamp |
| `completed_at` | TEXT | When agent finished (NULL if in progress) |
| `duration_ms` | INTEGER | Time from start to agent completion |
| `tokens_used` | INTEGER | LLM tokens consumed this round |
| `cost` | REAL | Dollar cost this round |
| `model` | TEXT | LLM model used |
| `result_summary` | TEXT | Agent's output text (markdown) |
| `ceo_score_quality` | INTEGER | 0-100 |
| `ceo_score_completeness` | INTEGER | 0-100 |
| `ceo_score_efficiency` | INTEGER | 0-100 |
| `ceo_score_overall` | INTEGER | 0-100 |
| `ceo_grade` | TEXT | A+, A, B+, B, B-, C+, C, C-, D, F |
| `ceo_review` | TEXT | CEO's written evaluation |
| `ceo_recommendation` | TEXT | `approve`, `reject`, `needs_revision` |
| `rejection_reason` | TEXT | Founder's rejection feedback (NULL if accepted) |
| `redo_strategy` | TEXT | `include_collateral` or `start_fresh` (NULL if accepted) |
| `conversation_snapshot` | TEXT | JSON — full LLM conversation for this round |

#### `mission_artifacts` (new)

Deliverables produced by agents:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | `artifact-{timestamp}` |
| `mission_id` | TEXT FK | References missions.id |
| `round_id` | TEXT FK | References mission_rounds.id |
| `name` | TEXT | Filename or title |
| `type` | TEXT | `document`, `image`, `data`, `code`, `report`, `other` |
| `mime_type` | TEXT | `text/markdown`, `image/png`, `text/csv`, etc. |
| `content` | TEXT | Text content (for documents, code, CSV) |
| `content_url` | TEXT | URL or blob reference (for images, large files) |
| `size_bytes` | INTEGER | File size |
| `created_at` | TEXT | ISO timestamp |

#### `mission_activity` (new)

Fine-grained activity log (separate from global audit_log for performance):

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | `activity-{timestamp}` |
| `mission_id` | TEXT FK | References missions.id |
| `round_id` | TEXT FK | References mission_rounds.id |
| `timestamp` | TEXT | ISO timestamp |
| `actor` | TEXT | Agent name, CEO name, `SYSTEM`, or founder name |
| `actor_type` | TEXT | `agent`, `ceo`, `system`, `founder` |
| `action` | TEXT | Event type (see Activity Events below) |
| `details` | TEXT | Human-readable description |

### Activity Events

| Action | Actor | When |
|--------|-------|------|
| `MISSION_ASSIGNED` | SYSTEM | CEO assigns agent |
| `ROUND_STARTED` | SYSTEM | New round begins |
| `SKILL_INVOKED` | Agent | Agent calls a skill (Research Web, Generate Code, etc.) |
| `TOOL_USED` | Agent | Sub-action within a skill |
| `ARTIFACT_CREATED` | Agent | Agent produces a deliverable |
| `APPROVAL_REQUESTED` | Agent | Mid-task approval needed |
| `APPROVAL_GRANTED` | Founder | Founder approves mid-task request |
| `ROUND_COMPLETED` | Agent | Agent marks work as done |
| `CEO_REVIEWING` | CEO | CEO begins evaluation |
| `CEO_SCORED` | CEO | CEO publishes scorecard |
| `FOUNDER_ACCEPTED` | Founder | Mission accepted |
| `FOUNDER_REJECTED` | Founder | Mission sent back with feedback |
| `MISSION_CANCELLED` | Founder | Mission permanently stopped |

---

## CEO Evaluation Prompt

When an agent completes a round, the CEO evaluates using a structured prompt. The evaluation prompt template (to be added to `CEO-Prompts.md`):

```
You are CEO {ceo_name} of {org_name}.

An agent has completed a task. Evaluate the results.

MISSION: {mission_title}
OBJECTIVE: {mission_description}
CONSTRAINTS: {constraints}
ASSIGNED AGENT: {agent_name} ({agent_role})
MODEL: {agent_model}

AGENT OUTPUT:
{result_summary}

DELIVERABLES:
{artifact_list}

TOKENS USED: {tokens}
COST: ${cost}
DURATION: {duration}

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

## Redo Prompt (fed to CEO on rejection)

When a mission is rejected and sent back:

```
MISSION REJECTED — ROUND {round_number}

The founder has reviewed and rejected this round's results.

ORIGINAL MISSION: {mission_title}
OBJECTIVE: {mission_description}

FOUNDER FEEDBACK:
"{rejection_reason}"

REDO STRATEGY: {INCLUDE_COLLATERAL | START_FRESH}

{if include_collateral}
PRIOR ROUND OUTPUT:
{previous_result_summary}

PRIOR DELIVERABLES:
{previous_artifact_list}

PRIOR CEO SCORE: {grade} — "{ceo_review}"
{/if}

{if start_fresh}
Note: The founder requested a fresh start. Do not reference prior work.
Only use the original objective and the founder's feedback above.
{/if}

Re-execute this mission addressing the founder's feedback.
This is Round {round_number + 1}.
```

---

## Kanban Board Updates

The existing `/missions` Kanban gets minor enhancements to support this system:

### Card Enhancements

```
┌─────────────────────────────────┐
│ Research Competitor Pricing      │  ← clickable → /missions/:id
│ SCOUT • HIGH • ⟳ R3            │  ← round badge if > 1
│ CEO: B+ • $1.11                │  ← latest score + cumulative cost
└─────────────────────────────────┘
```

### New Column: REVIEW

Insert between IN PROGRESS and DONE:

```
BACKLOG → IN PROGRESS → REVIEW → DONE
```

The REVIEW column holds missions in `ceo_review` or `founder_review` status. These have the CEO scorecard badge and are clickable to open the detail page.

### Status Colors

| Status | Column | Card Border |
|--------|--------|-------------|
| `backlog` | BACKLOG | zinc-700 |
| `in_progress` | IN PROGRESS | emerald-500 (pulse) |
| `ceo_review` | REVIEW | purple-500 |
| `founder_review` | REVIEW | yellow-500 (pulse) |
| `done` | DONE | emerald-500 |
| `cancelled` | (hidden or archive) | red-500 |

---

## Component Structure

```
src/components/Missions/
├── MissionsView.tsx          # Kanban board (existing, enhanced)
├── MissionCard.tsx           # Kanban card (extracted from MissionsView)
├── MissionDetailPage.tsx     # /missions/:id — full detail view
├── MissionScorecard.tsx      # CEO score bars + grade + review text
├── MissionResults.tsx        # Results tab — rendered markdown
├── MissionDeliverables.tsx   # Deliverables tab — file browser
├── MissionActivity.tsx       # Activity tab — filtered log
├── MissionRounds.tsx         # Rounds tab — history timeline
├── RejectMissionModal.tsx    # Rejection feedback + redo strategy
└── CancelMissionModal.tsx    # Cancel confirmation
```

### Route Addition

```tsx
<Route path="/missions" element={<MissionsView />} />
<Route path="/missions/:id" element={<MissionDetailPage />} />
```

---

## Scoring Aggregation

### Per-Round Stats

Each round tracks its own:
- Agent, model, tokens, cost, duration
- CEO scorecard (quality, completeness, efficiency, overall, grade)
- Result summary + deliverables
- Rejection reason + redo strategy (if rejected)

### Mission-Level Aggregates

The mission header shows cumulative totals:
- **Total Cost**: Sum of all rounds
- **Total Tokens**: Sum of all rounds
- **Total Duration**: Sum of all rounds
- **Current Score**: From the latest completed round
- **Round Count**: How many attempts

### Leaderboard / Stats (future)

Per-agent stats derived from mission rounds:
- Missions completed (accepted on first round)
- Average rounds to acceptance
- Average CEO score
- Total cost
- First-round acceptance rate (%)

These feed into the Dashboard "Employee Monitor" (Phase 6).

---

## Surveillance Integration

When a mission round starts/completes:
- Agent sprite status changes (`working` → `idle`)
- If accepted: agent briefly `celebrating`
- If rejected: agent returns to `working` (new round starting)

The surveillance "TODAY'S PRIORITIES" board shows active missions with round badges.

---

## Implementation Order

1. **DB schema** — Add columns to `missions`, create `mission_rounds`, `mission_artifacts`, `mission_activity` tables
2. **Mission CRUD** — Create/edit/delete missions from Kanban (prerequisite)
3. **MissionDetailPage** — Route + layout + stats cards + tabs
4. **Scorecard component** — Progress bars + grade badge
5. **Results tab** — Markdown rendering of agent output
6. **Accept flow** — Button + status update + audit
7. **Reject modal** — Feedback form + redo strategy + round increment
8. **Rounds tab** — Timeline of all attempts
9. **Activity tab** — Pre-filtered audit log
10. **Deliverables tab** — File browser + preview
11. **Kanban enhancements** — Round badge, score badge, REVIEW column
12. **CEO evaluation prompt** — Wire into CEO review step
13. **Redo prompt** — Wire rejection feedback into CEO re-delegation

Steps 1-8 can be built in demo mode with mock data. Steps 12-13 require the CEO autonomy engine (Phase 2).

---

## Theme Notes

The Mission Detail Page uses the **serious shell** aesthetic (dark mode, Inter font, slate/emerald palette) — consistent with Dashboard, Missions Kanban, and Financials. The CEO scorecard uses pixel-art progress bars with the retro color palette for grades, bridging both visual systems.

The reject modal uses the same CRT-glow treatment as the CEO Ceremony and Budget Editor — amber warning tones, pixel font headers, subtle scanlines.

Round badges on Kanban cards use `pixel-cyan` with the pixel font — small enough to not dominate but visible enough to flag multi-attempt missions.
