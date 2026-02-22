import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Copy, Archive } from 'lucide-react';
import {
  type ConversationRow, type ChatMessageRow,
  loadChatMessages, saveChatMessage, loadCEO, loadAgents,
} from '../../lib/database';
import { getCEOResponse } from '../../lib/ceoResponder';
import { isLLMAvailable, streamCEOResponse, streamAgentResponse, isAgentLLMAvailable, type LLMAvailability, type AgentChatInfo } from '../../lib/llm/chatService';
import { extractMemories } from '../../lib/memory';
import RichMessageContent from './ToolCallBlock';

/** Strip complete and incomplete <tool_call>/<task_plan>/<work_request> blocks from streaming text
 *  so the user never sees raw JSON while the CEO/agent is still typing. */
function stripStreamingBlocks(text: string): string {
  // Remove complete blocks
  let clean = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  clean = clean.replace(/<task_plan>[\s\S]*?<\/task_plan>/g, '');
  clean = clean.replace(/<work_request>[\s\S]*?<\/work_request>/g, '');
  // Remove incomplete (still streaming) blocks — opening tag with no closing tag
  clean = clean.replace(/<tool_call>[\s\S]*$/g, '');
  clean = clean.replace(/<task_plan>[\s\S]*$/g, '');
  clean = clean.replace(/<work_request>[\s\S]*$/g, '');
  return clean.trim();
}

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

  // Agent chat detection
  const isAgentChat = conversation.type.startsWith('agent_chat:');
  const agentIdFromType = isAgentChat ? conversation.type.split(':')[1] : null;
  const [agentInfo, setAgentInfo] = useState<{ id: string; name: string; role: string; model: string; color: string } | null>(null);
  const [agentFired, setAgentFired] = useState(false);

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

  // Load agent info for agent_chat conversations
  useEffect(() => {
    if (!isAgentChat || !agentIdFromType) return;
    let cancelled = false;
    (async () => {
      const agents = await loadAgents();
      const found = agents.find(a => a.id === agentIdFromType);
      if (cancelled) return;
      if (found) {
        setAgentInfo({ id: found.id, name: found.name, role: found.role, model: found.model, color: found.color });
        setAgentFired(false);
        // Check agent's LLM availability too
        const agentAvail = await isAgentLLMAvailable(found.model);
        if (!cancelled) setLlm(agentAvail);
      } else {
        setAgentFired(true);
        setAgentInfo(null);
      }
    })();
    return () => { cancelled = true; };
  }, [conversation.id, isAgentChat, agentIdFromType]);

  // Display values — use agent info when in agent chat, CEO otherwise
  const chatTargetName = isAgentChat && agentInfo ? agentInfo.name : `CEO ${ceoName}`;
  const chatTargetColor = isAgentChat && agentInfo ? agentInfo.color : '#facc15';
  const chatSender = isAgentChat && agentInfo ? agentInfo.id : 'ceo';

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

  /**
   * Core helper: stream a response for the given prompt and conversation history.
   * Dispatches to streamAgentResponse for agent chats, streamCEOResponse for CEO chats.
   * Used by both handleSend (user messages) and the auto-resume listener (skill approvals).
   */
  const invokeResponse = useCallback(async (promptText: string, currentMessages: ChatMessageRow[]) => {
    setTyping(true);

    const useAgent = isAgentChat && agentInfo && !agentFired;
    const sender = useAgent ? agentInfo!.id : 'ceo';

    const callbacks = {
      onToken: (token: string) => {
        setTyping(false);
        setStreamingText(prev => (prev ?? '') + token);
      },
      onDone: async (fullText: string) => {
        setTyping(false);
        setStreamingText(null);
        setLlmError(null);

        // Check for work_request blocks from agent responses
        let displayText = fullText;
        if (isAgentChat && agentInfo) {
          const { parseWorkRequests, stripWorkRequestBlocks } = await import('../../lib/taskDispatcher');
          const workRequests = parseWorkRequests(fullText);
          if (workRequests.length > 0) {
            // Strip work_request blocks from displayed/saved message
            displayText = stripWorkRequestBlocks(fullText);
            // Dispatch each work request as a CEO task
            const { dispatchTaskPlan } = await import('../../lib/taskDispatcher');
            for (const req of workRequests) {
              await dispatchTaskPlan(
                [{ title: `${agentInfo.name}: ${req.reason}`, toolCalls: [{ name: req.skill_id, arguments: { ...req.arguments, command: req.command } }] }],
                agentInfo.model,
                { conversationId: conversation.id, founderPresent: true, agentId: agentInfo.id },
              );
            }
          }
        }

        const respMsg: ChatMessageRow = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: conversation.id,
          sender,
          text: displayText,
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
        const withResp = [...currentMessages, respMsg];
        setMessages(prev => [...prev, respMsg]);
        abortRef.current = null;
        maybeExtractMemories(withResp);
      },
      onError: async (error: unknown) => {
        console.error('LLM stream error:', error);
        setTyping(false);
        setStreamingText(null);
        abortRef.current = null;
        setLlmError(parseLLMError(error));

        if (useAgent) {
          // Agent error — show error message (no canned fallback for agents)
          const errMsg: ChatMessageRow = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            conversation_id: conversation.id,
            sender,
            text: `*${agentInfo!.name} encountered an error: ${parseLLMError(error)}*`,
            metadata: { error: true },
            created_at: new Date().toISOString(),
          };
          await saveChatMessage({ id: errMsg.id, conversation_id: errMsg.conversation_id, sender: errMsg.sender, text: errMsg.text, metadata: errMsg.metadata });
          setMessages(prev => [...prev, errMsg]);
        } else {
          // CEO fallback to canned response
          const responseText = await getCEOResponse(promptText);
          const ceoMsg: ChatMessageRow = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            conversation_id: conversation.id,
            sender: 'ceo',
            text: responseText,
            metadata: null,
            created_at: new Date().toISOString(),
          };
          await saveChatMessage({ id: ceoMsg.id, conversation_id: ceoMsg.conversation_id, sender: ceoMsg.sender, text: ceoMsg.text, metadata: null });
          const withCeo = [...currentMessages, ceoMsg];
          setMessages(prev => [...prev, ceoMsg]);
          maybeExtractMemories(withCeo);
        }
      },
    };

    let controller: AbortController | null = null;
    if (useAgent) {
      const agentChatInfo: AgentChatInfo = { id: agentInfo!.id, name: agentInfo!.name, role: agentInfo!.role, model: agentInfo!.model };
      controller = await streamAgentResponse(agentChatInfo, promptText, currentMessages, callbacks);
    } else {
      controller = await streamCEOResponse(promptText, currentMessages, callbacks);
    }

    if (controller) {
      abortRef.current = controller;
    } else {
      // No LLM available — fallback
      setTyping(false);
      if (useAgent) {
        const errMsg: ChatMessageRow = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: conversation.id,
          sender,
          text: `*${agentInfo!.name} is offline — no API key found for ${agentInfo!.model}. Add it in The Vault.*`,
          metadata: { error: true },
          created_at: new Date().toISOString(),
        };
        await saveChatMessage({ id: errMsg.id, conversation_id: errMsg.conversation_id, sender: errMsg.sender, text: errMsg.text, metadata: errMsg.metadata });
        setMessages(prev => [...prev, errMsg]);
      } else {
        const delay = 800 + Math.random() * 1200;
        setTimeout(async () => {
          setTyping(false);
          const responseText = await getCEOResponse(promptText);
          const ceoMsg: ChatMessageRow = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            conversation_id: conversation.id,
            sender: 'ceo',
            text: responseText,
            metadata: null,
            created_at: new Date().toISOString(),
          };
          await saveChatMessage({ id: ceoMsg.id, conversation_id: ceoMsg.conversation_id, sender: ceoMsg.sender, text: ceoMsg.text, metadata: null });
          const withCeo = [...currentMessages, ceoMsg];
          setMessages(prev => [...prev, ceoMsg]);
          maybeExtractMemories(withCeo);
        }, delay);
      }
    }
  }, [conversation.id, maybeExtractMemories, isAgentChat, agentInfo, agentFired]);

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

    await invokeResponse(text, updatedMessages);
  }, [input, conversation.id, isArchived, messages, invokeResponse]);

  // Auto-submit: when a "TELL ME NOW" button is clicked, auto-submit text to the chat
  useEffect(() => {
    const handler = async (e: Event) => {
      const { text } = (e as CustomEvent).detail as { text: string };
      if (!text || isArchived || abortRef.current) return;

      // Simulate a user message send
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
      const updatedMessages = [...messagesRef.current, userMsg];
      setMessages(prev => [...prev, userMsg]);
      await invokeResponse(text, updatedMessages);
    };

    window.addEventListener('chat-auto-submit', handler);
    return () => window.removeEventListener('chat-auto-submit', handler);
  }, [conversation.id, isArchived, invokeResponse]);

  // Auto-resume: when a skill is approved in chat, re-invoke the CEO to fulfill the original request
  useEffect(() => {
    const handler = async (e: Event) => {
      const { skillName } = (e as CustomEvent).detail as { skillId: string; skillName: string };
      // Guard: skip if already streaming or conversation is archived
      if (abortRef.current || isArchived) return;

      // Post a system message
      const sysMsg: ChatMessageRow = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        conversation_id: conversation.id,
        sender: 'system',
        text: `${skillName} has been enabled. Resuming your request...`,
        metadata: null,
        created_at: new Date().toISOString(),
      };
      await saveChatMessage({
        id: sysMsg.id,
        conversation_id: sysMsg.conversation_id,
        sender: sysMsg.sender,
        text: sysMsg.text,
        metadata: null,
      });
      setMessages(prev => [...prev, sysMsg]);

      // Brief delay for DB propagation (skill enable + approval update)
      await new Promise(r => setTimeout(r, 300));

      // Re-invoke CEO with resume prompt — system prompt is rebuilt fresh, so CEO sees the skill as enabled
      const currentMsgs = [...messagesRef.current, sysMsg];
      const resumePrompt = `The founder just approved enabling '${skillName}'. It is now active. Look back at the conversation and fulfill the founder's most recent request that needed this skill. Proceed immediately.`;
      await invokeResponse(resumePrompt, currentMsgs);
    };

    window.addEventListener('skill-approved-in-chat', handler);
    return () => window.removeEventListener('skill-approved-in-chat', handler);
  }, [conversation.id, isArchived, invokeResponse]);

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
        <div className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{
            backgroundColor: chatTargetColor + '33',
            borderColor: chatTargetColor + '66',
            borderWidth: '1px',
          }}
        >
          <span className="font-pixel text-[13px]" style={{ color: chatTargetColor }}>
            {isAgentChat && agentInfo ? agentInfo.name.charAt(0) : '\u265B'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-pixel text-[13px] tracking-wider truncate" style={{ color: chatTargetColor }}>
            {chatTargetName}
            {agentFired && <span className="text-red-400 text-[9px] ml-2">(FIRED — CEO responding)</span>}
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
              HARD STOP
            </span>
            <span className="font-pixel text-[8px] tracking-wider text-red-400/60">
              ${llm.budgetSpent?.toFixed(2)} / ${llm.budgetLimit?.toFixed(2)}
            </span>
          </div>
        )}
        {llm.available && !isArchived && llm.budgetExceeded && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="font-pixel text-[10px] tracking-widest text-amber-400">
              BUDGET EXCEEDED
            </span>
            <span className="font-pixel text-[8px] tracking-wider text-amber-400/60">
              ${llm.budgetSpent?.toFixed(2)} / ${llm.budgetLimit?.toFixed(2)} (grace zone)
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
                className="self-center mr-2 opacity-60 group-hover/msg:opacity-100 transition-opacity text-zinc-300 hover:text-emerald-400"
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
              {msg.sender !== 'user' && msg.sender !== 'system' && (
                <div className="font-pixel text-[10px] tracking-wider mb-1.5" style={{ color: chatTargetColor, opacity: 0.7 }}>
                  {chatTargetName}
                </div>
              )}
              <div className={[
                'font-pixel text-[10px] tracking-wider leading-relaxed whitespace-pre-line',
                msg.sender === 'user' ? 'text-emerald-200' : 'text-zinc-300',
              ].join(' ')}>
                {msg.sender !== 'user' && msg.sender !== 'system' ? <RichMessageContent text={msg.text} metadata={msg.metadata} messageId={msg.id} /> : msg.text}
              </div>
            </div>
          </div>
        ))}

        {/* Streaming CEO response — strip tool_call/task_plan blocks so raw JSON is never visible */}
        {streamingText !== null && (() => {
          const displayText = stripStreamingBlocks(streamingText);
          return displayText ? (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg px-4 py-3 bg-zinc-800/60 border border-zinc-700/50">
                <div className="font-pixel text-[10px] tracking-wider mb-1.5" style={{ color: chatTargetColor, opacity: 0.7 }}>
                  {chatTargetName}
                </div>
                <div className="font-pixel text-[10px] tracking-wider leading-relaxed whitespace-pre-line text-zinc-300">
                  <RichMessageContent text={displayText} />
                  <span className="inline-block w-1.5 h-3 animate-pulse ml-0.5 align-middle" style={{ backgroundColor: chatTargetColor + '99' }} />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex justify-start">
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-4 py-3">
                <div className="font-pixel text-[10px] tracking-wider mb-1.5" style={{ color: chatTargetColor, opacity: 0.7 }}>
                  {chatTargetName}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-pixel-cyan/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-pixel-cyan/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-pixel-cyan/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                  <span className="font-pixel text-[7px] tracking-wider text-pixel-cyan/40 ml-1">EXECUTING...</span>
                </div>
              </div>
            </div>
          );
        })()}

        {typing && (
          <div className="flex justify-start">
            <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ animationDelay: '0ms', backgroundColor: chatTargetColor + '99' }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ animationDelay: '150ms', backgroundColor: chatTargetColor + '99' }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ animationDelay: '300ms', backgroundColor: chatTargetColor + '99' }} />
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
            placeholder={isArchived ? 'This conversation is archived' : `Message ${chatTargetName}...`}
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
