import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, ExternalLink, Minus, X, Plus, Maximize2, Minimize2 } from 'lucide-react';
import {
  type ConversationRow, type ChatMessageRow,
  loadConversations, saveConversation, loadChatMessages, saveChatMessage, loadCEO,
} from '../../lib/database';
import { getCEOResponse } from '../../lib/ceoResponder';
import { isLLMAvailable, streamCEOResponse, streamAgentResponse, isAgentLLMAvailable, type AgentChatInfo } from '../../lib/llm/chatService';
import RichMessageContent from '../Chat/ToolCallBlock';

/** Strip complete and incomplete <tool_call>/<task_plan>/<work_request> blocks from streaming text
 *  so the user never sees raw JSON while the CEO/agent is still typing. */
function stripStreamingBlocks(text: string): string {
  let clean = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  clean = clean.replace(/<task_plan>[\s\S]*?<\/task_plan>/g, '');
  clean = clean.replace(/<work_request>[\s\S]*?<\/work_request>/g, '');
  clean = clean.replace(/<tool_call>[\s\S]*$/g, '');
  clean = clean.replace(/<task_plan>[\s\S]*$/g, '');
  clean = clean.replace(/<work_request>[\s\S]*$/g, '');
  return clean.trim();
}

export interface QuickChatAgent {
  id: string;
  name: string;
  role: string;
  model: string;
  color: string;
}

interface QuickChatPanelProps {
  onClose: () => void;
  /** When provided and not 'ceo', chats with this specific agent instead of the CEO. */
  agent?: QuickChatAgent | null;
}

/**
 * Compact chat panel for the Surveillance view.
 * When `agent` is provided (non-CEO), chats with that agent.
 * Otherwise chats with the CEO.
 */
