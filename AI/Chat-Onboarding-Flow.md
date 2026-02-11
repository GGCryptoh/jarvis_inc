# CEO Chat Onboarding Flow — Design Reference

> Committed project documentation. Defines the scripted on-rails conversation
> between CEO and Founder during the initial meeting in `/chat`.

---

## Overview

The CEO onboarding chat is a **scripted state machine** — not a live LLM conversation. It guides the founder through mission definition, skill enablement, and a test interaction. After completion, the chat transitions to `PostMeetingChat` (placeholder for future AI-powered conversations).

---

## State Machine

### ConvoStep Flow

```
welcome → waiting_input → acknowledging → waiting_skill_approve → waiting_test_input → testing_skill → done
```

### Step Details

| Step | What Happens | Input Enabled | Next Step |
|------|-------------|---------------|-----------|
| `welcome` | CEO types 2 messages: greeting + mission question | No | `waiting_input` |
| `waiting_input` | Founder types their mission/goal | Yes | `acknowledging` |
| `acknowledging` | CEO types acknowledgment + skill recommendations + approval card | No | `waiting_skill_approve` |
| `waiting_skill_approve` | Waiting for founder to click APPROVE or LATER (or approve on Approvals page) | No | `waiting_test_input` (approve) or `done` (skip) |
| `waiting_test_input` | CEO asks "want to test it?" — founder types a research query | Yes | `testing_skill` |
| `testing_skill` | CEO shows simulated research response + readiness message | No | `done` |
| `done` | Meeting finalized, CTA buttons shown (GO TO SURVEILLANCE, optionally GO TO APPROVALS) | No | N/A |

### Alternative Paths

- **Skill already enabled**: If Research Web is already on (from Skills page or previous attempt), skip approval card → go straight to `waiting_test_input`
- **LATER clicked**: Skip test → finalize meeting → show CTA
- **Approved on Approvals page**: Detected via `approvals-changed` event → auto-advance to test offer

---

## Message Types

### ChatMessage Interface

```typescript
interface ChatMessage {
  id: string;
  sender: 'ceo' | 'user' | 'system';
  text: string;
  approvalCard?: {          // Only on the skill suggestion message
    skillName: string;
    skillDescription: string;
    skillIcon: React.ElementType;
  };
}
```

### Message Rendering

- **CEO messages**: Left-aligned, dark bg, yellow "CEO {name}" label, zinc text
- **User messages**: Right-aligned, emerald bg/border, emerald text
- **Approval card**: Rendered inline below the CEO message text — yellow-bordered card with skill info + APPROVE / LATER buttons

---

## Approval Sync

### How It Works

1. When CEO suggests enabling Research Web, a `skill_enable` approval is created in the `approvals` table
2. The approval appears both:
   - **In chat**: Inline `SingleSkillApproval` card with APPROVE / LATER buttons
   - **On Approvals page**: Standard approval card with APPROVE / DISMISS buttons
3. Approving from **either** location resolves it everywhere

### Sync Mechanism

- **Chat → Approvals**: `updateApprovalStatus(id, 'approved')` + `window.dispatchEvent(new Event('approvals-changed'))`
- **Approvals → Chat**: ChatView listens for `approvals-changed` event. On fire, checks if the pending approval is still there. If not → auto-advances the conversation
- **Guard against duplicates**: `skillApprovedRef` prevents double-processing when both paths fire close together
- **Guard against stale closure**: `stepRef` (useRef) tracks current step for use inside event handlers

### Approval Metadata

```json
{
  "type": "skill_enable",
  "title": "Enable Skill: Research Web",
  "description": "CEO ATLAS recommends enabling \"Research Web\" — ...",
  "metadata": "{\"skillId\":\"research-web\",\"skillName\":\"Research Web\",\"model\":\"Claude Opus 4.6\"}"
}
```

### After Approval

If the enabled skill's service (e.g., Anthropic) has no API key in the vault, a separate `api_key_request` approval is created automatically. This doesn't block the test — the test is simulated.

---

## Simulated Research Test

After skill approval, the CEO offers a test. The founder types any query, and the CEO returns a **simulated** response:

```
Research results for "{query}":

Scanned 14 web sources in 2.8 seconds.

1. Multiple credible sources confirm strong activity in this area.
2. Recent developments in the last 30 days show growing momentum.
3. Three primary angles worth deeper investigation were identified.

I'd recommend assigning a dedicated research agent for a full deep-dive once the team is assembled.
```

This is hardcoded — no actual LLM call. The test demonstrates the flow of: founder asks → CEO/agent processes → results returned.

---

## LLM Status Badge

After the test completes (or if the skill was already enabled), the chat header shows:

```
[CEO ATLAS]  [ONLINE]                    [● LLM: ENABLED]
```

- Green pulsing dot (animate-pulse) + "LLM: ENABLED" in emerald pixel font
- Appears in both the active chat and the PostMeetingChat screen
- Derived from DB: checks if `research-web` skill is enabled in the `skills` table

---

## Meeting Finalization

`finalizeMeeting()` runs when the conversation reaches `done`:

1. `setSetting('ceo_meeting_done', 'true')` — prevents re-triggering onboarding
2. `setSetting('primary_mission', missionText)` — stores founder's mission
3. `saveMission(...)` — creates a mission with status='in_progress', assignee=CEO, priority='critical'

---

## PostMeetingChat

When the user returns to `/chat` after onboarding is complete (`meetingDone && messages.length === 0`):

- Shows the primary mission in a card
- "REAL-TIME CHAT WITH CEO COMING SOON" placeholder
- Disabled input
- LLM: ENABLED badge if applicable
- **Future**: Replace with `ActiveChat` component powered by live LLM conversations

---

## Edge Cases

| Scenario | Handling |
|----------|---------|
| Page reload during onboarding | Onboarding restarts (step state not persisted). Existing pending approval reused (not duplicated) |
| Skill already enabled | Skip approval card → go straight to test offer |
| Approval already exists | Reuse existing pending approval ID instead of creating new one |
| User navigates away during `waiting_skill_approve` | Approval stays in Approvals page. On return, event handler may auto-advance if approved |
| Both chat and Approvals page approve simultaneously | `skillApprovedRef` guard prevents double processing |

---

## Key Files

| File | Role |
|------|------|
| `src/components/Chat/ChatView.tsx` | Main component — state machine, messages, approval card |
| `src/lib/database.ts` | `saveApproval()`, `updateApprovalStatus()`, `saveSkill()`, `setSetting()` |
| `src/lib/skillRecommender.ts` | `recommendSkills(missionText)` — keyword matching to skill IDs |
| `src/data/skillDefinitions.ts` | 18 skill definitions with icons, categories, models |
| `src/components/Approvals/ApprovalsView.tsx` | Handles `skill_enable` type with APPROVE button |

---

## Future: Active Chat

The scripted onboarding will transition into a live AI chat when the backend is connected:

1. `PostMeetingChat` replaced with `ActiveChat` component
2. Messages persisted in `chat_messages` DB table (not React state)
3. CEO can proactively initiate conversations (see `AI/CEO-Communication-Loop.md`)
4. Rich action cards inline (hire recommendations, budget warnings, mission reports)
5. Supabase Realtime pushes new messages instantly
