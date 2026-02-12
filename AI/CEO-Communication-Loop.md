# CEO Communication Loop — Design Reference

> Committed project documentation. Defines how the CEO proactively detects events,
> initiates conversations with the founder, and drives mission execution through
> an ongoing cycle of evaluation, communication, and follow-up.

### Implementation Status (2026-02-12)
- **Shipped**: Chat persistence (`conversations` + `chat_messages` tables), sidebar, onboarding state machine, LLM streaming with 5 providers, scripted fallback
- **Not yet built**: Proactive evaluation loop (heartbeat), CEO-initiated conversations, background processing, action cards in chat
- **Prerequisite**: CEO scheduler (Phase 2) — this doc describes the loop that runs inside the scheduler tick

---

## Overview

The CEO is not a passive chatbot waiting for input. It's an **autonomous agent** that:
- Detects when something needs attention (task complete, agent blocked, mission stale)
- Proactively initiates conversations ("Hey {FOUNDER}, we need to chat!")
- Works on ideas in the background ("I have some ideas, I'm going to work on them")
- Follows up after approvals, task completions, and milestone events

This loop runs continuously — either via browser-side polling (demo mode) or Supabase Edge Function + pg_cron (full mode).

---

## The Loop

```
┌──────────────────────────────────────────────────────┐
│                  CEO HEARTBEAT TICK                    │
│  (every 30-60 seconds, demo: setInterval, full: cron) │
└──────────────┬───────────────────────────────────────┘
               │
        ┌──────▼──────┐
        │  LOAD STATE  │  ← missions, agents, skills, approvals, vault, chat history
        └──────┬──────┘
               │
        ┌──────▼──────┐
        │  EVALUATE    │  ← What changed? What needs attention?
        └──────┬──────┘
               │
        ┌──────▼──────┐     ┌─────────────────────┐
        │  DECIDE      │────→│ No action needed     │ → sleep until next tick
        └──────┬──────┘     └─────────────────────┘
               │
        ┌──────▼──────┐
        │  ACT         │  ← Create chat messages, approvals, action queue entries
        └──────┬──────┘
               │
        ┌──────▼──────┐
        │  NOTIFY      │  ← Dispatch events → UI updates
        └─────────────┘
```

---

## Trigger Types

### What the CEO Evaluates Each Tick

| Trigger | Detection | CEO Response |
|---------|-----------|-------------|
| **Founder sent a chat message** | New row in `chat_messages` from sender='user' | Parse intent, plan work, respond |
| **Task completed by agent** | `task_executions.status = 'completed'` since last tick | Review results, update mission, report to founder |
| **Agent waiting for approval** | `task_executions.status = 'waiting_approval'` | Remind founder, or escalate if stale |
| **Approval resolved** | `approvals.status` changed from 'pending' | Resume blocked agent, or acknowledge |
| **Unassigned missions in backlog** | `missions` with status='backlog', no assignee | Assign to idle agent, or recommend hire |
| **All agents busy, work piling up** | Agent utilization > 80%, backlog growing | Recommend hiring |
| **Missing skill for a task** | Mission keywords match disabled skill | Ask founder to enable it |
| **Budget threshold reached** | Token spend approaching daily/monthly limit | Warn founder, request override |
| **Stale pending approvals** | Approvals pending > N hours | Nudge founder |
| **No activity for extended period** | No changes in any table for > N minutes | Check in, suggest next steps |

---

## Proactive Communication Patterns

### 1. "I have ideas, going to work on them"

When the CEO evaluates state and finds actionable items that don't need approval:

```
CEO: "I've been reviewing our backlog. I see 3 research tasks that need attention.
I'm going to assign SCOUT to the market analysis and handle the competitor review
myself. Check back — I may need approvals for some actions."
```

Actions:
- Assign agent to mission (`mission.assignee = agent.id`)
- Create `task_executions` entry
- Update agent status to 'working' (reflected in surveillance)
- Log to audit

### 2. "Hey {FOUNDER}, we need to chat!"

When something requires founder input:

```
CEO: "Hey ATLAS, we need to chat! I've got a hire recommendation and two pending
approvals that are blocking our agents. When you have a moment, let's go over them."
```

Implementation:
1. Insert `chat_messages` row with type='attention_request'
2. Dispatch `ceo-wants-to-chat` event
3. NavigationRail shows badge on Chat tab
4. If founder is on another page, a subtle notification appears
5. Clicking navigates to `/chat` where the CEO's messages are waiting

### 3. "Task complete — here's what happened"

After an agent finishes work:

```
CEO: "SCOUT just completed the market analysis for Project Alpha. Here's the summary:
[embedded result card]
The findings look solid. I've moved the mission to 'review'. Want me to proceed
with the next phase, or would you like to review the full report first?"
```

### 4. "We're running low on budget"

```
CEO: "Heads up — we've used 82% of today's token budget ($4.10 of $5.00).
FORGE is mid-task on the code generation. Should I:
[CONTINUE] [PAUSE AGENTS] [INCREASE BUDGET]"
```

---

## Chat Message Persistence

### Current: React State Only

During onboarding, messages live in `useState` — lost on page reload. This is by design for the scripted flow.

### Future: Database-Backed

```typescript
// src/hooks/useChatMessages.ts
function useChatMessages() {
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);

  // Load from DB on mount
  useEffect(() => {
    setMessages(loadChatMessages());
  }, []);

  // Listen for new messages (from CEO scheduler or Realtime)
  useEffect(() => {
    const handler = () => setMessages(loadChatMessages());
    window.addEventListener('chat-message-added', handler);
    return () => window.removeEventListener('chat-message-added', handler);
  }, []);

  function addMessage(msg: Omit<ChatMessageRow, 'created_at'>) {
    saveChatMessage(msg);
    window.dispatchEvent(new Event('chat-message-added'));
  }

  return { messages, addMessage, unreadCount: /* count since last read */ };
}
```