export default function QuickChatPanel({ onClose, agent }: QuickChatPanelProps) {
  const navigate = useNavigate();
  const isCEO = !agent || agent.id === 'ceo';
  const chatTargetName = agent?.name ?? 'CEO';
  const chatTargetColor = agent?.color ?? '#facc15'; // yellow for CEO

  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [ceoName, setCeoName] = useState('CEO');
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Resolve display name (CEO uses DB name, agents use prop name)
  const displayName = isCEO ? `CEO ${ceoName}` : chatTargetName;

  // Load or create conversation on mount
  useEffect(() => {
    // Clear stale state immediately when chat target changes
    setConversation(null);
    setMessages([]);
    setStreamingText(null);
    setTyping(false);

    let cancelled = false;
    (async () => {
      const ceo = await loadCEO();
      if (!cancelled) setCeoName(ceo?.name ?? 'CEO');

      // Find conversation scoped to this chat target
      const convos = await loadConversations();
      let active: ConversationRow | undefined;
      if (isCEO) {
        active = convos.find(c => c.status === 'active' && c.type === 'chat');
      } else {
        // Agent-specific: look for conversation tagged with agent ID
        active = convos.find(c => c.status === 'active' && c.type === `agent_chat:${agent!.id}`);
      }

      if (active) {
        if (!cancelled) {
          setConversation(active);
          const msgs = await loadChatMessages(active.id);
          setMessages(msgs);
        }
      } else {
        const convType = isCEO ? 'chat' : `agent_chat:${agent!.id}`;
        const convTitle = isCEO ? 'Quick Chat' : `Chat with ${chatTargetName}`;
        const newConv: ConversationRow = {
          id: `conv-${Date.now()}`,
          title: convTitle,
          type: convType,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await saveConversation({ id: newConv.id, title: newConv.title, type: newConv.type, status: newConv.status });
        if (!cancelled) setConversation(newConv);
      }
    })();
    return () => { cancelled = true; };
  }, [agent?.id]);

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

  // Listen for external message changes
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
    window.dispatchEvent(new Event('chat-messages-changed'));
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setTyping(true);

    // Determine sender label for agent responses
    const responderSender = isCEO ? 'ceo' : agent!.id;

    const streamCallbacks = {
      onToken: (token: string) => {
        setTyping(false);
        setStreamingText(prev => (prev ?? '') + token);
      },
      onDone: async (fullText: string) => {
        setTyping(false);
        setStreamingText(null);
        const respMsg: ChatMessageRow = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: conversation.id,
          sender: responderSender,
          text: fullText,
          metadata: { llm: true },
          created_at: new Date().toISOString(),
        };
        await saveChatMessage({
          id: respMsg.id,
          conversation_id: respMsg.conversation_id,
          sender: respMsg.sender,
          text: respMsg.text,
          metadata: respMsg.metadata,
        });
        setMessages(prev => [...prev, respMsg]);
        window.dispatchEvent(new Event('chat-messages-changed'));
        abortRef.current = null;
      },
      onError: async () => {
        setTyping(false);
        setStreamingText(null);
        abortRef.current = null;
        // Fallback: CEO uses canned response, agents show error
        if (isCEO) {
          const responseText = await getCEOResponse(text);
          const respMsg: ChatMessageRow = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            conversation_id: conversation.id,
            sender: 'ceo',
            text: responseText,
            metadata: null,
            created_at: new Date().toISOString(),
          };
          await saveChatMessage({
            id: respMsg.id,
            conversation_id: respMsg.conversation_id,
            sender: respMsg.sender,
            text: respMsg.text,
            metadata: null,
          });
          setMessages(prev => [...prev, respMsg]);
        } else {
          const errMsg: ChatMessageRow = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            conversation_id: conversation.id,
            sender: agent!.id,
            text: `*${chatTargetName} is offline — no LLM available for model "${agent!.model}".*`,
            metadata: { error: true },
            created_at: new Date().toISOString(),
          };
          await saveChatMessage({
            id: errMsg.id,
            conversation_id: errMsg.conversation_id,
            sender: errMsg.sender,
            text: errMsg.text,
            metadata: errMsg.metadata,
          });
          setMessages(prev => [...prev, errMsg]);
        }
        window.dispatchEvent(new Event('chat-messages-changed'));
      },
    };

    let controller: AbortController | null = null;
    if (isCEO) {
      controller = await streamCEOResponse(text, updated, streamCallbacks);
    } else {
      const agentInfo: AgentChatInfo = { id: agent!.id, name: agent!.name, role: agent!.role, model: agent!.model };
      controller = await streamAgentResponse(agentInfo, text, updated, streamCallbacks);
    }

    if (controller) {
      abortRef.current = controller;
    } else {
      // No LLM available — fallback
      setTyping(false);
      if (isCEO) {
        const responseText = await getCEOResponse(text);
        const respMsg: ChatMessageRow = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: conversation.id,
          sender: 'ceo',
          text: responseText,
          metadata: null,
          created_at: new Date().toISOString(),
        };
        await saveChatMessage({
          id: respMsg.id,
          conversation_id: respMsg.conversation_id,
          sender: respMsg.sender,
          text: respMsg.text,
          metadata: null,
        });
        setMessages(prev => [...prev, respMsg]);
      } else {
        const errMsg: ChatMessageRow = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: conversation.id,
          sender: agent!.id,
          text: `*${chatTargetName} is offline — no API key found for ${agent!.model}. Add it in The Vault.*`,
          metadata: { error: true },
          created_at: new Date().toISOString(),
        };
        await saveChatMessage({
          id: errMsg.id,
          conversation_id: errMsg.conversation_id,
          sender: errMsg.sender,
          text: errMsg.text,
          metadata: errMsg.metadata,
        });
        setMessages(prev => [...prev, errMsg]);
      }
      window.dispatchEvent(new Event('chat-messages-changed'));
    }
  }, [input, conversation, messages, isCEO, agent]);

  const handleNewChat = useCallback(async () => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    setStreamingText(null);
    setTyping(false);

    const convType = isCEO ? 'chat' : `agent_chat:${agent!.id}`;
    const convTitle = isCEO ? 'Quick Chat' : `Chat with ${chatTargetName}`;
    const newConv: ConversationRow = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: convTitle,
      type: convType,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await saveConversation({ id: newConv.id, title: newConv.title, type: newConv.type, status: newConv.status });
    setConversation(newConv);
    setMessages([]);
    setInput('');
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [isCEO, agent]);

  // Determine colors for this chat target
  const accentColor = isCEO ? 'yellow' : 'emerald';
  const dotColor = isCEO ? 'bg-yellow-400' : 'bg-emerald-400';
  const nameColor = isCEO ? 'text-yellow-300/70' : 'text-emerald-300/70';
  const cursorColor = isCEO ? 'bg-yellow-300/60' : 'bg-emerald-300/60';
  const bounceColor = isCEO ? 'bg-yellow-300/60' : 'bg-emerald-300/60';

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-900/90 border border-yellow-400/30 hover:border-yellow-400/60 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full ${dotColor} animate-pulse`} />
        <span className="font-pixel text-[9px] tracking-widest" style={{ color: chatTargetColor }}>
          {isCEO ? 'CEO CHAT' : `${chatTargetName} CHAT`}
        </span>
        {messages.length > 0 && (
          <span className="font-pixel text-[8px] text-zinc-500">{messages.length}</span>
        )}
      </button>
    );
  }

  return (
    <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-30 ${expanded ? 'w-[800px]' : 'w-[600px]'} flex flex-col rounded-lg overflow-hidden border-2 border-pixel-crt-border bg-pixel-bg shadow-2xl shadow-black/60 transition-all duration-200`}>
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gradient-to-r from-pixel-crt-border to-zinc-700 border-b border-pixel-crt-border">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dotColor} animate-pulse`} />
          <span className="font-pixel text-[8px] tracking-widest text-zinc-200">
            {displayName} — QUICK CHAT
          </span>
          {!isCEO && agent && (
            <span className="font-pixel text-[6px] tracking-wider text-zinc-500">{agent.role}</span>
          )}
          <button
            onClick={handleNewChat}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
            title="New chat"
          >
            <Plus size={9} className="text-emerald-400" />
            <span className="font-pixel text-[6px] tracking-widest text-emerald-400">NEW</span>
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={async () => {
              if (abortRef.current && streamingText) {
                abortRef.current.abort();
                abortRef.current = null;
                const partial = streamingText;
                setStreamingText(null);
                if (conversation && partial.trim()) {
                  const ceoMsg = {
                    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    conversation_id: conversation.id,
                    sender: (isCEO ? 'ceo' : agent!.id) as string,
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
            onClick={() => setExpanded(prev => !prev)}
            className="p-1 hover:bg-zinc-600/50 rounded transition-colors"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded
              ? <Minimize2 size={10} className="text-zinc-400 hover:text-emerald-400" />
              : <Maximize2 size={10} className="text-zinc-400 hover:text-emerald-400" />
            }
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
      <div ref={scrollRef} className={`${expanded ? 'h-[480px]' : 'h-[240px]'} overflow-y-auto no-scrollbar px-3 py-2 space-y-2 transition-all duration-200`}>
        {messages.length === 0 && !typing && (
          <div className="flex items-center justify-center h-full">
            <span className="font-pixel text-[8px] text-zinc-600 tracking-wider">
              {isCEO ? `Send a message to CEO ${ceoName}` : `Send a message to ${chatTargetName}`}
            </span>
          </div>
        )}

        {messages.map(msg => {
          const isUser = msg.sender === 'user';
          return (
            <div
              key={msg.id}
              className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={[
                  'rounded px-3 py-2 max-w-[80%]',
                  isUser
                    ? 'bg-emerald-500/15 border border-emerald-500/30'
                    : 'bg-zinc-800/60 border border-zinc-700/50',
                ].join(' ')}
              >
                {!isUser && (
                  <div className={`font-pixel text-[7px] tracking-wider mb-1`} style={{ color: chatTargetColor, opacity: 0.7 }}>
                    {displayName}
                  </div>
                )}
                <div className={[
                  'font-pixel text-[8px] tracking-wider leading-relaxed whitespace-pre-line',
                  isUser ? 'text-emerald-200' : 'text-zinc-300',
                ].join(' ')}>
                  {!isUser ? <RichMessageContent text={msg.text} /> : msg.text}
                </div>
              </div>
            </div>
          );
        })}

        {streamingText !== null && (() => {
          const displayText = stripStreamingBlocks(streamingText);
          return displayText ? (
            <div className="flex justify-start">
              <div className="rounded px-3 py-2 max-w-[80%] bg-zinc-800/60 border border-zinc-700/50">
                <div className="font-pixel text-[7px] tracking-wider mb-1" style={{ color: chatTargetColor, opacity: 0.7 }}>
                  {displayName}
                </div>
                <div className="font-pixel text-[8px] tracking-wider leading-relaxed whitespace-pre-line text-zinc-300">
                  <RichMessageContent text={displayText} />
                  <span className={`inline-block w-1 h-2 ${cursorColor} animate-pulse ml-0.5 align-middle`} />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex justify-start">
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded px-3 py-2">
                <div className="flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-pixel-cyan/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 rounded-full bg-pixel-cyan/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 rounded-full bg-pixel-cyan/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                  <span className="font-pixel text-[6px] tracking-wider text-pixel-cyan/40 ml-1">EXECUTING...</span>
                </div>
              </div>
            </div>
          );
        })()}

        {typing && (
          <div className="flex justify-start">
            <div className="bg-zinc-800/60 border border-zinc-700/50 rounded px-3 py-2">
              <div className="flex items-center gap-1">
                <span className={`w-1 h-1 rounded-full ${bounceColor} animate-bounce`} style={{ animationDelay: '0ms' }} />
                <span className={`w-1 h-1 rounded-full ${bounceColor} animate-bounce`} style={{ animationDelay: '150ms' }} />
                <span className={`w-1 h-1 rounded-full ${bounceColor} animate-bounce`} style={{ animationDelay: '300ms' }} />
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
            placeholder={isCEO ? 'Message CEO...' : `Message ${chatTargetName}...`}
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
