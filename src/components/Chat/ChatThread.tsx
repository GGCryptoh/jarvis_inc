import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Copy, Archive } from 'lucide-react';
import {
  type ConversationRow, type ChatMessageRow,
  loadChatMessages, saveChatMessage, loadCEO,
} from '../../lib/database';
import { getCEOResponse } from '../../lib/ceoResponder';
import { isLLMAvailable, streamCEOResponse, type LLMAvailability } from '../../lib/llm/chatService';
import { extractMemories } from '../../lib/memory';
import RichMessageContent from './ToolCallBlock';

/** Extract a short user-facing error label from an LLM API error. */
function parseLLMError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/credit balance|billing|payment|insufficient.?funds/i.test(msg)) return 'No API credits';
  if (/rate.?limit|too many requests|429/i.test(msg)) return 'Rate limited';
  if (/invalid.?api.?key|authentication|401|403/i.test(msg)) return 'Invalid API key';
  if (/overloaded|capacity|503|529/i.test(msg)) return 'API overloaded';
  if (/timeout|ECONNREFUSED|network/i.test(msg)) return 'Network error';
  return 'API error';
}

interface ChatThreadProps {
  conversation: ConversationRow;
  onArchive?: () => void;
}

export default function ChatThread({ conversation, onArchive }: ChatThreadProps) {
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [ceoName, setCeoName] = useState('CEO');
  const [llm, setLlm] = useState<LLMAvailability>({ available: false, service: '', model: '', displayModel: '' });
  const [llmError, setLlmError] = useState<string | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const archiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastExtractionCountRef = useRef<number>(0);
  const messagesRef = useRef<ChatMessageRow[]>([]);

  const isArchived = conversation.status === 'archived';

  // Keep ref in sync with state for cleanup extraction
  messagesRef.current = messages;

  // Clean up archive confirm timer on unmount
  useEffect(() => {
    return () => {
      if (archiveTimerRef.current) clearTimeout(archiveTimerRef.current);
    };
  }, []);

  const handleArchiveClick = useCallback(() => {
    if (archiveConfirm) {
      // Second click — actually archive
      if (archiveTimerRef.current) clearTimeout(archiveTimerRef.current);
      archiveTimerRef.current = null;
      setArchiveConfirm(false);
      onArchive?.();
    } else {
      // First click — enter confirm state
      setArchiveConfirm(true);
      archiveTimerRef.current = setTimeout(() => {
        setArchiveConfirm(false);
        archiveTimerRef.current = null;
      }, 3000);
    }
  }, [archiveConfirm, onArchive]);

  /** Fire-and-forget memory extraction — triggers every 6 messages during chat */
  const maybeExtractMemories = useCallback((allMessages: ChatMessageRow[]) => {
    const count = allMessages.length;
    if (count < 4) return; // Need at least 2 exchanges
    // Trigger every 6 messages since last extraction
    if (count - lastExtractionCountRef.current < 6) return;
    lastExtractionCountRef.current = count;
    extractMemories(allMessages, conversation.id).catch(err =>
      console.warn('Memory extraction failed:', err)
    );
  }, [conversation.id]);

  // NOTE: Task dispatch is handled centrally in chatService.ts onDone wrapper.
  // Do NOT dispatch here — it would create duplicate missions.

  // Load CEO name + LLM availability on mount and when conversation changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ceoRow = await loadCEO();
      if (!cancelled) setCeoName(ceoRow?.name ?? 'CEO');

      const availability = await isLLMAvailable();
      if (!cancelled) setLlm(availability);
    })();
    return () => { cancelled = true; };
  }, [conversation.id]);

  // Re-check LLM availability when vault keys change
  useEffect(() => {
    const handler = () => {
      isLLMAvailable().then(setLlm);
      setLlmError(null); // Clear error — user may have fixed the key
    };
    window.addEventListener('vault-changed', handler);
    return () => window.removeEventListener('vault-changed', handler);
  }, []);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Extract memories when leaving a conversation (unmount or switch)
  // This catches short chats that never hit the 6-message threshold
  useEffect(() => {
    const convId = conversation.id;
    return () => {
      const msgs = messagesRef.current;
      // At least 2 user messages worth extracting (user + ceo = 2 msgs minimum)
      const userMsgCount = msgs.filter(m => m.sender === 'user').length;
      if (userMsgCount >= 1 && msgs.length > lastExtractionCountRef.current) {
        extractMemories(msgs, convId).catch(err =>
          console.warn('Memory extraction on leave failed:', err)
        );
      }
    };
  }, [conversation.id]);

  // Load messages when conversation changes
  useEffect(() => {
    let cancelled = false;

    // Abort any in-progress stream
    abortRef.current?.abort();
    abortRef.current = null;
    setStreamingText(null);
    setTyping(false);

    (async () => {
      const loaded = await loadChatMessages(conversation.id);
      if (cancelled) return;
      setMessages(loaded);

      // Focus input for active conversations
      if (!isArchived) {
        setTimeout(() => inputRef.current?.focus(), 200);
      }
    })();

    return () => { cancelled = true; };
  }, [conversation.id, isArchived]);

  // Listen for Realtime chat_messages changes (e.g. edge function posting skill results)
  const msgCountRef = useRef(messages.length);
  useEffect(() => { msgCountRef.current = messages.length; }, [messages.length]);

  useEffect(() => {
    const convId = conversation.id;
    const reload = async () => {
      const loaded = await loadChatMessages(convId);
      if (loaded.length > msgCountRef.current) {
        setMessages(loaded);
      }
    };
    const handler = () => {
      // If mid-stream, defer the reload until streaming finishes
      if (abortRef.current) {
        setTimeout(handler, 1000);
        return;
      }
      reload();
    };
    window.addEventListener('chat-messages-changed', handler);
    window.addEventListener('missions-changed', handler);
    return () => {
      window.removeEventListener('chat-messages-changed', handler);
      window.removeEventListener('missions-changed', handler);
    };
  }, [conversation.id]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing, streamingText]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isArchived) return;

    // Add user message
    const userMsg: ChatMessageRow = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      conversation_id: conversation.id,
      sender: 'user',
      text,
      metadata: null,
      created_at: new Date().toISOString(),
    };
    await saveChatMessage({
      id: userMsg.id,
      conversation_id: userMsg.conversation_id,
      sender: userMsg.sender,
      text: userMsg.text,
      metadata: null,
    });
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');

    // Try LLM streaming first
    setTyping(true);

    const controller = await streamCEOResponse(text, updatedMessages, {
      onToken: (token) => {
        setTyping(false);
        setStreamingText(prev => (prev ?? '') + token);
      },
      onDone: async (fullText) => {
        setTyping(false);
        setStreamingText(null);
        setLlmError(null); // API call succeeded — clear any prior error
        const ceoMsg: ChatMessageRow = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: conversation.id,
          sender: 'ceo',
          text: fullText,
          metadata: { llm: true },
          created_at: new Date().toISOString(),
        };
        await saveChatMessage({
          id: ceoMsg.id,
          conversation_id: ceoMsg.conversation_id,
          sender: ceoMsg.sender,
          text: ceoMsg.text,
          metadata: ceoMsg.metadata,
        });
        const withCeo = [...updatedMessages, ceoMsg];
        setMessages(prev => [...prev, ceoMsg]);
        abortRef.current = null;
        maybeExtractMemories(withCeo);
      },
      onError: async (error) => {
        console.error('LLM stream error:', error);
        setTyping(false);
        setStreamingText(null);
        abortRef.current = null;
        setLlmError(parseLLMError(error));
        // Fallback to scripted response on error
        const responseText = await getCEOResponse(text);
        const ceoMsg: ChatMessageRow = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: conversation.id,
          sender: 'ceo',
          text: responseText,
          metadata: null,
          created_at: new Date().toISOString(),
        };
        await saveChatMessage({
          id: ceoMsg.id,
          conversation_id: ceoMsg.conversation_id,
          sender: ceoMsg.sender,
          text: ceoMsg.text,
          metadata: null,
        });
        const withCeo = [...updatedMessages, ceoMsg];
        setMessages(prev => [...prev, ceoMsg]);
        maybeExtractMemories(withCeo);
      },
    });

    if (controller) {
      // LLM is handling it
      abortRef.current = controller;
    } else {
      // No LLM available — fallback to scripted response
      const delay = 800 + Math.random() * 1200;
      setTimeout(async () => {
        setTyping(false);
        const responseText = await getCEOResponse(text);
        const ceoMsg: ChatMessageRow = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: conversation.id,
          sender: 'ceo',
          text: responseText,
          metadata: null,
          created_at: new Date().toISOString(),
        };
        await saveChatMessage({
          id: ceoMsg.id,
          conversation_id: ceoMsg.conversation_id,
          sender: ceoMsg.sender,
          text: ceoMsg.text,
          metadata: null,
        });
        const withCeo = [...updatedMessages, ceoMsg];
        setMessages(prev => [...prev, ceoMsg]);
        maybeExtractMemories(withCeo);
      }, delay);
    }
  }, [input, conversation.id, isArchived, messages, maybeExtractMemories, llm.model]);

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
        <div className="w-8 h-8 rounded-full bg-yellow-400/20 border border-yellow-400/40 flex items-center justify-center">
          <span className="font-pixel text-[13px] text-yellow-300">{'\u265B'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-pixel text-[13px] tracking-wider text-yellow-300 truncate">
            CEO {ceoName}
          </div>
          <div className="font-pixel text-[10px] tracking-wider text-zinc-500">
            {typing ? 'TYPING...' : streamingText !== null ? 'RESPONDING...' : isArchived ? 'ARCHIVED' : 'ONLINE'}
          </div>
        </div>
        {!isArchived && onArchive && (
          <button
            onClick={handleArchiveClick}
            className={[
              'flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors',
              archiveConfirm
                ? 'bg-amber-500/10 border border-amber-500/25'
                : 'bg-zinc-500/10 border border-zinc-500/25 hover:bg-zinc-500/20',
            ].join(' ')}
          >
            <Archive size={12} className={archiveConfirm ? 'text-amber-400' : 'text-zinc-500'} />
            {archiveConfirm && (
              <span className="font-pixel text-[10px] tracking-widest text-amber-400">
                CONFIRM ARCHIVE?
              </span>
            )}
          </button>
        )}
        {llm.available && !isArchived && !llmError && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-pixel text-[10px] tracking-widest text-emerald-400">
              LLM: CONNECTED
            </span>
          </div>
        )}
        {llm.available && !isArchived && llmError && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            <span className="font-pixel text-[10px] tracking-widest text-red-400">
              LLM: {llmError.toUpperCase()}
            </span>
          </div>
        )}
        {!llm.available && !isArchived && llm.budgetExceeded && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            <span className="font-pixel text-[10px] tracking-widest text-red-400">
              BUDGET EXCEEDED
            </span>
            <span className="font-pixel text-[8px] tracking-wider text-red-400/60">
              ${llm.budgetSpent?.toFixed(2)} / ${llm.budgetLimit?.toFixed(2)}
            </span>
          </div>
        )}
        {!llm.available && !isArchived && !llm.budgetExceeded && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="font-pixel text-[10px] tracking-widest text-amber-400">
              LLM: OFFLINE
            </span>
          </div>
        )}
        {isArchived && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-500/10 border border-zinc-500/25">
            <span className="font-pixel text-[10px] tracking-widest text-zinc-500">
              READ ONLY
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar px-6 py-4 space-y-4">
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} group/msg`}
          >
            {/* Re-send icon — appears on hover for user messages */}
            {msg.sender === 'user' && !isArchived && (
              <button
                onClick={() => { setInput(msg.text); inputRef.current?.focus(); }}
                className="self-center mr-2 opacity-0 group-hover/msg:opacity-100 transition-opacity text-zinc-600 hover:text-emerald-400"
                title="Copy to input"
              >
                <Copy size={12} />
              </button>
            )}
            <div
              className={[
                'rounded-lg px-4 py-3',
                msg.sender === 'user'
                  ? 'max-w-[70%] bg-emerald-500/15 border border-emerald-500/30'
                  : msg.sender === 'system'
                    ? 'max-w-[85%] bg-zinc-700/30 border border-zinc-600/30'
                    : 'max-w-[85%] bg-zinc-800/60 border border-zinc-700/50',
              ].join(' ')}
            >
              {msg.sender === 'ceo' && (
                <div className="font-pixel text-[10px] tracking-wider text-yellow-300/70 mb-1.5">
                  CEO {ceoName}
                </div>
              )}
              <div className={[
                'font-pixel text-[10px] tracking-wider leading-relaxed whitespace-pre-line',
                msg.sender === 'user' ? 'text-emerald-200' : 'text-zinc-300',
              ].join(' ')}>
                {msg.sender === 'ceo' ? <RichMessageContent text={msg.text} metadata={msg.metadata} messageId={msg.id} /> : msg.text}
              </div>
            </div>
          </div>
        ))}

        {/* Streaming CEO response */}
        {streamingText !== null && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-4 py-3 bg-zinc-800/60 border border-zinc-700/50">
              <div className="font-pixel text-[10px] tracking-wider text-yellow-300/70 mb-1.5">
                CEO {ceoName}
              </div>
              <div className="font-pixel text-[10px] tracking-wider leading-relaxed whitespace-pre-line text-zinc-300">
                <RichMessageContent text={streamingText} />
                <span className="inline-block w-1.5 h-3 bg-yellow-300/60 animate-pulse ml-0.5 align-middle" />
              </div>
            </div>
          </div>
        )}

        {typing && (
          <div className="flex justify-start">
            <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-300/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-300/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-300/60 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-zinc-800">
        <div className="flex items-center gap-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            autoFocus={!isArchived}
            placeholder={isArchived ? 'This conversation is archived' : 'Message CEO...'}
            disabled={isArchived}
            className={`flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 font-pixel text-[10px] tracking-wider text-zinc-200 focus:outline-none focus:border-emerald-500/40 disabled:cursor-not-allowed ${isArchived ? 'placeholder-zinc-500 disabled:opacity-70' : 'placeholder-zinc-600 disabled:opacity-40'}`}
          />
          <button
            onClick={handleSend}
            disabled={isArchived || !input.trim()}
            className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
