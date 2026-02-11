import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Blocks, ClipboardCheck, Check } from 'lucide-react';
import { loadCEO, getFounderInfo, getSetting, setSetting, saveMission, saveSkill, loadApprovals, saveApproval, getVaultEntryByService } from '../../lib/database';
import { getServiceForModel } from '../../lib/models';
import { skills as skillDefinitions, type SkillDefinition } from '../../data/skillDefinitions';
import { recommendSkills } from '../../lib/skillRecommender';

interface ChatMessage {
  id: string;
  sender: 'ceo' | 'user' | 'system';
  text: string;
  /** Special message type for inline skill approval card */
  skillCard?: {
    recommendations: SkillDefinition[];
  };
}

type ConvoStep =
  | 'welcome'
  | 'ask_mission'
  | 'waiting_input'
  | 'acknowledging'
  | 'recommending_skills'
  | 'waiting_skill_approval'
  | 'skills_enabled'
  | 'suggest_skills'
  | 'done';

// ---------------------------------------------------------------------------
// Helpers (duplicated from SkillsView to avoid tight coupling)
// ---------------------------------------------------------------------------

function getRequiredService(skill: SkillDefinition, model: string | null): string | null {
  if (skill.serviceType === 'fixed') return skill.fixedService ?? null;
  if (model) return getServiceForModel(model);
  return null;
}

function hasApiKey(service: string): boolean {
  return getVaultEntryByService(service) !== null;
}