---

## Action Cards in Chat

Rich inline content beyond plain text:

| Card Type | Content | Buttons |
|-----------|---------|---------|
| **Hire Recommendation** | Agent preview (name, role, model, skills, cost estimate) | APPROVE / MODIFY / DECLINE |
| **Skill Enable Request** | Skill icon, name, description | APPROVE / LATER |
| **Budget Warning** | Current spend vs limit, which agents are active | CONTINUE / PAUSE / INCREASE |
| **Task Report** | Agent name, task summary, result preview | ACCEPT / REVIEW FULL / REDO |
| **Mission Update** | Mission title, status change, next steps | ACKNOWLEDGE |
| **Attention Request** | Brief summary of pending items | GO TO APPROVALS / DISMISS |

### Rendering

Action cards are stored in `chat_messages.metadata` as JSON:
```json
{
  "cardType": "hire_recommendation",
  "payload": {
    "agentConfig": { "name": "SCOUT", "role": "Research Analyst", ... },
    "reason": "3 unassigned research tasks in backlog"
  }
}
```

The `ChatView` component matches `cardType` to a React component for inline rendering.

---

## Notification System

### Navigation Badge

```typescript
// NavigationRail listens for unread chat messages
const [chatBadge, setChatBadge] = useState(0);

useEffect(() => {
  const update = () => setChatBadge(getUnreadChatCount());
  window.addEventListener('ceo-wants-to-chat', update);
  window.addEventListener('chat-message-added', update);
  return () => { /* cleanup */ };
}, []);
```

### CEO Status Pip

NavigationRail already shows a CEO status dot. Enhanced states:

| State | Color | Meaning |
|-------|-------|---------|
| Nominal | Green | CEO is idle, no pending work |
| Working | Amber pulse | CEO is evaluating or executing |
| Wants to chat | Red pulse | CEO has something to discuss |
| Offline | Gray | Scheduler not running |

---

## Demo Mode vs Full Mode

### Demo Mode (sql.js)

- **Scheduler**: `setInterval` with Visibility API (Option B)
- **Detection**: Direct DB reads on each tick
- **Notifications**: `window.dispatchEvent()` custom events
- **Limitations**: Only runs when tab is open, no cross-tab sync

### Full Mode (Supabase)

- **Scheduler**: Edge Function + pg_cron (Option E)
- **Detection**: Direct Postgres queries in Edge Function
- **Notifications**: Supabase Realtime subscriptions push to all connected clients
- **Advantages**: Runs even when browser is closed, cross-tab, cross-device

---

## The Full CEO Prompt Strategy

### System Prompt (Loaded Once, Refreshed on Config Change)

```
You are {ceo_name}, the AI Chief Executive Officer of {org_name}.
Founded by {founder_name}.

Your management philosophy: {philosophy}
Your risk tolerance: {risk_tolerance}

Available org skills (enabled by founder): {enabled_skill_list}
Current agents: {agent_list_with_roles_and_skills}
Current missions: {mission_list_with_statuses}

Your job is to:
1. Evaluate the current state of the organization
2. Identify what needs attention
3. Decide on actions (assign tasks, recommend hires, request skills, communicate)
4. Communicate clearly with the founder
5. Manage and direct your agents effectively

Output format: JSON array of actions (see schema below)
```

### User Prompt (Per Evaluation Tick)

```
Current state as of {timestamp}:

Pending approvals: {count} ({list if any})
Agents idle: {count} / {total}
Missions in backlog: {count}
Recent events: {last N audit log entries}
Unread founder messages: {messages if any}
Budget used today: {amount} / {limit}

What actions should we take? Respond with a JSON array of actions.
If the founder sent a message, respond to it first.
If nothing needs attention, respond with an empty array.
```

### User Prompt (Per Task Delegation to Agent)

```
Task: {task_description}
Assigned to: {agent_name} ({agent_role})
Context: {relevant_mission_context}
Tools available: {assigned_skill_ids_with_descriptions}
Constraints: {budget_limit, time_limit, approval_requirements}
Expected output: {output_format}

If you need founder approval for anything, pause and report back.
When complete, provide results in the specified format.
```

---

## Implementation Sequence

1. **Phase 1**: `chat_messages` table + `useChatMessages` hook (persistent messages)
2. **Phase 2**: CEO scheduler (demo: Option B with visibility API)
3. **Phase 3**: Decision engine (`evaluateCycle()`) — reads state, produces actions
4. **Phase 4**: Chat integration — action cards, badges, navigation triggers
5. **Phase 5**: Agent task execution — `task_executions`, persistent conversation, resume
6. **Phase 6**: Supabase migration — Edge Function, Realtime subscriptions

---

## Key Files

| File | Role |
|------|------|
| `AI/CEO-Agent-System.md` | Full technical architecture (scheduler options, decision engine, personality) |
| `AI/Chat-Onboarding-Flow.md` | Scripted onboarding conversation (current implementation) |
| `AI/Approval-System.md` | Approval types and lifecycle |
| `src/lib/ceoScheduler.ts` | (Future) Scheduler class |
| `src/lib/ceoDecisionEngine.ts` | (Future) CEO brain — state evaluation → action production |
| `src/hooks/useChatMessages.ts` | (Future) Persistent chat hook |
| `src/components/Chat/ChatView.tsx` | Current chat UI (onboarding + future active chat) |
