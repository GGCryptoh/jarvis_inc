# Approval System — Design Reference

> Committed project documentation. Defines the approval lifecycle, types,
> cross-component synchronization, and rendering behavior.

---

## Overview

Approvals are the governance layer between autonomous AI actions and founder control. Any action that requires human oversight — enabling a skill, providing an API key, hiring an agent, or authorizing an agent's mid-task action — goes through the approval system.

---

## Approval Types

### Current (Implemented)

| Type | Title Pattern | Created By | Resolved By |
|------|--------------|------------|-------------|
| `api_key_request` | "API Key Required: {service}" | ChatView, SkillsView | ApprovalsView (provide key) |
| `skill_enable` | "Enable Skill: {name}" | ChatView (onboarding) | ChatView (inline) or ApprovalsView |

### Future (Planned)

| Type | Title Pattern | Created By | Resolved By |
|------|--------------|------------|-------------|
| `hire_agent` | "Hire Agent: {name} ({role})" | CEO Decision Engine | Chat (inline card) or ApprovalsView |
| `budget_override` | "Budget Override: {amount}" | CEO Decision Engine | ApprovalsView |
| `execute_skill` | "Execute: {skill} (${cost})" | CEO Decision Engine | ApprovalsView |
| `agent_action` | "Agent {name}: {action}" | Agent (mid-task) | ApprovalsView |

---

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS approvals (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,           -- 'api_key_request' | 'skill_enable' | 'hire_agent' | ...
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'dismissed'
  metadata    TEXT,                     -- JSON blob with type-specific data
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Metadata by Type

**api_key_request**:
```json
{ "service": "Anthropic", "skillId": "research-web", "model": "Claude Opus 4.6" }
```

**skill_enable**:
```json
{ "skillId": "research-web", "skillName": "Research Web", "model": "Claude Opus 4.6" }
```

**hire_agent** (future):
```json
{ "agentConfig": { "name": "SCOUT", "role": "Research Analyst", "model": "Claude Sonnet 4.5", "skills": ["research-web"] }, "reason": "3 unassigned research tasks" }
```

**agent_action** (future):
```json
{ "agent_id": "agent-123", "task_id": "mission-456", "action_description": "Send email to vendor@example.com" }
```

---

## Lifecycle

```
Created (pending) → Approved | Dismissed
```

- **Pending**: Visible in ApprovalsView, may have inline card in ChatView
- **Approved**: Side effects executed (skill enabled, key saved, agent hired, action authorized). Moves to history
- **Dismissed**: No side effects. Moves to history
- **No deletion**: Approvals are never deleted — they move to history for audit trail

### Side Effects on Approval

| Type | Side Effect |
|------|------------|
| `api_key_request` | `saveVaultEntry()` with the provided key |
| `skill_enable` | `saveSkill(id, true, model)` — enables the skill in DB |
| `hire_agent` | `saveAgent()` — creates agent, triggers hire ceremony |
| `agent_action` | Resume agent execution with approval injected into conversation |

---

## Cross-Component Sync

### Event: `approvals-changed`

All approval mutations dispatch this event:
```typescript
window.dispatchEvent(new Event('approvals-changed'));
```

### Listeners

| Component | Listens For | Action |
|-----------|-------------|--------|
| `NavigationRail` | `approvals-changed` | Refresh pending count badge |
| `ChatView` | `approvals-changed` | Check if `skill_enable` approval resolved → advance conversation |
| `ApprovalsView` | Internal — calls `refresh()` after mutations | Refresh pending + history lists |

### NavigationRail Badge

```typescript
// Polls on mount + listens for event
useEffect(() => {
  const update = () => setCount(getPendingApprovalCount());
  update();
  window.addEventListener('approvals-changed', update);
  return () => window.removeEventListener('approvals-changed', update);
}, []);
```

Shows amber badge with count next to the Approvals nav item.

---

## Rendering by Type

### ApprovalsView

**api_key_request cards**:
- Key icon header
- Service-specific instructions (from `SERVICE_KEY_HINTS`)
- Password input for API key
- PROVIDE KEY button (disabled until key >= 10 chars)
- DISMISS button

**skill_enable cards**:
- Blocks icon header
- Description text
- APPROVE button → `saveSkill()` + mark approved
- DISMISS button

### ChatView (Inline)

**SingleSkillApproval card** (only for `skill_enable` during onboarding):
- Yellow-bordered card inside CEO message
- Skill icon + name + description
- APPROVE / LATER buttons
- After approval: shows "ENABLED" badge, buttons hidden

---

## CRUD Functions

```typescript
// Load pending approvals only
loadApprovals(): ApprovalRow[]

// Load all (pending + history)
loadAllApprovals(): ApprovalRow[]

// Create new approval
saveApproval(approval: Omit<ApprovalRow, 'created_at'>): void

// Update status (approved | dismissed)
updateApprovalStatus(id: string, status: string): void

// Count pending (for badge)
getPendingApprovalCount(): number
```

---

## Key Files

| File | Role |
|------|------|
| `src/lib/database.ts` | Approvals CRUD (loadApprovals, saveApproval, updateApprovalStatus, etc.) |
| `src/components/Approvals/ApprovalsView.tsx` | Full approval management UI with type-specific rendering |
| `src/components/Chat/ChatView.tsx` | Creates `skill_enable` approvals, renders inline card, listens for changes |
| `src/components/Layout/NavigationRail.tsx` | Pending count badge |
| `src/lib/models.ts` | `SERVICE_KEY_HINTS` for api_key_request cards |

---

## Future: Supabase Realtime

In full mode (Supabase), the `approvals-changed` event will be replaced by Supabase Realtime subscriptions:

```typescript
supabase.channel('approvals')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'approvals' }, (payload) => {
    // Auto-refresh any component watching approvals
    window.dispatchEvent(new Event('approvals-changed')); // Bridge to existing listeners
  })
  .subscribe();
```

This enables cross-tab and cross-device approval sync — approve on your phone, see it update on desktop.
