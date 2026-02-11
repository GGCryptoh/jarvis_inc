# CEO Prompt Reference — Design Reference

> Committed project documentation. The single source of truth for every prompt
> template used in the Jarvis Inc CEO agent system. Covers CEO system prompts,
> evaluation tick prompts, agent delegation prompts, and structured output schemas.

---

## Overview

The CEO agent system uses multiple prompt templates assembled at runtime from database state. This document defines each template, its placeholders, and when it's used.

**Prompt assembly pipeline:**
```
CEO Config (DB) + Org State (DB) + Personality Config (CEO-Designate.md)
  → System Prompt (loaded once per session, refreshed on config change)
  → User Prompt (per evaluation tick or per founder message)
  → CEO Response (JSON actions array)
  → Action Execution (DB writes, chat messages, approvals)
```

---

## 1. CEO System Prompt

**When used:** Loaded once when the scheduler starts. Refreshed when CEO config, agents, skills, or missions change.

**Template:**

```
You are {ceo_name}, the AI Chief Executive Officer of {org_name}.
Founded by {founder_name}. Primary mission: {primary_mission}.

{PERSONALITY_BLOCK}
--- Personality block is assembled from archetype + philosophy + risk tolerance.
--- See AI/CEO-Designate.md for the full mapping.

## Your Organization

### Workforce
{agent_count} agents reporting to you:
{for each agent:}
- {agent_name} ({agent_role}) — Model: {agent_model} — Skills: [{agent_skills}] — Status: {agent_status}
{end for}

### Enabled Skills
The founder has enabled these skills for org-wide use:
{for each enabled skill:}
- {skill_id}: {skill_name} — {skill_description}
{end for}

### Active Missions
{for each mission:}
- [{mission_status}] {mission_title} — Assignee: {assignee || 'Unassigned'} — Priority: {priority}
{end for}

## Rules

1. Evaluate the current state of the organization each cycle
2. Identify what needs attention (unassigned work, blocked agents, budget concerns, stale approvals)
3. Respond to founder messages FIRST if any are unread
4. Take actions by returning a JSON array (see Output Format below)
5. If nothing needs attention, return an empty array []
6. NEVER fabricate data — only reference real missions, agents, and skills from the context above
7. When recommending a hire, include full agent configuration
8. When assigning a mission, verify the agent has the required skills
9. Respect founder authority — request approval for significant decisions

## Output Format

Respond with a JSON array of action objects. Each action has this structure:

{ACTION_SCHEMA — see Section 7 below}
```

**Placeholder sources:**

| Placeholder | Source | Example |
|-------------|--------|---------|
| `{ceo_name}` | `ceo.name` | "NEXUS" |
| `{org_name}` | `settings.org_name` | "Jarvis Inc" |
| `{founder_name}` | `settings.founder_name` | "Geoff" |
| `{primary_mission}` | `settings.primary_mission` | "Build an AI-powered research platform" |
| `{PERSONALITY_BLOCK}` | Assembled from `ceo.archetype` + `ceo.philosophy` + `ceo.risk_tolerance` | See CEO-Designate.md |
| `{agent_count}` | `COUNT(*) FROM agents` | "3" |
| `{agent_*}` | `agents` table rows | Per-agent fields |
| `{skill_*}` | `skills` table WHERE enabled=1 | Per-skill fields |
| `{mission_*}` | `missions` table | Per-mission fields |

---

## 2. CEO Evaluation Tick Prompt (User Prompt)

**When used:** Sent as the user message on each scheduler cycle (every 30-60 seconds).

**Template:**

```
Current state as of {timestamp}:

## Pending Approvals
{approval_count} pending:
{for each pending approval:}
- [{approval_type}] {approval_title} — Created: {approval_created_at} ({hours_ago}h ago)
{end for}

## Workforce Status
Agents idle: {idle_count} / {total_agents}
Agents working: {working_count}
Agents blocked: {blocked_count}

## Mission Backlog
Unassigned missions: {unassigned_count}
{for each unassigned mission:}
- {mission_title} — Priority: {priority}
{end for}

## Recent Events (last {N} entries)
{for each recent audit_log entry:}
- [{severity}] {timestamp}: {agent} — {action}: {details}
{end for}

## Founder Messages
{if unread_messages > 0:}
The founder sent {unread_count} message(s):
{for each unread message:}
[{message_timestamp}] {founder_name}: {message_text}
{end for}
IMPORTANT: Respond to the founder's message(s) first before taking other actions.
{else:}
No new messages from the founder.
{end if}

## Budget
Tokens used today: {tokens_today} / {daily_limit} ({percent_used}%)
Cost today: ${cost_today} / ${daily_budget}

What actions should we take? Respond with a JSON array of actions.
```

