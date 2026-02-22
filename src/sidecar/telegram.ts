/**
 * Telegram Polling Module — Sidecar
 * ==================================
 * Long-polls Telegram's getUpdates API and routes messages to the CEO via
 * streamCEOResponse. Runs inside the sidecar process alongside the CEO
 * scheduler — no webhook or public domain required.
 *
 * Chat ID whitelisting: the first message auto-authorizes that chat_id;
 * subsequent messages from different chat_ids are ignored.
 */

import { getSupabase } from '../lib/supabase';
import { streamCEOResponse } from '../lib/llm/chatService';
import {
  saveChatMessage,
  saveConversation,
  loadChatMessages,
  logAudit,
} from '../lib/database';
import type { ChatMessageRow } from '../lib/database';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let running = false;
let offset = 0; // Telegram update offset

// Track which CEO messages we've already forwarded to Telegram
const sentMessageIds = new Set<string>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getTelegramChannel(): Promise<{
  id: string;
  bot_token: string;
  bot_username: string;
  authorized_chat_id: number | null;
} | null> {
  const { data } = await getSupabase()
    .from('notification_channels')
    .select('id, config')
    .eq('type', 'telegram')
    .eq('enabled', true)
    .limit(1)
    .maybeSingle();

  if (!data?.config) return null;
  const cfg = data.config as Record<string, unknown>;
  const bot_token = cfg.bot_token as string | undefined;
  if (!bot_token) return null;

  return {
    id: data.id,
    bot_token,
    bot_username: (cfg.bot_username as string) ?? '',
    authorized_chat_id: (cfg.authorized_chat_id as number) ?? null,
  };
}

