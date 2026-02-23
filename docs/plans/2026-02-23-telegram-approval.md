# Telegram Approval System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow founders to approve/dismiss pending approvals directly from Telegram using inline keyboard buttons, with a polling sidecar in the CEO decision engine.

**Architecture:** When an approval is created, the system sends a Telegram message with inline keyboard buttons (APPROVE/DISMISS) via the existing telegram-bot skill. A polling sidecar in ceoDecisionEngine checks for button-press callbacks every ~60s and resolves approvals accordingly. Skill schema extended with `options[]` for portable per-skill configuration.

**Tech Stack:** Telegram Bot API (inline keyboards, callback_query), existing gateway handlers, Supabase (approvals + notification_channels + skills tables)

**Design doc:** `docs/plans/2026-02-23-telegram-approval-design.md`

---

### Task 1: Extend Gateway send_message Handler

Support `reply_markup` and `parse_mode` parameters so we can send inline keyboard buttons.

**Files:**
- Modify: `skills_repo/Official/communication/telegram-bot/handlers/send_message.ts`

**Step 1: Update send_message.ts to accept reply_markup and parse_mode**

Replace the entire file content:

```typescript
export default async function(params: Record<string, unknown>): Promise<{ result: string }> {
  const botToken = params._apiKey as string;
  if (!botToken) return { result: 'Error: No Telegram bot token — add it in the Vault' };

  const chatId = params.chat_id as string;
  const text = params.text as string;
  if (!chatId || !text) return { result: 'Error: chat_id and text are required' };

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: (params.parse_mode as string) ?? 'Markdown',
  };

  // Support inline keyboard buttons (reply_markup as JSON string or object)
  if (params.reply_markup) {
    body.reply_markup = typeof params.reply_markup === 'string'
      ? JSON.parse(params.reply_markup)
      : params.reply_markup;
  }

  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!data.ok) return { result: `Telegram API error: ${data.description ?? 'Unknown error'}` };

  return { result: JSON.stringify({ message_id: data.result?.message_id, chat_id: chatId, ok: true }) };
}
```

**Step 2: Verify the handler compiles**

Run: `npx tsc --noEmit skills_repo/Official/communication/telegram-bot/handlers/send_message.ts 2>&1 || echo "Gateway handlers aren't type-checked locally — manual review OK"`

**Step 3: Commit**

```bash
git add skills_repo/Official/communication/telegram-bot/handlers/send_message.ts
git commit -m "feat(telegram): extend send_message with reply_markup + parse_mode support"
```

---

### Task 2: Extend Gateway get_updates Handler

Support `offset` parameter and `callback_query` filtering for polling approval responses.

**Files:**
- Modify: `skills_repo/Official/communication/telegram-bot/handlers/get_updates.ts`

**Step 1: Update get_updates.ts to accept offset and return callback_queries**

Replace the entire file content:

```typescript
export default async function(params: Record<string, unknown>): Promise<{ result: string }> {
  const botToken = params._apiKey as string;
  if (!botToken) return { result: 'Error: No Telegram bot token — add it in the Vault' };

  const limit = (params.limit as number) || 10;
  const offset = params.offset as number | undefined;
  const allowedUpdates = params.allowed_updates as string[] | undefined;

  const body: Record<string, unknown> = { limit, timeout: 0 };
  if (offset) body.offset = offset;
  if (allowedUpdates) body.allowed_updates = allowedUpdates;

  const resp = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();

  if (!data.ok) return { result: `Telegram API error: ${data.description ?? 'Unknown error'}` };

  // Return raw JSON for programmatic consumption (callback polling, etc.)
  return { result: JSON.stringify(data.result ?? []) };
}
```

**Step 2: Update skill.json to document new parameters**

In `skills_repo/Official/communication/telegram-bot/skill.json`, update the `send_message` and `get_updates` commands to include the new parameters:

