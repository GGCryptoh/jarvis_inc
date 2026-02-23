# Telegram Approval System — Design Document

## Goal

Enable Jarvis Inc founders to approve/dismiss pending approvals directly from Telegram using inline keyboard buttons, without needing to be at the dashboard. The CEO sends approval notifications to Telegram and polls for responses.

## Architecture

When an approval is created (skill_enable, api_key_request, budget_override, forum_post), the system checks if a Telegram notification channel is configured and enabled. If so, it sends a message to the configured Telegram chat with inline keyboard buttons (APPROVE / DISMISS). A polling sidecar in the CEO decision engine checks for callback_query responses and resolves approvals accordingly, syncing state back to the dashboard in real-time.

## Tech Stack

- Telegram Bot API (inline keyboards, callback_query, getUpdates with offset)
- Existing `telegram-bot` skill (gateway handlers: send_message, get_updates)
- Supabase `approvals` table + `notification_channels` table
- CEO decision engine sidecar (polling at ~60s cadence)

---

## Component Design

### 1. Skill Schema Extension — `options[]`

**File:** `skills_repo/schema/skill.schema.json`

Add optional `options` array to skill definitions for portable per-skill configuration:

```json
"options": {
  "type": "array",
  "items": {
    "type": "object",
    "required": ["key", "label", "type"],
    "properties": {
      "key": { "type": "string" },
      "label": { "type": "string" },
      "type": { "enum": ["boolean", "string", "number", "select"] },
      "default": {},
      "choices": { "type": "array", "items": { "type": "string" } },
      "description": { "type": "string" }
    }
  }
}
```

**File:** `skills_repo/Official/communication/telegram-bot/skill.json`

Add options to the Telegram skill:

```json
"options": [
  {
    "key": "approval_notifications",
    "label": "Send approval requests via Telegram",
    "type": "boolean",
    "default": true,
    "description": "Route pending approvals to Telegram with inline APPROVE/DISMISS buttons"
  },
  {
    "key": "ceo_alerts",
    "label": "CEO alerts via Telegram",
    "type": "boolean",
    "default": false,
    "description": "Send CEO proactive messages (stale approvals, update available) to Telegram"
  }
]
```

**Storage:** Skill options stored in `skills` table as `options_config` JSONB column (new), keyed by option key. Example: `{ "approval_notifications": true, "ceo_alerts": false }`.

### 2. Telegram Approval Outbound

**Trigger:** After `saveApproval()` is called anywhere in the codebase.

**New function:** `notifyTelegramApproval(approval: ApprovalRow)` in `src/lib/telegramApprovals.ts`

**Flow:**
1. Check if Telegram channel exists + enabled: `loadChannels()` → find `type === 'telegram'` + `enabled === true`
2. Check if `approval_notifications` option is on for the telegram-bot skill
3. Build message text with approval details (type, title, description)
4. Build inline keyboard: `reply_markup: { inline_keyboard: [[{ text: "APPROVE", callback_data: "approve:<approval_id>" }, { text: "DISMISS", callback_data: "dismiss:<approval_id>" }]] }`
5. Call gateway `telegram-bot:send_message` with extended params (chat_id from channel config, text, reply_markup)
6. Store the Telegram message_id in `approval.metadata.telegram_message_id` for later cleanup/editing

**Message format:**
```
APPROVAL REQUEST

Type: skill_enable
Title: Enable Research Web
Description: CEO recommends enabling Research Web for your primary mission

[APPROVE]  [DISMISS]
```

### 3. Gateway Handler Extension

**File:** `skills_repo/Official/communication/telegram-bot/handlers/send_message.ts`

Extend the `send_message` handler to accept optional `reply_markup` and `parse_mode` parameters. The Telegram Bot API accepts these natively:

```typescript
const body: Record<string, unknown> = {
  chat_id: params.chat_id,
  text: params.text,
};
if (params.parse_mode) body.parse_mode = params.parse_mode;
if (params.reply_markup) body.reply_markup = JSON.parse(params.reply_markup);

const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
```

**File:** `skills_repo/Official/communication/telegram-bot/handlers/get_updates.ts`

Extend to accept `offset` parameter and `allowed_updates` filter:

```typescript
const body: Record<string, unknown> = {
  limit: params.limit ?? 10,
  allowed_updates: ['callback_query'],
};
if (params.offset) body.offset = params.offset;
```

### 4. Telegram Polling Sidecar

**File:** `src/lib/ceoDecisionEngine.ts` — new function `checkTelegramApprovals()`

**Cadence:** Every 60 seconds (separate from the main evaluateCycle cadence). Uses a settings key `telegram_last_update_id` to track the getUpdates offset (Telegram returns updates once, then marks them as read with offset).