function ensureApproval(service: string, skillName: string, model: string | null): void {
  const pending = loadApprovals();
  const alreadyRequested = pending.some(a => {
    try {
      const meta = JSON.parse(a.metadata ?? '{}');
      return meta.service === service;
    } catch { return false; }
  });
  if (!alreadyRequested) {
    saveApproval({
      id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'api_key_request',
      title: `API Key Required: ${service}`,
      description: `Skill "${skillName}" requires a ${service} API key to function.`,
      status: 'pending',
      metadata: JSON.stringify({ service, skillId: skillName, model }),
    });
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ChatView() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [step, setStep] = useState<ConvoStep>('welcome');
  const [typing, setTyping] = useState(false);
  const [meetingDone, setMeetingDone] = useState(false);
  const [recommendedSkills, setRecommendedSkills] = useState<SkillDefinition[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [needsApprovalNav, setNeedsApprovalNav] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onboardingRan = useRef(false);
  const missionTextRef = useRef('');

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
  const addCeoMessage = useCallback((text: string, extra?: Partial<ChatMessage>) => {
    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}-${Math.random()}`,
      sender: 'ceo',
      text,
      ...extra,
    }]);
  }, []);

  // Type with delay helper
  const typeWithDelay = useCallback((text: string, delay: number, extra?: Partial<ChatMessage>): Promise<void> => {
    return new Promise(resolve => {
      setTyping(true);
      setTimeout(() => {
        setTyping(false);
        addCeoMessage(text, extra);
        resolve();
      }, delay);
    });
  }, [addCeoMessage]);

  // Onboarding conversation flow
  useEffect(() => {
    if (meetingDone) return;
    if (onboardingRan.current) return;
    onboardingRan.current = true;

    const run = async () => {
      await typeWithDelay(
        `Welcome aboard, ${founderName}. I'm ${ceoName}, your AI Chief Executive Officer.`,
        1200,
      );
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

    missionTextRef.current = text;

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

    // Recommend skills based on mission text
    const recommendedIds = recommendSkills(text);
    const recommended = recommendedIds
      .map(id => skillDefinitions.find(s => s.id === id))
      .filter((s): s is SkillDefinition => s !== undefined);

    if (recommended.length > 0) {
      setRecommendedSkills(recommended);
      setSelectedSkillIds(new Set(recommended.map(s => s.id)));

      setStep('recommending_skills');

      await typeWithDelay(
        `Based on your mission, I'd recommend enabling these skills for our agents:`,
        2000,
        { skillCard: { recommendations: recommended } },
      );

      setStep('waiting_skill_approval');
    } else {
      // Fallback — no specific skills matched (unlikely since research-web is always added)
      await typeWithDelay(
        `I'd recommend heading over to the Skills section to explore what capabilities are available.`,
        2500,
      );
      setStep('suggest_skills');
      finalizeMeeting(text);
    }
  }, [input, step, typeWithDelay, orgName]);

  // Toggle a skill in the approval card
  const toggleSkillSelection = useCallback((skillId: string) => {
    setSelectedSkillIds(prev => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  }, []);

  // Approve & enable selected skills
  const handleApproveSkills = useCallback(async () => {
    if (step !== 'waiting_skill_approval') return;

    const selected = recommendedSkills.filter(s => selectedSkillIds.has(s.id));
    const missingServices = new Set<string>();

    for (const skill of selected) {
      let model: string | null = null;
      if (skill.serviceType === 'llm' && skill.defaultModel) {
        model = skill.defaultModel;
      }

      saveSkill(skill.id, true, model);

      const service = getRequiredService(skill, model);
      if (service && !hasApiKey(service)) {
        ensureApproval(service, skill.name, model);
        missingServices.add(service);
      }
    }

    // Dispatch so NavigationRail badge updates
    window.dispatchEvent(new Event('approvals-changed'));

    setStep('skills_enabled');

    const enabledCount = selected.length;

    if (missingServices.size > 0) {
      const serviceList = Array.from(missingServices).join(', ');
      await typeWithDelay(
        `I've enabled ${enabledCount} skill${enabledCount > 1 ? 's' : ''}. Some require API keys (${serviceList}) — check the Approvals page to provide them.`,
        2000,
      );
      setNeedsApprovalNav(true);
    } else {
      await typeWithDelay(
        `All ${enabledCount} skill${enabledCount > 1 ? 's' : ''} are configured and ready to go. Your agents can start executing on our mission.`,
        2000,
      );
    }

    await typeWithDelay(
      `Once we're set, head to Surveillance and we'll start hiring agents to bring this mission to life.`,
      2000,
    );

    finalizeMeeting(missionTextRef.current);
    setStep('done');
    setMeetingDone(true);
  }, [step, recommendedSkills, selectedSkillIds, typeWithDelay]);

  // Skip skill approval
  const handleSkipSkills = useCallback(async () => {
    if (step !== 'waiting_skill_approval') return;
    setStep('skills_enabled');

    await typeWithDelay(
      `No problem. You can always configure skills later from the Skills page.`,
      1500,
    );

    await typeWithDelay(
      `Head to Surveillance when you're ready and we'll start hiring agents.`,
      2000,
    );

    finalizeMeeting(missionTextRef.current);
    setStep('done');
    setMeetingDone(true);
  }, [step, typeWithDelay]);

  // Save meeting artifacts
  function finalizeMeeting(missionText: string) {
    setSetting('ceo_meeting_done', 'true');
    setSetting('primary_mission', missionText);
    saveMission({
      id: `mission-${Date.now()}`,
      title: missionText,
      status: 'in_progress',
      assignee: ceoName,
      priority: 'critical',
      due_date: null,
    });
  }

  // Post-meeting chat (placeholder for future)
  if (meetingDone && messages.length === 0) {
    return <PostMeetingChat ceoName={ceoName} />;
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
        <div className="w-8 h-8 rounded-full bg-yellow-400/20 border border-yellow-400/40 flex items-center justify-center">
          <span className="font-pixel text-[10px] text-yellow-300">{'\u265B'}</span>
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

              {/* Inline Skill Approval Card */}
              {msg.skillCard && (
                <SkillApprovalCard
                  recommendations={msg.skillCard.recommendations}
                  selectedIds={selectedSkillIds}
                  onToggle={toggleSkillSelection}
                  onApprove={handleApproveSkills}
                  onSkip={handleSkipSkills}
                  disabled={step !== 'waiting_skill_approval'}
                />
              )}
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

        {/* CTA Buttons */}
        {step === 'done' && !typing && (
          <div className="flex justify-center gap-3 pt-4">
            {needsApprovalNav ? (
              <button
                onClick={() => navigate('/approvals')}
                className="retro-button flex items-center gap-2 !text-[9px] !py-3 !px-6 tracking-widest hover:!text-amber-400"
              >
                <ClipboardCheck size={14} />
                GO TO APPROVALS
              </button>
            ) : (
              <button
                onClick={() => navigate('/skills')}
                className="retro-button flex items-center gap-2 !text-[9px] !py-3 !px-6 tracking-widest hover:!text-emerald-400"
              >
                <Blocks size={14} />
                EXPLORE SKILLS
              </button>
            )}
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

// ---------------------------------------------------------------------------
// Inline Skill Approval Card
// ---------------------------------------------------------------------------

function SkillApprovalCard({
  recommendations,
  selectedIds,
  onToggle,
  onApprove,
  onSkip,
  disabled,
}: {
  recommendations: SkillDefinition[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onApprove: () => void;
  onSkip: () => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-3 rounded-lg border border-yellow-400/30 bg-yellow-400/[0.04] overflow-hidden">
      {/* Card header */}
      <div className="px-3 py-2 border-b border-yellow-400/20 bg-yellow-400/[0.06]">
        <div className="font-pixel text-[8px] tracking-widest text-yellow-300">
          {'\u265B'} CEO RECOMMENDS
        </div>
      </div>

      {/* Skill list */}
      <div className="px-3 py-2 space-y-2">
        {recommendations.map(skill => {
          const Icon = skill.icon;
          const checked = selectedIds.has(skill.id);
          return (
            <label
              key={skill.id}
              className={`flex items-start gap-2.5 py-1.5 cursor-pointer ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
              onClick={e => { e.preventDefault(); if (!disabled) onToggle(skill.id); }}
            >
              <div className={`
                w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center mt-0.5 transition-colors
                ${checked
                  ? 'bg-emerald-500 border-emerald-400'
                  : 'bg-zinc-800 border-zinc-600'
                }
              `}>
                {checked && <Check size={10} className="text-white" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Icon size={12} className="text-zinc-400 flex-shrink-0" />
                  <span className="font-pixel text-[8px] tracking-wider text-zinc-200">
                    {skill.name}
                  </span>
                </div>
                <div className="font-pixel text-[7px] tracking-wider text-zinc-500 leading-relaxed mt-0.5">
                  {skill.description}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {/* Action buttons */}
      {!disabled && (
        <div className="flex items-center justify-between px-3 py-2.5 border-t border-yellow-400/20 bg-yellow-400/[0.03]">
          <button
            onClick={onSkip}
            className="font-pixel text-[7px] tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            SKIP
          </button>
          <button
            onClick={onApprove}
            disabled={selectedIds.size === 0}
            className="retro-button !text-[8px] !py-1.5 !px-4 tracking-widest hover:!text-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            APPROVE & ENABLE
          </button>
        </div>
      )}

      {/* Disabled state shows "enabled" badge */}
      {disabled && (
        <div className="flex items-center justify-center px-3 py-2 border-t border-emerald-500/20 bg-emerald-500/[0.04]">
          <span className="font-pixel text-[7px] tracking-wider text-emerald-400">
            {'\u2713'} SKILLS ENABLED
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post-meeting screen
// ---------------------------------------------------------------------------

function PostMeetingChat({ ceoName }: { ceoName: string }) {
  const mission = getSetting('primary_mission');

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
        <div className="w-8 h-8 rounded-full bg-yellow-400/20 border border-yellow-400/40 flex items-center justify-center">
          <span className="font-pixel text-[10px] text-yellow-300">{'\u265B'}</span>
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