```json
{
  "id": "telegram-bot",
  "title": "Telegram Bot",
  "description": "Send and receive messages via Telegram Bot API",
  "version": "0.3.0",
  "author": "Jarvis Inc",
  "category": "communication",
  "icon": "MessageCircle",
  "tags": ["telegram", "messaging", "bot", "chat", "notification"],
  "status": "available",
  "connection_type": "channel",
  "models": null,
  "default_model": null,
  "fixed_service": null,
  "service_type": "channel",
  "channel_type": "telegram",
  "oauth_config": null,
  "api_config": {
    "base_url": "https://api.telegram.org",
    "vault_service": "none"
  },
  "execution_handler": null,
  "output_type": "text",
  "collateral": false,
  "handler_runtime": "typescript",
  "files": ["handlers/send_message.ts", "handlers/get_updates.ts"],
  "options": [
    {
      "key": "approval_notifications",
      "label": "Send approvals via Telegram",
      "type": "boolean",
      "default": true,
      "description": "Route pending approvals to Telegram with inline APPROVE/DISMISS buttons"
    },
    {
      "key": "ceo_alerts",
      "label": "CEO alerts via Telegram",
      "type": "boolean",
      "default": false,
      "description": "Send CEO proactive messages to Telegram"
    }
  ],
  "commands": [
    {
      "name": "send_message",
      "description": "Send a message to a Telegram chat",
      "handler_file": "handlers/send_message.ts",
      "parameters": [
        { "name": "chat_id", "type": "string", "required": true, "description": "Telegram chat ID to send to" },
        { "name": "text", "type": "string", "required": true, "description": "Message text to send (supports Markdown)" },
        { "name": "parse_mode", "type": "string", "required": false, "description": "Parse mode: Markdown or HTML", "default": "Markdown" },
        { "name": "reply_markup", "type": "string", "required": false, "description": "JSON string of inline keyboard markup for buttons" }
      ],
      "returns": { "type": "object", "description": "JSON with message_id, chat_id, ok" }
    },
    {
      "name": "get_updates",
      "description": "Get recent updates (messages, callback queries) sent to the bot",
      "handler_file": "handlers/get_updates.ts",
      "parameters": [
        { "name": "limit", "type": "number", "required": false, "description": "Max number of updates to return", "default": 10 },
        { "name": "offset", "type": "number", "required": false, "description": "Identifier of the first update to be returned (for pagination)" },
        { "name": "allowed_updates", "type": "array", "required": false, "description": "List of update types to receive (e.g. ['callback_query'])" }
      ],
      "returns": { "type": "object", "description": "JSON array of Telegram Update objects" }
    }
  ]
}
```

**Step 3: Update manifest checksum**

Run:
```bash
shasum -a 256 skills_repo/Official/communication/telegram-bot/skill.json
```
Then update the checksum in `skills_repo/manifest.json` for the telegram-bot entry. Also bump version and updated_at in the manifest.

**Step 4: Commit**

```bash
cd skills_repo && git add . && git commit -m "feat(telegram-bot): v0.3.0 — reply_markup, offset, options[]"
cd .. && git add skills_repo && git commit -m "feat: update skills_repo submodule — telegram-bot v0.3.0"
```

---

### Task 3: Add options_config Column to Skills Table

**Files:**
- Create: `docker/supabase/migrations/005_skill_options.sql`
- Modify: `src/lib/database.ts:695-704` — extend `saveSkill()` to accept options_config

**Step 1: Create migration**

Create `docker/supabase/migrations/005_skill_options.sql`:

```sql
-- Add options_config JSONB column to skills table for per-skill option storage
ALTER TABLE skills ADD COLUMN IF NOT EXISTS options_config JSONB DEFAULT '{}';
```

**Step 2: Run migration against local Supabase**

Run:
```bash
PGPASSWORD=$(grep POSTGRES_PASSWORD docker/.env | cut -d= -f2) docker compose -f docker/docker-compose.yml exec -T supabase-db psql -U supabase_admin -d postgres -c "ALTER TABLE skills ADD COLUMN IF NOT EXISTS options_config JSONB DEFAULT '{}';"
```
Expected: `ALTER TABLE` (success)

