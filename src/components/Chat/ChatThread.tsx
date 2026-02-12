import { useState, useEffect, useRef, useCallback } from 'react';
import { Send } from 'lucide-react';
import {
  type ConversationRow, type ChatMessageRow,
  loadChatMessages, saveChatMessage, loadCEO,
} from '../../lib/database';
import { getCEOResponse } from '../../lib/ceoResponder';
import { isLLMAvailable, streamCEOResponse } from '../../lib/llm/chatService';

interface ChatThreadProps {
  conversation: ConversationRow;
}

export default function ChatThread({ conversation }: ChatThreadProps) {
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resumeGreetingSent = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ceoRow = loadCEO();
  const ceoName = ceoRow?.name ?? 'CEO';

  const isArchived = conversation.status === 'archived';

  // Check LLM availability
  const llm = isLLMAvailable();

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Load messages when conversation changes
  useEffect(() => {
    // Abort any in-progress stream
    abortRef.current?.abort();
    abortRef.current = null;
    setStreamingText(null);
    setTyping(false);

    const loaded = loadChatMessages(conversation.id);
    setMessages(loaded);

    // If this is an active conversation with existing messages and we haven't greeted yet
    if (!isArchived && loaded.length > 0 && resumeGreetingSent.current !== conversation.id) {
      resumeGreetingSent.current = conversation.id;
      // Add a context greeting from CEO
      const greetMsg: ChatMessageRow = {
        id: `msg-resume-${Date.now()}`,
        conversation_id: conversation.id,
        sender: 'ceo',
        text: `Picking up where we left off. What do you need?`,
        metadata: null,
        created_at: new Date().toISOString(),
      };
      saveChatMessage({
        id: greetMsg.id,
        conversation_id: greetMsg.conversation_id,
        sender: greetMsg.sender,
        text: greetMsg.text,
        metadata: null,
      });
      setMessages(prev => [...prev, greetMsg]);
    }

    // Focus input for active conversations
    if (!isArchived) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [conversation.id, isArchived]);

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
    saveChatMessage({
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

    const controller = streamCEOResponse(text, updatedMessages, {
      onToken: (token) => {
        setTyping(false);
        setStreamingText(prev => (prev ?? '') + token);
      },
      onDone: (fullText) => {
        setTyping(false);
        setStreamingText(null);
        const ceoMsg: ChatMessageRow = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: conversation.id,
          sender: 'ceo',
          text: fullText,
          metadata: JSON.stringify({ llm: true }),
          created_at: new Date().toISOString(),
        };
        saveChatMessage({
          id: ceoMsg.id,
          conversation_id: ceoMsg.conversation_id,
          sender: ceoMsg.sender,
          text: ceoMsg.text,
          metadata: ceoMsg.metadata,
        });
        setMessages(prev => [...prev, ceoMsg]);
        abortRef.current = null;
      },
      onError: (error) => {
        console.error('LLM stream error:', error);
        setTyping(false);
        setStreamingText(null);
        abortRef.current = null;
        // Fallback to scripted response on error
        const responseText = getCEOResponse(text);
        const ceoMsg: ChatMessageRow = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: conversation.id,
          sender: 'ceo',
          text: responseText,
          metadata: null,
          created_at: new Date().toISOString(),
        };
        saveChatMessage({
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
      // LLM is handling it
      abortRef.current = controller;
    } else {
      // No LLM available — fallback to scripted response
      const delay = 800 + Math.random() * 1200;
      setTimeout(() => {
        setTyping(false);
        const responseText = getCEOResponse(text);
        const ceoMsg: ChatMessageRow = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: conversation.id,
          sender: 'ceo',
          text: responseText,
          metadata: null,
          created_at: new Date().toISOString(),
        };
        saveChatMessage({
          id: ceoMsg.id,
          conversation_id: ceoMsg.conversation_id,
          sender: ceoMsg.sender,
          text: ceoMsg.text,
          metadata: null,
        });
        setMessages(prev => [...prev, ceoMsg]);
      }, delay);
    }
  }, [input, conversation.id, isArchived, messages]);

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
        {llm.available && !isArchived && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-pixel text-[10px] tracking-widest text-emerald-400">
              LLM: CONNECTED
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
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={[
                'max-w-[70%] rounded-lg px-4 py-3',
                msg.sender === 'user'
                  ? 'bg-emerald-500/15 border border-emerald-500/30'
                  : msg.sender === 'system'
                    ? 'bg-zinc-700/30 border border-zinc-600/30'
                    : 'bg-zinc-800/60 border border-zinc-700/50',
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
                {msg.text}
              </div>
            </div>
          </div>
        ))}

        {/* Streaming CEO response */}
        {streamingText !== null && (
          <div className="flex justify-start">
            <div className="max-w-[70%] rounded-lg px-4 py-3 bg-zinc-800/60 border border-zinc-700/50">
              <div className="font-pixel text-[10px] tracking-wider text-yellow-300/70 mb-1.5">
                CEO {ceoName}
              </div>
              <div className="font-pixel text-[10px] tracking-wider leading-relaxed whitespace-pre-line text-zinc-300">
                {streamingText}
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
