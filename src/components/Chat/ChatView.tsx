import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Blocks } from 'lucide-react';
import { loadCEO, getFounderInfo, getSetting, setSetting } from '../../lib/database';

interface ChatMessage {
  id: string;
  sender: 'ceo' | 'user' | 'system';
  text: string;
}

type ConvoStep =
  | 'welcome'
  | 'ask_mission'
  | 'waiting_input'
  | 'acknowledging'
  | 'suggest_skills'
  | 'done';

export default function ChatView() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [step, setStep] = useState<ConvoStep>('welcome');
  const [typing, setTyping] = useState(false);
  const [meetingDone, setMeetingDone] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ceoRow = useRef(loadCEO());
  const founderInfo = useRef(getFounderInfo());

  const ceoName = ceoRow.current?.name ?? 'CEO';
  const founderName = founderInfo.current?.founderName ?? 'Founder';
  const orgName = founderInfo.current?.orgName ?? 'the organization';

  // Check if meeting already done
  useEffect(() => {
    if (getSetting('ceo_meeting_done')) {
      setMeetingDone(true);
    }
  }, []);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing]);

  // CEO message helper
  const addCeoMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}-${Math.random()}`,
      sender: 'ceo',
      text,
    }]);
  }, []);

  // Type with delay helper
  const typeWithDelay = useCallback((text: string, delay: number): Promise<void> => {
    return new Promise(resolve => {
      setTyping(true);
      setTimeout(() => {
        setTyping(false);
        addCeoMessage(text);
        resolve();
      }, delay);
    });
  }, [addCeoMessage]);

  // Onboarding conversation flow
  useEffect(() => {
    if (meetingDone) return;

    const run = async () => {
      // Step 1: Welcome
      await typeWithDelay(
        `Welcome aboard, ${founderName}. I'm ${ceoName}, your AI Chief Executive Officer.`,
        1200,
      );

      // Step 2: Ask about mission
      await typeWithDelay(
        `Before we start building our team, I want to understand what ${orgName} is trying to achieve. What's our primary mission?`,
        2000,
      );

      setStep('waiting_input');
      setTimeout(() => inputRef.current?.focus(), 100);
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingDone]);

  // Handle user sending their mission
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || step !== 'waiting_input') return;

    // Add user message
    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text,
    }]);
    setInput('');
    setStep('acknowledging');

    // CEO acknowledges
    await typeWithDelay(
      `That's a strong direction. I've noted this as our primary mission for ${orgName}.`,
      2000,
    );

    await typeWithDelay(
      `To execute on this, we'll need to equip our agents with the right skills — things like web research, email, image generation, and more.`,
      2500,
    );

    await typeWithDelay(
      `I'd recommend heading over to the Skills section to explore what capabilities are available. You can configure exactly what our agents can do.`,
      2500,
    );

    setStep('suggest_skills');

    await typeWithDelay(
      `Once you've set up skills, come back to Surveillance and we'll start hiring agents to bring this mission to life.`,
      2000,
    );

    // Mark meeting as done
    setSetting('ceo_meeting_done', 'true');
    // Save the user's mission text
    setSetting('primary_mission', text);
    setStep('done');
    setMeetingDone(true);
  }, [input, step, typeWithDelay, orgName]);

  // Post-meeting chat (placeholder for future)
  if (meetingDone && messages.length === 0) {
    return <PostMeetingChat ceoName={ceoName} />;
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
        <div className="w-8 h-8 rounded-full bg-yellow-400/20 border border-yellow-400/40 flex items-center justify-center">
          <span className="font-pixel text-[10px] text-yellow-300">♛</span>
        </div>
        <div>
          <div className="font-pixel text-[10px] tracking-wider text-yellow-300">
            CEO {ceoName}
          </div>
          <div className="font-pixel text-[7px] tracking-wider text-zinc-500">
            {typing ? 'TYPING...' : 'ONLINE'}
          </div>
        </div>
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
                  : 'bg-zinc-800/60 border border-zinc-700/50',
              ].join(' ')}
            >
              {msg.sender === 'ceo' && (
                <div className="font-pixel text-[7px] tracking-wider text-yellow-300/70 mb-1.5">
                  CEO {ceoName}
                </div>
              )}
              <div className={[
                'font-pixel text-[9px] tracking-wider leading-relaxed',
                msg.sender === 'user' ? 'text-emerald-200' : 'text-zinc-300',
              ].join(' ')}>
                {msg.text}
              </div>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
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

        {/* Skills CTA */}
        {(step === 'done' || step === 'suggest_skills') && !typing && (
          <div className="flex justify-center pt-4">
            <button
              onClick={() => navigate('/skills')}
              className="retro-button flex items-center gap-2 !text-[9px] !py-3 !px-6 tracking-widest hover:!text-emerald-400"
            >
              <Blocks size={14} />
              EXPLORE SKILLS
            </button>
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
            placeholder={
              step === 'waiting_input'
                ? 'Type your mission or goal...'
                : step === 'done' || meetingDone
                  ? 'Chat coming soon...'
                  : 'Waiting for CEO...'
            }
            disabled={step !== 'waiting_input'}
            className="flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 font-pixel text-[9px] tracking-wider text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSend}
            disabled={step !== 'waiting_input' || !input.trim()}
            className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shown after the onboarding meeting is complete on subsequent visits */
function PostMeetingChat({ ceoName }: { ceoName: string }) {
  const mission = getSetting('primary_mission');

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
        <div className="w-8 h-8 rounded-full bg-yellow-400/20 border border-yellow-400/40 flex items-center justify-center">
          <span className="font-pixel text-[10px] text-yellow-300">♛</span>
        </div>
        <div>
          <div className="font-pixel text-[10px] tracking-wider text-yellow-300">
            CEO {ceoName}
          </div>
          <div className="font-pixel text-[7px] tracking-wider text-zinc-500">
            ONLINE
          </div>
        </div>
      </div>

      {/* Mission summary + placeholder */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-lg px-6">
          {mission && (
            <div className="mb-8 p-4 rounded-lg bg-zinc-800/40 border border-zinc-700/40">
              <div className="font-pixel text-[7px] tracking-widest text-emerald-400/70 mb-2">
                PRIMARY MISSION
              </div>
              <div className="font-pixel text-[9px] tracking-wider text-zinc-300 leading-relaxed">
                {mission}
              </div>
            </div>
          )}
          <div className="font-pixel text-[9px] tracking-wider text-zinc-500 leading-relaxed">
            REAL-TIME CHAT WITH CEO {ceoName.toUpperCase()} COMING SOON.
            <br />
            <span className="text-zinc-600">
              AI-POWERED CONVERSATIONS WILL BE AVAILABLE ONCE THE BACKEND IS CONNECTED.
            </span>
          </div>
        </div>
      </div>

      {/* Disabled input */}
      <div className="px-6 py-4 border-t border-zinc-800">
        <div className="flex items-center gap-3">
          <input
            type="text"
            disabled
            placeholder="AI chat coming soon..."
            className="flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 font-pixel text-[9px] tracking-wider text-zinc-200 placeholder-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <button
            disabled
            className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