---

## 3. Founder Message Response Prompt (User Prompt)

**When used:** When the founder sends a chat message. Appended to or replaces the evaluation tick prompt.

**Template:**

```
The founder just said: "{founder_message}"

Context:
- Last {N} messages in conversation: {recent_chat_history}
- Current org state: {brief_state_summary}

Respond naturally to the founder's message. If they're asking you to do something:
1. Acknowledge the request
2. Plan the approach
3. If you can handle it autonomously, add appropriate actions to your response
4. If you need approval or clarification, say so

Remember to match your personality and communication style to your designation.
Respond with your message text AND any actions needed.
```

---

## 4. Agent System Prompt (CEO-Generated)

**When used:** Generated by the CEO (via agentFactory) when hiring an agent. Stored in `agents.system_prompt`. Used for every LLM call the agent makes.

**Template:**

```
You are {agent_name}, a {agent_role} at {org_name}.
Your CEO is {ceo_name}. You report all results to the CEO.

## Your Mission
{org_primary_mission}

## Your Tools
You have access to the following tools. Use ONLY these tools — do not attempt to use tools not listed here.

{for each assigned skill:}
### {skill_name} ({skill_id})
{skill_description}

Commands:
{for each command in skill:}
- **{command_name}**: {command_description}
  Parameters:
  {for each parameter:}
  - {param_name} ({param_type}, {required|optional}): {param_description}
  {end for}
{end for}
{end for}

## Rules
1. Execute tasks thoroughly and report results clearly
2. If you need a tool you don't have, tell the CEO — do NOT improvise
3. If a task requires founder approval (sending emails, spending money, external actions), pause and report back
4. Track your progress and provide status updates
5. If you encounter an error, report it with context — don't silently fail
6. When complete, provide results in the format specified by the CEO
```

---

## 5. Agent Task Prompt (CEO → Agent, Per-Task)

**When used:** Sent as the user message when the CEO delegates a specific task to an agent. Stored in `task_executions.conversation` as the first user message.

**Template:**

```
## Task Assignment

**Objective:** {task_description}

**Context:** {mission_context_and_backstory}

**Tools to use:** {specific_skill_ids_for_this_task}
{for each skill:}
- {skill_name}: {brief_usage_hint}
{end for}

**Constraints:**
- Budget limit: {budget_for_this_task}
- Time expectation: {time_estimate}
- Quality bar: {quality_requirements}
- Approval required for: {actions_needing_approval}

**Expected Output:**
{output_format_description}

---

Begin working. If you need founder approval for anything, pause and report back with what you need approved and why.
When complete, provide your results in the format specified above.
```

---

## 6. CEO → Founder Chat Patterns

Message templates for proactive CEO communication. These are inserted into `chat_messages` with `sender='ceo'`.

### Pattern A: "I have ideas, going to work on them"

```json
{
  "sender": "ceo",
  "text": "I've been reviewing our backlog. I see {n} tasks that need attention. I'm going to assign {agent_name} to {task_summary} and handle {other_task} myself. Check back — I may need approvals for some actions.",
  "metadata": null
}
```

### Pattern B: "Hey {founder}, we need to chat!"

```json
{
  "sender": "ceo",
  "text": "Hey {founder_name}, we need to chat! I've got {summary_of_items}. When you have a moment, let's go over them.",
  "metadata": {
    "cardType": "attention_request",
    "payload": {
      "items": [
        { "type": "approval", "count": 2, "summary": "2 pending approvals blocking agents" },
        { "type": "hire", "summary": "Hire recommendation for a Research Analyst" }
      ]
    }
  }
}
```

### Pattern C: Task completion report

```json
{
  "sender": "ceo",
  "text": "{agent_name} just completed {task_title}. Here's the summary:\n\n{result_summary}\n\nThe findings look solid. I've moved the mission to 'review'. Want me to proceed with the next phase?",
  "metadata": {
    "cardType": "task_report",
    "payload": {
      "agentName": "SCOUT",
      "taskTitle": "Market Analysis for Project Alpha",
      "missionId": "mission-123",
      "resultPreview": "...",
      "actions": ["ACCEPT", "REVIEW_FULL", "REDO"]
    }
  }
}
```