**Step 3: Extend saveSkill() to handle options_config**

In `src/lib/database.ts`, add a new function after `saveSkill()`:

```typescript
export async function saveSkillOptions(id: string, optionsConfig: Record<string, unknown>): Promise<void> {
  await getSupabase()
    .from('skills')
    .update({ options_config: optionsConfig, updated_at: new Date().toISOString() })
    .eq('id', id);
}

export async function getSkillOptions(id: string): Promise<Record<string, unknown>> {
  const { data } = await getSupabase()
    .from('skills')
    .select('options_config')
    .eq('id', id)
    .single();
  return (data?.options_config as Record<string, unknown>) ?? {};
}
```

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean (no errors)

**Step 5: Commit**

```bash
git add docker/supabase/migrations/005_skill_options.sql src/lib/database.ts
git commit -m "feat: add options_config JSONB column to skills table"
```

---

### Task 4: Create telegramApprovals.ts — Outbound Notification

The core module that sends approval notifications to Telegram with inline buttons.

**Files:**
- Create: `src/lib/telegramApprovals.ts`

**Step 1: Create the module**

Create `src/lib/telegramApprovals.ts`:

```typescript
/**
 * Telegram Approval Notifications
 * ================================
 * Sends pending approvals to Telegram with inline APPROVE/DISMISS buttons.
 * Polls for callback_query responses to resolve approvals remotely.
 */

import { loadChannels, getSkillOptions, updateApprovalStatus, getSetting, setSetting, logAudit, type ApprovalRow } from './database';
import { executeSkill } from './skillExecutor';

// ---------------------------------------------------------------------------
// Outbound: Send approval notification to Telegram
// ---------------------------------------------------------------------------

export async function notifyTelegramApproval(approval: ApprovalRow): Promise<void> {
  // 1. Check if Telegram channel is configured and enabled
  const channels = await loadChannels();
  const telegramChannel = channels.find(c => c.type === 'telegram' && c.enabled);
  if (!telegramChannel) return;

  const chatId = telegramChannel.config?.chat_id as string;
  const botToken = telegramChannel.config?.bot_token as string;
  if (!chatId || !botToken) return;

  // 2. Check if approval_notifications option is enabled
  const options = await getSkillOptions('telegram-bot');
  if (options.approval_notifications === false) return; // default is true

  // 3. Build message text
  const typeLabel = approval.type.replace(/_/g, ' ').toUpperCase();
  const text = [
    `*APPROVAL REQUEST*`,
    ``,
    `Type: ${typeLabel}`,
    `Title: ${approval.title}`,
    approval.description ? `Details: ${approval.description}` : '',
    ``,
    `ID: \`${approval.id}\``,
  ].filter(Boolean).join('\n');

  // 4. Build inline keyboard
  const replyMarkup = JSON.stringify({
    inline_keyboard: [[
      { text: 'APPROVE', callback_data: `approve:${approval.id}` },
      { text: 'DISMISS', callback_data: `dismiss:${approval.id}` },
    ]],
  });

  // 5. Send via skill executor (uses gateway handler)
  try {
    const result = await executeSkill('telegram-bot', 'send_message', {
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
    });

    if (result.success) {
      // Store telegram message_id in approval metadata for later editing
      try {
        const parsed = JSON.parse(result.output);
        if (parsed.message_id) {
          const { getSupabase } = await import('./supabase');
          const sb = getSupabase();
          const { data } = await sb.from('approvals').select('metadata').eq('id', approval.id).single();
          const meta = (data?.metadata as Record<string, unknown>) ?? {};
          meta.telegram_message_id = parsed.message_id;
          meta.telegram_chat_id = chatId;
          await sb.from('approvals').update({ metadata: meta }).eq('id', approval.id);
        }
      } catch { /* metadata update non-critical */ }
    }
  } catch (err) {
    console.warn('[TelegramApprovals] Failed to send notification:', err);
  }
}