async function telegramAPI(token: string, method: string, body?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

/** Find or create the canonical Telegram conversation. */
async function getOrCreateTelegramConversation(): Promise<string> {
  const { data } = await getSupabase()
    .from('conversations')
    .select('id')
    .eq('type', 'telegram')
    .limit(1)
    .maybeSingle();

  if (data) return data.id;

  const id = `telegram-${Date.now()}`;
  await saveConversation({
    id,
    title: 'Telegram',
    type: 'telegram',
    status: 'active',
  });
  return id;
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

async function handleMessage(
  text: string,
  chatId: number,
  botToken: string,
): Promise<void> {
  const conversationId = await getOrCreateTelegramConversation();

  // 1. Save user message
  const userMsgId = `tg-user-${Date.now()}`;
  await saveChatMessage({
    id: userMsgId,
    conversation_id: conversationId,
    sender: 'user',
    text,
    metadata: { source: 'telegram', chat_id: chatId },
  });

  // 2. Load recent history
  const allMessages = await loadChatMessages(conversationId);
  const history: ChatMessageRow[] = allMessages.slice(-20);

  // 3. Stream CEO response — wrap callbacks in a promise
  const replyText = await new Promise<string>((resolve, reject) => {
    let fullText = '';
    let resolved = false;

    const safeResolve = (val: string) => {
      if (!resolved) { resolved = true; resolve(val); }
    };

    streamCEOResponse(text, history, {
      onToken: (token) => { fullText += token; },
      onDone: () => { safeResolve(fullText); },
      onError: (err) => {
        console.error('[Telegram] LLM error:', err.message);
        if (!resolved) { resolved = true; reject(err); }
      },
    }, { source: 'telegram' }).then((controller) => {
      if (!controller) {
        safeResolve('');
      }
    }).catch((err) => {
      console.error('[Telegram] streamCEOResponse error:', err);
      if (!resolved) { resolved = true; reject(err); }
    });
  });

  if (!replyText) {
    const fallback = 'CEO is offline — no LLM service configured. Set up an API key in the Vault.';
    await telegramAPI(botToken, 'sendMessage', { chat_id: chatId, text: fallback });
    return;
  }

  // Strip <tool_call> blocks — they get processed server-side but shouldn't reach Telegram
  const cleanReply = replyText
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleanReply) return; // entire reply was tool_calls, nothing to send

  // 4. Send reply via Telegram
  await telegramAPI(botToken, 'sendMessage', { chat_id: chatId, text: cleanReply });

  // 5. Save CEO reply
  const ceoMsgId = `tg-ceo-${Date.now()}`;
  await saveChatMessage({
    id: ceoMsgId,
    conversation_id: conversationId,
    sender: 'ceo',
    text: replyText,
    metadata: { source: 'telegram', chat_id: chatId },
  });
}

// ---------------------------------------------------------------------------
// Polling loop
// ---------------------------------------------------------------------------

async function pollLoop(botToken: string, channelId: string): Promise<void> {
  while (running) {
    try {
      const data = await telegramAPI(botToken, 'getUpdates', {
        offset,
        timeout: 30,
        allowed_updates: ['message'],
      });

      if (!data.ok || !Array.isArray(data.result)) {
        console.error('[Telegram] getUpdates error:', data.description ?? 'unknown');
        await sleep(5000);
        continue;
      }

      for (const update of data.result) {
        offset = update.update_id + 1;

        const message = update.message;
        if (!message?.text || !message?.chat?.id) continue;

        const chatId: number = message.chat.id;

        // --- Chat ID authorization ---
        const channel = await getTelegramChannel();
        if (!channel) break; // channel was disabled mid-poll

        if (channel.authorized_chat_id === null) {
          // First message ever — authorize this chat
          const { data: chData } = await getSupabase()
            .from('notification_channels')
            .select('config')
            .eq('id', channelId)
            .maybeSingle();

          const existingConfig = (chData?.config ?? {}) as Record<string, unknown>;
          await getSupabase()
            .from('notification_channels')
            .update({ config: { ...existingConfig, authorized_chat_id: chatId } })
            .eq('id', channelId);

          await logAudit(null, 'TELEGRAM_AUTHORIZED', `Telegram chat authorized: ${chatId}`, 'info');
          console.log(`[Telegram] Chat authorized: ${chatId}`);

          // Start outbound watcher now that we have a chat ID
          console.log(`[Telegram] Starting outbound watcher for newly authorized chat ${chatId}`);
          outboundWatcher(botToken, chatId).catch((err) => {
            console.error('[Telegram] Outbound watcher crashed:', err);
          });
        } else if (chatId !== channel.authorized_chat_id) {
          // Unauthorized chat — ignore
          console.log(`[Telegram] Ignoring unauthorized chat: ${chatId}`);
          await telegramAPI(botToken, 'sendMessage', {
            chat_id: chatId,
            text: 'Unauthorized. This bot is bound to a specific chat.',
          });
          continue;
        }

        // Handle the message
        const fromName = message.from?.first_name ?? 'User';
        console.log(`[Telegram] Message from ${fromName}: ${message.text.slice(0, 80)}`);

        // Fire-and-forget to avoid blocking the poll loop
        handleMessage(message.text, chatId, botToken).catch((err) => {
          console.error('[Telegram] Message handling error:', err);
        });
      }
    } catch (err) {
      console.error('[Telegram] Poll error:', err);
      await sleep(5000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Outbound message watcher — forwards skill results etc. to Telegram
// ---------------------------------------------------------------------------

async function outboundWatcher(botToken: string, chatId: number): Promise<void> {
  // Seed sentMessageIds with existing messages so we don't replay history
  const convId = await getOrCreateTelegramConversation();
  const existing = await loadChatMessages(convId);
  for (const msg of existing) {
    sentMessageIds.add(msg.id);
  }

  while (running) {
    await sleep(5000); // check every 5 seconds

    try {
      const messages = await loadChatMessages(convId);
      for (const msg of messages) {
        if (sentMessageIds.has(msg.id)) continue;
        sentMessageIds.add(msg.id);

        // Only forward CEO messages not already sent by us
        if (msg.sender !== 'ceo') continue;
        const meta = msg.metadata as Record<string, unknown> | null;
        if (meta?.source === 'telegram') continue; // we sent this one

        // Strip tool_call blocks and metadata-only messages
        const text = msg.text
          .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        if (!text) continue;

        // Truncate long messages for Telegram (4096 char limit)
        const truncated = text.length > 4000 ? text.slice(0, 4000) + '\n\n[truncated — see full results in dashboard]' : text;

        await telegramAPI(botToken, 'sendMessage', { chat_id: chatId, text: truncated });
        console.log(`[Telegram] Forwarded CEO message: ${text.slice(0, 60)}`);
      }
    } catch (err) {
      console.error('[Telegram] Outbound watcher error:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startTelegramPolling(): Promise<void> {
  const channel = await getTelegramChannel();
  if (!channel) {
    console.log('[Telegram] No enabled Telegram channel, skipping');
    return;
  }

  // Validate token
  const me = await telegramAPI(channel.bot_token, 'getMe');
  if (!me.ok) {
    console.error('[Telegram] Invalid bot token:', me.description);
    return;
  }
  console.log(`[Telegram] Bot validated: @${me.result.username}`);

  // Delete any old webhook so getUpdates works
  await telegramAPI(channel.bot_token, 'deleteWebhook');

  running = true;
  console.log('[Telegram] Polling started');

  // Start outbound watcher if chat is already authorized
  if (channel.authorized_chat_id) {
    console.log(`[Telegram] Starting outbound watcher for chat ${channel.authorized_chat_id}`);
    outboundWatcher(channel.bot_token, channel.authorized_chat_id).catch((err) => {
      console.error('[Telegram] Outbound watcher crashed:', err);
    });
  }

  // Run poll loop (blocks until running = false)
  await pollLoop(channel.bot_token, channel.id);
}

export function stopTelegramPolling(): void {
  running = false;
  console.log('[Telegram] Polling stopped');
}
