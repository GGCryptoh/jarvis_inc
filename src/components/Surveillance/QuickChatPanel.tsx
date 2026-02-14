import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, ExternalLink, Minus, X } from 'lucide-react';
import {
  type ConversationRow, type ChatMessageRow,
  loadConversations, saveConversation, loadChatMessages, saveChatMessage, loadCEO,
} from '../../lib/database';
import { getCEOResponse } from '../../lib/ceoResponder';
import { isLLMAvailable, streamCEOResponse } from '../../lib/llm/chatService';
import RichMessageContent from '../Chat/ToolCallBlock';

/**
 * Compact chat panel for the Surveillance view.
 * Overlays the bottom-center of the CRT frame.
 */
export default function QuickChatPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [ceoName, setCeoName] = useState('CEO');
  const [minimized, setMinimized] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load or create conversation on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ceo = await loadCEO();
      if (!cancelled) setCeoName(ceo?.name ?? 'CEO');

      // Find most recent active conversation
      const convos = await loadConversations();
      const active = convos.find(c => c.status === 'active');
      if (active) {
        if (!cancelled) {
          setConversation(active);
          const msgs = await loadChatMessages(active.id);
          setMessages(msgs);
        }
      } else {
        // Create a new one
        const newConv: ConversationRow = {
          id: `conv-${Date.now()}`,
          title: 'Quick Chat',
          type: 'chat',
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await saveConversation({ id: newConv.id, title: newConv.title, type: newConv.type, status: newConv.status });
        if (!cancelled) setConversation(newConv);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing, streamingText]);

  // Focus input when opened
  useEffect(() => {
    if (!minimized) setTimeout(() => inputRef.current?.focus(), 200);
  }, [minimized]);

  // Cleanup abort on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Listen for skill result messages posted by taskDispatcher
  // Uses a ref to track message count so the handler always has the latest value
  const msgCountRef = useRef(messages.length);
  useEffect(() => { msgCountRef.current = messages.length; }, [messages.length]);

  useEffect(() => {
    if (!conversation) return;
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
  }, [conversation]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !conversation) return;

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
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setTyping(true);

    const controller = await streamCEOResponse(text, updated, {
      onToken: (token) => {
        setTyping(false);
        setStreamingText(prev => (prev ?? '') + token);
      },
      onDone: async (fullText) => {
        setTyping(false);
        setStreamingText(null);
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
        setMessages(prev => [...prev, ceoMsg]);
        abortRef.current = null;
      },
      onError: async () => {
        setTyping(false);
        setStreamingText(null);
        abortRef.current = null;
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
        setMessages(prev => [...prev, ceoMsg]);
      },
    });

    if (controller) {
      abortRef.current = controller;
    } else {
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
      setMessages(prev => [...prev, ceoMsg]);
    }
  }, [input, conversation, messages]);

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-900/90 border border-yellow-400/30 hover:border-yellow-400/60 transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
        <span className="font-pixel text-[9px] tracking-widest text-yellow-300">CEO CHAT</span>
        {messages.length > 0 && (
          <span className="font-pixel text-[8px] text-zinc-500">{messages.length}</span>
        )}
      </button>
    );
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 w-[600px] flex flex-col rounded-lg overflow-hidden border-2 border-pixel-crt-border bg-pixel-bg shadow-2xl shadow-black/60">
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gradient-to-r from-pixel-crt-border to-zinc-700 border-b border-pixel-crt-border">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          <span className="font-pixel text-[8px] tracking-widest text-zinc-200">
            CEO {ceoName} — QUICK CHAT
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={async () => {
              // If mid-stream, save partial response before navigating
              if (abortRef.current && streamingText) {
                abortRef.current.abort();
                abortRef.current = null;
                const partial = streamingText;
                setStreamingText(null);
                if (conversation && partial.trim()) {
                  const ceoMsg = {
                    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    conversation_id: conversation.id,
                    sender: 'ceo' as const,
                    text: partial,
                    metadata: { llm: true, partial: true },
                  };
                  await saveChatMessage(ceoMsg);
                  window.dispatchEvent(new Event('chat-messages-changed'));
                }
              }
              navigate('/chat');
            }}
            className="p-1 hover:bg-zinc-600/50 rounded transition-colors"
            title="Open full chat"
          >
            <ExternalLink size={10} className="text-zinc-400 hover:text-emerald-400" />
          </button>
          <button
            onClick={() => setMinimized(true)}
            className="p-1 hover:bg-zinc-600/50 rounded transition-colors"
            title="Minimize"
          >
            <Minus size={10} className="text-zinc-400" />
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-600/50 rounded transition-colors"
            title="Close chat"
          >
            <X size={10} className="text-zinc-400 hover:text-pixel-pink" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="h-[240px] overflow-y-auto no-scrollbar px-3 py-2 space-y-2">
        {messages.length === 0 && !typing && (
          <div className="flex items-center justify-center h-full">
            <span className="font-pixel text-[8px] text-zinc-600 tracking-wider">Send a message to CEO {ceoName}</span>
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={[
                'rounded px-3 py-2 max-w-[80%]',
                msg.sender === 'user'
                  ? 'bg-emerald-500/15 border border-emerald-500/30'
                  : 'bg-zinc-800/60 border border-zinc-700/50',
              ].join(' ')}
            >
              {msg.sender === 'ceo' && (
                <div className="font-pixel text-[7px] tracking-wider text-yellow-300/70 mb-1">
                  CEO {ceoName}
                </div>
              )}
              <div className={[
                'font-pixel text-[8px] tracking-wider leading-relaxed whitespace-pre-line',
                msg.sender === 'user' ? 'text-emerald-200' : 'text-zinc-300',
              ].join(' ')}>
                {msg.sender === 'ceo' ? <RichMessageContent text={msg.text} /> : msg.text}
              </div>
            </div>
          </div>
        ))}

        {streamingText !== null && (
          <div className="flex justify-start">
            <div className="rounded px-3 py-2 max-w-[80%] bg-zinc-800/60 border border-zinc-700/50">
              <div className="font-pixel text-[7px] tracking-wider text-yellow-300/70 mb-1">
                CEO {ceoName}
              </div>
              <div className="font-pixel text-[8px] tracking-wider leading-relaxed whitespace-pre-line text-zinc-300">
                <RichMessageContent text={streamingText} />
                <span className="inline-block w-1 h-2 bg-yellow-300/60 animate-pulse ml-0.5 align-middle" />
              </div>
            </div>
          </div>
        )}

        {typing && (
          <div className="flex justify-start">
            <div className="bg-zinc-800/60 border border-zinc-700/50 rounded px-3 py-2">
              <div className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-yellow-300/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full bg-yellow-300/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 rounded-full bg-yellow-300/60 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-pixel-crt-border bg-pixel-bg">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Message CEO..."
            className="flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded px-3 py-1.5 font-pixel text-[8px] tracking-wider text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="w-7 h-7 rounded bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-30"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