// ---------------------------------------------------------------------------
// Inbound: Poll for callback_query responses
// ---------------------------------------------------------------------------

export async function checkTelegramCallbacks(): Promise<{ resolved: number }> {
  // 1. Check if Telegram channel is configured and enabled
  const channels = await loadChannels();
  const telegramChannel = channels.find(c => c.type === 'telegram' && c.enabled);
  if (!telegramChannel) return { resolved: 0 };

  const chatId = telegramChannel.config?.chat_id as string;
  const botToken = telegramChannel.config?.bot_token as string;
  if (!chatId || !botToken) return { resolved: 0 };

  // 2. Check if approval_notifications option is enabled
  const options = await getSkillOptions('telegram-bot');
  if (options.approval_notifications === false) return { resolved: 0 };

  // 3. Get last update offset
  const lastOffsetStr = await getSetting('telegram_last_update_id');
  const lastOffset = lastOffsetStr ? parseInt(lastOffsetStr, 10) : undefined;

  // 4. Poll for callback_query updates
  let result;
  try {
    result = await executeSkill('telegram-bot', 'get_updates', {
      limit: 20,
      offset: lastOffset,
      allowed_updates: ['callback_query'],
    });
  } catch {
    return { resolved: 0 };
  }

  if (!result.success) return { resolved: 0 };

  let updates: Array<Record<string, unknown>>;
  try {
    updates = JSON.parse(result.output);
  } catch {
    return { resolved: 0 };
  }

  if (!Array.isArray(updates) || updates.length === 0) return { resolved: 0 };

  let resolved = 0;
  let maxUpdateId = lastOffset ?? 0;

  for (const update of updates) {
    const updateId = update.update_id as number;
    if (updateId > maxUpdateId) maxUpdateId = updateId;

    const callbackQuery = update.callback_query as Record<string, unknown> | undefined;
    if (!callbackQuery) continue;

    const data = callbackQuery.data as string;
    if (!data) continue;

    // Parse callback data: "approve:<id>" or "dismiss:<id>"
    const match = data.match(/^(approve|dismiss):(.+)$/);
    if (!match) continue;

    const [, action, approvalId] = match;
    const newStatus = action === 'approve' ? 'approved' : 'dismissed';

    // Check approval exists and is still pending
    const { getSupabase } = await import('./supabase');
    const sb = getSupabase();
    const { data: existing } = await sb.from('approvals').select('status').eq('id', approvalId).single();

    if (!existing || existing.status !== 'pending') {
      // Already resolved — answer callback with info
      await answerCallbackQuery(botToken, callbackQuery.id as string, 'Already resolved');
      continue;
    }

    // Resolve the approval
    await updateApprovalStatus(approvalId, newStatus);
    resolved++;

    // Answer the callback query (removes loading spinner)
    await answerCallbackQuery(
      botToken,
      callbackQuery.id as string,
      action === 'approve' ? 'Approved!' : 'Dismissed',
    );

    // Edit the original message to show resolution
    const message = callbackQuery.message as Record<string, unknown> | undefined;
    if (message?.message_id) {
      await editMessageText(
        botToken,
        chatId,
        message.message_id as number,
        `${action === 'approve' ? 'APPROVED' : 'DISMISSED'} via Telegram\n\nID: ${approvalId}`,
      );
    }

    // Dispatch event + audit
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('approvals-changed'));
    }
    await logAudit('Founder', 'TELEGRAM_APPROVAL', `${newStatus} via Telegram: ${approvalId}`, 'info');
  }

  // 5. Update offset so we don't re-process these updates
  if (maxUpdateId > (lastOffset ?? 0)) {
    await setSetting('telegram_last_update_id', String(maxUpdateId + 1));
  }

  return { resolved };
}