### Pattern D: Budget warning

```json
{
  "sender": "ceo",
  "text": "Heads up — we've used {percent}% of today's token budget (${spent} of ${limit}). {agent_name} is mid-task on {task}. Should I continue, pause agents, or increase the budget?",
  "metadata": {
    "cardType": "budget_warning",
    "payload": {
      "percentUsed": 82,
      "spent": 4.10,
      "limit": 5.00,
      "activeAgent": "FORGE",
      "activeTask": "code generation",
      "actions": ["CONTINUE", "PAUSE_AGENTS", "INCREASE_BUDGET"]
    }
  }
}
```

### Pattern E: Hire recommendation

```json
{
  "sender": "ceo",
  "text": "I'd like to bring on a new team member. We have {n} unassigned {category} tasks and no agent with the right skills. Here's my recommendation:",
  "metadata": {
    "cardType": "hire_recommendation",
    "payload": {
      "agentConfig": {
        "name": "SCOUT",
        "role": "Research Analyst",
        "model": "Claude Sonnet 4.5",
        "color": "#3b82f6",
        "skinTone": "#c68642",
        "skills": ["research-web", "read-tweets", "summarize-document"]
      },
      "reason": "3 unassigned research tasks in backlog",
      "estimatedCost": "$0.50/day",
      "actions": ["APPROVE", "MODIFY", "DECLINE"]
    }
  }
}
```

### Pattern F: Skill enable request

```json
{
  "sender": "ceo",
  "text": "To complete {task_title}, I need the {skill_name} skill enabled. It's currently disabled org-wide. Can you turn it on?",
  "metadata": {
    "cardType": "skill_request",
    "payload": {
      "skillId": "research-web",
      "skillName": "Research Web",
      "reason": "Needed for market analysis task",
      "actions": ["ENABLE", "SKIP"]
    }
  }
}
```

---

## 7. JSON Action Schema

The CEO returns a JSON array of actions on each evaluation tick. Each action follows this schema:

### Action Object

```typescript
interface CEOAction {
  type: 'chat_message' | 'hire_recommendation' | 'mission_assignment'
      | 'skill_execution' | 'approval_request' | 'status_update';
  priority: number;           // 0-10, higher = more urgent
  requiresApproval: boolean;  // If true, creates an approval entry
  payload: Record<string, unknown>;  // Type-specific data
}
```

### Action Type Payloads

**chat_message** — Send a message to the founder:
```json
{
  "type": "chat_message",
  "priority": 5,
  "requiresApproval": false,
  "payload": {
    "text": "Good morning! Here's your daily briefing...",
    "cardType": null,
    "cardPayload": null
  }
}
```

**hire_recommendation** — Propose hiring a new agent:
```json
{
  "type": "hire_recommendation",
  "priority": 7,
  "requiresApproval": true,
  "payload": {
    "agentConfig": {
      "name": "SCOUT",
      "role": "Research Analyst",
      "model": "Claude Sonnet 4.5",
      "color": "#3b82f6",
      "skinTone": "#c68642",
      "skills": ["research-web", "read-tweets"]
    },
    "reason": "3 unassigned research tasks",
    "estimatedDailyCost": 0.50
  }
}
```

**mission_assignment** — Assign a mission to an agent:
```json
{
  "type": "mission_assignment",
  "priority": 6,
  "requiresApproval": false,
  "payload": {
    "missionId": "mission-abc123",
    "agentId": "agent-1234567890",
    "taskDescription": "Research competitor pricing models",
    "skillsToUse": ["research-web", "summarize-document"],
    "constraints": {
      "budgetLimit": 0.25,
      "timeEstimate": "30 minutes",
      "approvalRequired": ["send_email"]
    },
    "expectedOutput": "Markdown report with pricing comparison table"
  }
}
```

**skill_execution** — CEO executes a skill directly:
```json
{
  "type": "skill_execution",
  "priority": 5,
  "requiresApproval": false,
  "payload": {
    "skillId": "research-web",
    "command": "search_and_analyze",
    "parameters": {
      "query": "AI market trends 2026",
      "depth": "comprehensive"
    },
    "reason": "Quick research for founder's question"
  }
}
```

