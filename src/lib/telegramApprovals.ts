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
  if (!chatId) return;

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

    // Answer the callback query (removes loading spinner on button)
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
// Telegram Bot API helpers (direct fetch — not skill commands)
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