// ---------------------------------------------------------------------------
// Telegram Bot API helpers (direct fetch — these aren't skill commands)
// ---------------------------------------------------------------------------

async function answerCallbackQuery(botToken: string, callbackQueryId: string, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch { /* non-critical */ }
}

async function editMessageText(botToken: string, chatId: string, messageId: number, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text }),
    });
  } catch { /* non-critical */ }
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean

**Step 3: Commit**

```bash
git add src/lib/telegramApprovals.ts
git commit -m "feat: add telegramApprovals.ts — outbound notifications + callback polling"
```

---

### Task 5: Hook Approval Notifications Into saveApproval()

Fire-and-forget Telegram notification when approvals are created.

**Files:**
- Modify: `src/lib/database.ts:396-407`

**Step 1: Add Telegram notification hook**

After the insert in `saveApproval()`, add the fire-and-forget notification:

```typescript
export async function saveApproval(approval: Omit<ApprovalRow, 'created_at'>): Promise<void> {
  await getSupabase()
    .from('approvals')
    .insert({
      id: approval.id,
      type: approval.type,
      title: approval.title,
      description: approval.description,
      status: approval.status,
      metadata: approval.metadata,
    });

  // Fire-and-forget: notify Telegram if configured
  if (approval.status === 'pending') {
    import('./telegramApprovals').then(({ notifyTelegramApproval }) => {
      notifyTelegramApproval(approval as ApprovalRow).catch(() => {});
    }).catch(() => {});
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean

**Step 3: Commit**

```bash
git add src/lib/database.ts
git commit -m "feat: hook Telegram approval notification into saveApproval()"
```

---

### Task 6: Add Telegram Polling Sidecar to CEO Decision Engine

Poll for Telegram callback responses during the CEO cycle.

**Files:**
- Modify: `src/lib/ceoDecisionEngine.ts:2015` (after checkForUpdates block)

**Step 1: Add Telegram polling check after the update check**

After line 2015 (`console.warn('[CEODecisionEngine] Update check failed:', err);`), before the `// 5. Build diagnostic result` comment, add:

```typescript
  // 4f. Telegram approval polling (every cycle — checks for callback_query responses)
  try {
    const { checkTelegramCallbacks } = await import('./telegramApprovals');
    const telegramResult = await checkTelegramCallbacks();
    if (telegramResult.resolved > 0) {
      allActions.push({
        id: `telegram-${Date.now()}`,
        action_type: 'send_message',
        payload: {
          topic: 'telegram_approvals',
          message: `Resolved ${telegramResult.resolved} approval(s) via Telegram.`,
        },
        priority: 3,
      });
    }
  } catch (err) {
    console.warn('[CEODecisionEngine] Telegram polling failed:', err);
  }
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean

**Step 3: Commit**

```bash
git add src/lib/ceoDecisionEngine.ts
git commit -m "feat: add Telegram approval polling sidecar to CEO decision engine"
```

---

### Task 7: Add Skill Options UI to SkillsView

Render option toggles for skills that have `options[]` in their definition.

**Files:**
- Modify: `src/components/Skills/SkillsView.tsx`

**Step 1: Read SkillsView.tsx to find the right insertion point**

Read the skill card rendering section to understand where to add the options gear icon. Look for the schedule button pattern (clock icon) and add a similar gear icon next to it.

**Step 2: Add options gear icon + popover**

Add a `Settings2` icon import from lucide-react. When the skill definition has `options` array, show a gear icon that opens a popover with toggle switches for each boolean option.

Add state: `const [optionsPopover, setOptionsPopover] = useState<string | null>(null);`

Add the options storage: `const [skillOptionsMap, setSkillOptionsMap] = useState<Map<string, Record<string, unknown>>>(new Map());`

Load options on mount alongside other skill data. When an option toggle changes, call `saveSkillOptions(skillId, updatedOptions)`.

The popover should render each option from the skill definition's `options[]` array:
- `boolean` → toggle switch
- `string` → text input
- `select` → dropdown

**Step 3: Verify TypeScript compiles and the UI renders**

Run: `npx tsc --noEmit`
Then: `npm run dev` and navigate to /skills — verify the Telegram Bot skill shows a gear icon. Click it, see the two toggles.

**Step 4: Commit**

```bash
git add src/components/Skills/SkillsView.tsx
git commit -m "feat: add skill options UI (gear icon + toggles) for skills with options[]"
```

---

### Task 8: Update Skill Schema and Manifest

Add `options` to the JSON Schema so skill validation accepts the new field.

**Files:**
- Modify: `skills_repo/schema/skill.schema.json`

**Step 1: Add options property to schema**

In the `properties` section of `skill.schema.json`, after the existing properties, add:

```json
"options": {
  "type": "array",
  "description": "Per-skill configuration options rendered in the Skills UI",
  "items": {
    "type": "object",
    "required": ["key", "label", "type"],
    "properties": {
      "key": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9_]*$",
        "description": "Unique option key (snake_case)"
      },
      "label": {
        "type": "string",
        "description": "Human-readable label for the UI"
      },
      "type": {
        "type": "string",
        "enum": ["boolean", "string", "number", "select"],
        "description": "Option value type"
      },
      "default": {
        "description": "Default value for this option"
      },
      "choices": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Available choices for select type"
      },
      "description": {
        "type": "string",
        "description": "Tooltip/help text for the option"
      }
    },
    "additionalProperties": false
  }
}
```

**Step 2: Update manifest checksum for telegram-bot**

```bash
shasum -a 256 skills_repo/Official/communication/telegram-bot/skill.json
```
Update the checksum in `skills_repo/manifest.json`.

**Step 3: Commit**

```bash
cd skills_repo && git add . && git commit -m "feat: add options[] to skill schema + update telegram-bot manifest"
cd .. && git add skills_repo && git commit -m "chore: update skills_repo submodule"
```

---

### Task 9: Update A2A Audit Tab for Telegram Actions

Add TELEGRAM_ prefix to A2A action detection.

**Files:**
- Modify: `src/components/Audit/AuditView.tsx`

**Step 1: Add TELEGRAM_ prefix to A2A detection**

Find the `A2A_ACTION_PREFIXES` array and add `'TELEGRAM_'`:

```typescript
const A2A_ACTION_PREFIXES = ['FORUM_', 'MARKETPLACE_', 'MKT_', 'PEER_', 'SKILL_SYNC', 'UPDATE_', 'VERSION_', 'TELEGRAM_'];
```

Add Telegram to `getA2ACategory()`:
```typescript
if (action.startsWith('TELEGRAM_')) return 'other'; // or add a 'telegram' category
```

Add Telegram action styling to `getA2AActionStyle()`:
```typescript
if (action.startsWith('TELEGRAM_')) return { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', label: 'TELEGRAM' };
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean

**Step 3: Commit**

```bash
git add src/components/Audit/AuditView.tsx
git commit -m "feat: add Telegram action recognition to A2A audit tab"
```

---

### Task 10: End-to-End Verification

**Step 1: Build check**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 2: Manual testing checklist**

1. Start dev server: `npm run dev`
2. Navigate to /skills — verify Telegram Bot skill shows gear icon
3. Click gear — verify "Send approvals via Telegram" and "CEO alerts via Telegram" toggles appear
4. Enable the Telegram skill, configure a Telegram channel in notification settings
5. Trigger an approval (e.g., enable a new skill that needs an API key)
6. Verify Telegram receives a message with APPROVE/DISMISS buttons
7. Tap APPROVE on Telegram
8. Verify the approval resolves on the /approvals page
9. Check /audit A2A tab for TELEGRAM_APPROVAL entry

**Step 3: Final commit (if any cleanup needed)**

```bash
git add -A && git commit -m "chore: cleanup after Telegram approval system integration"
```