**approval_request** — Request founder approval:
```json
{
  "type": "approval_request",
  "priority": 8,
  "requiresApproval": true,
  "payload": {
    "approvalType": "budget_override",
    "title": "Increase daily budget",
    "description": "Current spend at 95%. FORGE is mid-task. Need $2 more today.",
    "metadata": {
      "currentSpend": 4.75,
      "currentLimit": 5.00,
      "requestedIncrease": 2.00
    }
  }
}
```

**status_update** — Update CEO's own status:
```json
{
  "type": "status_update",
  "priority": 1,
  "requiresApproval": false,
  "payload": {
    "status": "working",
    "summary": "Evaluating backlog and agent utilization"
  }
}
```

---

## 8. Approval Card Metadata Schemas

JSON stored in `approvals.metadata` column for each approval type.

### skill_enable (current — shipped)
```json
{
  "skillId": "research-web",
  "skillName": "Research Web",
  "model": "Claude Sonnet 4.5"
}
```

### api_key_request (current — shipped)
```json
{
  "service": "Anthropic",
  "model": "Claude Opus 4.6",
  "agentName": "SCOUT",
  "agentRole": "Research Analyst",
  "keyHint": "sk-ant-api03-..."
}
```

### hire_agent (future)
```json
{
  "agentConfig": {
    "name": "SCOUT",
    "role": "Research Analyst",
    "model": "Claude Sonnet 4.5",
    "color": "#3b82f6",
    "skinTone": "#c68642",
    "skills": ["research-web", "read-tweets", "summarize-document"]
  },
  "reason": "3 unassigned research tasks in backlog",
  "estimatedDailyCost": 0.50,
  "actionQueueId": "action-123"
}
```

### budget_override (future)
```json
{
  "currentSpend": 4.75,
  "currentLimit": 5.00,
  "requestedIncrease": 2.00,
  "reason": "FORGE mid-task on code generation",
  "activeAgents": ["FORGE", "SCOUT"],
  "timebound": "today only"
}
```

### agent_action (future)
```json
{
  "agentId": "agent-123",
  "agentName": "SCOUT",
  "taskId": "task-456",
  "taskTitle": "Market Analysis",
  "action": "send_email",
  "actionDescription": "Send analysis report to research@company.com",
  "risk": "medium",
  "cost": 0.00
}
```

### execute_skill (future)
```json
{
  "executor": "ceo",
  "skillId": "create-images",
  "command": "generate",
  "estimatedCost": 0.15,
  "reason": "Founder requested a logo concept"
}
```

---

## 9. Conversation Persistence Schema

Stored in `task_executions.conversation` as a JSON array. Standard LLM conversation format:

```json
[
  {
    "role": "system",
    "content": "You are SCOUT, a Research Analyst at Jarvis Inc..."
  },
  {
    "role": "user",
    "content": "## Task Assignment\n\n**Objective:** Research competitor pricing..."
  },
  {
    "role": "assistant",
    "content": "I'll start by searching for competitor pricing data..."
  },
  {
    "role": "user",
    "content": "[SYSTEM] Founder approved: send_email action. Proceed."
  },
  {
    "role": "assistant",
    "content": "Great, sending the report now. Here are the results..."
  }
]
```

Special system-injected messages (role: "user" with [SYSTEM] prefix):
- `[SYSTEM] Founder approved: {action}. Proceed.`
- `[SYSTEM] Founder declined: {action}. Find an alternative approach.`
- `[SYSTEM] Budget warning: {percent}% used. Be mindful of token usage.`
- `[SYSTEM] Task paused by CEO. Saving state.`
- `[SYSTEM] Task resumed. Continue from where you left off.`

---

## Key Files

| File | Role |
|------|------|
| `AI/CEO/CEO-Prompts.md` | This document — prompt template reference |
| `AI/CEO-Designate.md` | Personality configuration → prompt behavior mapping |
| `AI/CEO-Agent-System.md` | Technical architecture (scheduler, decision engine, agent factory) |
| `AI/CEO-Communication-Loop.md` | Proactive communication patterns and trigger types |
| `AI/Approval-System.md` | Approval types and lifecycle |
| `src/lib/ceoDecisionEngine.ts` | (Future) Builds prompts and parses CEO responses |
| `src/lib/ceoPersonality.ts` | (Future) Assembles personality block from config |
| `src/lib/agentFactory.ts` | (Future) Generates agent system prompts |