**Flow:**
1. Check if Telegram channel configured + enabled + `approval_notifications` option on
2. Read `telegram_last_update_id` from settings
3. Call `telegram-bot:get_updates` with `offset` and `allowed_updates: ['callback_query']`
4. For each `callback_query`:
   a. Parse `callback_data` → `action:approval_id` (e.g., `approve:appr-123456`)
   b. Look up approval in DB — skip if not `pending`
   c. Call `updateApprovalStatus(id, action === 'approve' ? 'approved' : 'dismissed')`
   d. Answer the callback query (Telegram API: `answerCallbackQuery`) to remove the loading spinner
   e. Edit the original message to show resolution: "APPROVED by Founder via Telegram" or "DISMISSED"
   f. Dispatch `approvals-changed` event
   g. Log to audit: `TELEGRAM_APPROVAL` action
5. Update `telegram_last_update_id` to highest update_id + 1

**Error handling:** If Telegram API is unreachable, log warning and skip — approvals still work via dashboard.

### 5. Skills Table Migration

**File:** `docker/supabase/migrations/` — new migration

Add `options_config` JSONB column to `skills` table:

```sql
ALTER TABLE skills ADD COLUMN IF NOT EXISTS options_config JSONB DEFAULT '{}';
```

### 6. SkillsView Config UI

**File:** `src/components/Skills/SkillsView.tsx`

When a skill definition has `options[]`, render a settings gear icon on the skill card. Clicking opens a popover with toggle switches for boolean options, text inputs for string options, and dropdowns for select options.

**For Telegram specifically:**
- Gear icon appears on Telegram Bot skill card
- Popover shows two toggles: "Approval notifications" and "CEO alerts"
- Changes saved to `skills.options_config` via `saveSkill()` (extended to accept options)

### 7. Cross-Component Sync

After Telegram-based approval resolution:
1. `updateApprovalStatus()` updates DB
2. `window.dispatchEvent(new Event('approvals-changed'))` syncs NavigationRail badge + ApprovalsView
3. Edit original Telegram message to show "RESOLVED" (prevents double-tap)
4. Audit log entry: `TELEGRAM_APPROVAL` with details

### 8. Approval Hook Point

**File:** `src/lib/database.ts`

After `saveApproval()`, add a fire-and-forget notification dispatch:

```typescript
export async function saveApproval(approval: Omit<ApprovalRow, 'created_at'>): Promise<void> {
  await getSupabase().from('approvals').insert({ ... });

  // Fire-and-forget: notify Telegram if configured
  import('./telegramApprovals').then(({ notifyTelegramApproval }) => {
    notifyTelegramApproval(approval as ApprovalRow).catch(() => {});
  }).catch(() => {});
}
```

---

## Data Flow Diagram

```
Approval Created (anywhere in codebase)
    │
    ▼
saveApproval() ──fire-and-forget──► notifyTelegramApproval()
    │                                    │
    ▼                                    ▼
DB: approvals table              Check Telegram channel enabled?
    │                                    │ yes
    ▼                                    ▼
ApprovalsView renders            telegram-bot:send_message
(dashboard, badge count)         (inline keyboard: APPROVE / DISMISS)
                                         │
                                         ▼
                                 User taps button on phone
                                         │
                                         ▼
                            Telegram stores callback_query
                                         │
                                         ▼
                            checkTelegramApprovals() (60s poll)
                                         │
                                         ▼
                            Parse callback_data → approval_id
                                         │
                            ┌─────────────┴─────────────┐
                            ▼                           ▼
                    updateApprovalStatus()     answerCallbackQuery()
                    dispatch 'approvals-changed'  editMessageText()
                    logAudit('TELEGRAM_APPROVAL')
```

---

## Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/lib/telegramApprovals.ts` | Outbound notification + callback processing |
| Modify | `src/lib/database.ts` | Hook notifyTelegramApproval after saveApproval |
| Modify | `src/lib/ceoDecisionEngine.ts` | Add checkTelegramApprovals() sidecar |
| Modify | `src/components/Skills/SkillsView.tsx` | Options config UI (gear icon + popover) |
| Modify | `skills_repo/schema/skill.schema.json` | Add `options` to schema |
| Modify | `skills_repo/Official/communication/telegram-bot/skill.json` | Add options array |
| Modify | `skills_repo/Official/communication/telegram-bot/handlers/send_message.ts` | Support reply_markup + parse_mode |
| Modify | `skills_repo/Official/communication/telegram-bot/handlers/get_updates.ts` | Support offset + allowed_updates |
| Create | `docker/supabase/migrations/XXX_skill_options.sql` | Add options_config column |

---

## Edge Cases

- **Telegram unreachable**: Approvals still work via dashboard — Telegram is supplementary
- **Double-tap**: Edit original message after resolution so buttons become inert
- **Stale callback**: If approval already resolved (via dashboard), ignore callback + tell user "Already resolved"
- **Multiple Telegram chats**: Support array of chat_ids in channel config (future)
- **API key approval**: For `api_key_request` type, APPROVE button resolves approval; user still needs to enter the key via dashboard or vault
- **Bot not started**: If user hasn't started the bot (`/start`), sendMessage fails — log warning, skip

## Security

- Bot token stored in `notification_channels.config` (DB, not exposed to frontend)
- callback_data is structured (`approve:<id>`) — validate format before processing
- Only process callbacks for approvals that exist and are `pending`
- No sensitive data in Telegram messages (don't include API keys, just approval type + title)
