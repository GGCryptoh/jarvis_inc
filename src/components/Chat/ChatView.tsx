import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, ClipboardCheck, Cctv } from 'lucide-react';
import {
  loadCEO, getFounderInfo, getSetting, setSetting, saveMission,
  saveSkill, loadSkills, loadApprovals, saveApproval, updateApprovalStatus,
  getVaultEntryByService,
} from '../../lib/database';
import { getServiceForModel } from '../../lib/models';
import { skills as skillDefinitions, type SkillDefinition } from '../../data/skillDefinitions';
import { recommendSkills } from '../../lib/skillRecommender';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string;
  sender: 'ceo' | 'user' | 'system';
  text: string;
  approvalCard?: {
    skillName: string;
    skillDescription: string;
    skillIcon: React.ElementType;
  };
}

type ConvoStep =
  | 'welcome'
  | 'waiting_input'
  | 'acknowledging'
  | 'waiting_skill_approve'
  | 'waiting_test_input'
  | 'testing_skill'
  | 'done';

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------

const FIRST_SKILL_ID = 'research-web';

function getRequiredService(skill: SkillDefinition, model: string | null): string | null {
  if (skill.serviceType === 'fixed') return skill.fixedService ?? null;
  if (model) return getServiceForModel(model);
  return null;
}

function hasApiKey(service: string): boolean {
  return getVaultEntryByService(service) !== null;
}

function generateTestResponse(query: string): string {
  const q = query.length > 60 ? query.slice(0, 60) + '...' : query;
  return [
    `Research results for "${q}":`,
    '',
    'Scanned 14 web sources in 2.8 seconds.',
    '',
    '1. Multiple credible sources confirm strong activity in this area.',
    '2. Recent developments in the last 30 days show growing momentum.',
    '3. Three primary angles worth deeper investigation were identified.',
    '',
    'I\'d recommend assigning a dedicated research agent for a full deep-dive once the team is assembled.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

// 20 random CEO greetings for post-meeting returns
const CEO_GREETINGS = [
  'Hey {founder}, what can I help with today?',
  'Welcome back, {founder}. What\'s on your mind?',
  'Good to see you, {founder}. Need anything?',
  '{founder}, reporting in. How can I assist?',
  'Standing by, {founder}. What are we working on?',
  'Ready when you are, {founder}.',
  'What\'s the play today, {founder}?',
  '{founder} — let me know if you need anything.',
  'Back at it. What do you need from me, {founder}?',
  'At your service, {founder}. Fire away.',
  'Hey {founder}. I\'ve been keeping an eye on things.',
  'Good timing, {founder}. I was just reviewing our operations.',
  '{founder}, what\'s our next move?',
  'All systems nominal. How can I help, {founder}?',
  'Checking in, {founder}. What do you need?',
  'Ready for orders, {founder}.',
  '{founder}! Let\'s make things happen.',
  'Hey boss. What\'s the priority right now?',
  '{founder}, I\'m all ears. What do you need?',
  'Glad you\'re here, {founder}. What should we focus on?',
];

function randomGreeting(founderName: string): string {
  const idx = Math.floor(Math.random() * CEO_GREETINGS.length);
  return CEO_GREETINGS[idx].replace(/\{founder\}/g, founderName);
}

export default function ChatView() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [step, setStep] = useState<ConvoStep>('welcome');
  const [typing, setTyping] = useState(false);
  const [needsApprovalNav, setNeedsApprovalNav] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onboardingRan = useRef(false);
  const missionTextRef = useRef('');
  const approvalIdRef = useRef<string | null>(null);
  const skillApprovedRef = useRef(false);
  const stepRef = useRef<ConvoStep>('welcome');

  useEffect(() => { stepRef.current = step; }, [step]);

  const ceoRow = useRef(loadCEO());
  const founderInfo = useRef(getFounderInfo());
  const ceoName = ceoRow.current?.name ?? 'CEO';
  const founderName = founderInfo.current?.founderName ?? 'Founder';
  const orgName = founderInfo.current?.orgName ?? 'the organization';

  // Synchronous init — prevents race condition where onboarding starts before meetingDone is set
  const [meetingDone] = useState(() => !!getSetting('ceo_meeting_done'));

  // LLM enabled = skill enabled AND API key present for the skill's service
  const [llmEnabled] = useState(() => {
    const skills = loadSkills();
    const skillEnabled = skills.some(s => s.id === FIRST_SKILL_ID && s.enabled);
    if (!skillEnabled) return false;
    const firstSkill = skillDefinitions.find(s => s.id === FIRST_SKILL_ID);
    if (!firstSkill) return false;
    const model = firstSkill.serviceType === 'llm' ? firstSkill.defaultModel ?? null : null;
    const service = getRequiredService(firstSkill, model);
    return service ? hasApiKey(service) : false;
  });

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

  // Handle skill approved from Approvals page (external)
  const advanceAfterApproval = useCallback(async () => {
    const firstSkill = skillDefinitions.find(s => s.id === FIRST_SKILL_ID)!;
    const model = firstSkill.serviceType === 'llm' ? firstSkill.defaultModel ?? null : null;
    saveSkill(firstSkill.id, true, model);

    await typeWithDelay(
      `I see you've approved ${firstSkill.name} from the Approvals page — nice work!`,
      1500,
    );
    await typeWithDelay(
      `Want to take it for a spin? Ask me to research anything and I'll show you what it can do.`,
      2000,
    );
    setStep('waiting_test_input');
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [typeWithDelay]);

  // Listen for external approval changes (from Approvals page)
  useEffect(() => {
    function handleApprovalsChanged() {
      if (stepRef.current === 'waiting_skill_approve' && approvalIdRef.current && !skillApprovedRef.current) {
        const pending = loadApprovals();
        const stillPending = pending.some(a => a.id === approvalIdRef.current);
        if (!stillPending) {
          skillApprovedRef.current = true;
          advanceAfterApproval();
        }
      }
    }
    window.addEventListener('approvals-changed', handleApprovalsChanged);
    return () => window.removeEventListener('approvals-changed', handleApprovalsChanged);
  }, [advanceAfterApproval]);

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

  // Handle user sending a message
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;

    if (step === 'waiting_input') {
      missionTextRef.current = text;
      setMessages(prev => [...prev, { id: `msg-${Date.now()}`, sender: 'user', text }]);
      setInput('');
      setStep('acknowledging');

      await typeWithDelay(
        `That's a strong direction. I've noted this as our primary mission for ${orgName}.`,
        2000,
      );

      const firstSkill = skillDefinitions.find(s => s.id === FIRST_SKILL_ID)!;
      const recommendedIds = recommendSkills(text);
      const recommended = recommendedIds
        .map(id => skillDefinitions.find(s => s.id === id))
        .filter((s): s is SkillDefinition => s !== undefined);

      // Check if the first skill is already enabled
      const existingSkills = loadSkills();
      const alreadyEnabled = existingSkills.some(s => s.id === FIRST_SKILL_ID && s.enabled);

      if (alreadyEnabled) {
        if (recommended.length > 0) {
          const skillNames = recommended.map(s => s.name).join(', ');
          await typeWithDelay(
            `Based on your mission, capabilities like ${skillNames} will be useful. I see ${firstSkill.name} is already enabled — great!`,
            2500,
          );
        }
        await typeWithDelay(
          `Want to take it for a spin? Ask me to research anything and I'll show you what it can do.`,
          2000,
        );
        setStep('waiting_test_input');
        setTimeout(() => inputRef.current?.focus(), 100);
        return;
      }

      // Mention recommended skills
      if (recommended.length > 1) {
        const skillNames = recommended.map(s => s.name).join(', ');
        await typeWithDelay(
          `Based on your mission, I'd recommend capabilities like ${skillNames}. We can enable more later from the Skills page.`,
          2500,
        );
      }

      // Check for existing pending approval for this skill (prevents duplicates on reload)
      const pendingApprovals = loadApprovals();
      const existingApproval = pendingApprovals.find(a => {
        try {
          const meta = JSON.parse(a.metadata ?? '{}');
          return a.type === 'skill_enable' && meta.skillId === FIRST_SKILL_ID;
        } catch { return false; }
      });

      let approvalId: string;
      const model = firstSkill.serviceType === 'llm' ? firstSkill.defaultModel ?? null : null;
      if (existingApproval) {
        approvalId = existingApproval.id;
      } else {
        approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        saveApproval({
          id: approvalId,
          type: 'skill_enable',
          title: `Enable Skill: ${firstSkill.name}`,
          description: `CEO ${ceoName} recommends enabling "${firstSkill.name}" — ${firstSkill.description}`,
          status: 'pending',
          metadata: JSON.stringify({ skillId: firstSkill.id, skillName: firstSkill.name, model }),
        });
        window.dispatchEvent(new Event('approvals-changed'));
      }
      approvalIdRef.current = approvalId;

      await typeWithDelay(
        `Let's start by turning on our first skill — ${firstSkill.name}. This will let our agents search and analyze the web for any topic.`,
        2200,
        {
          approvalCard: {
            skillName: firstSkill.name,
            skillDescription: firstSkill.description,
            skillIcon: firstSkill.icon,
          },
        },
      );

      setStep('waiting_skill_approve');

    } else if (step === 'waiting_test_input') {
      setMessages(prev => [...prev, { id: `msg-${Date.now()}`, sender: 'user', text }]);
      setInput('');
      setStep('testing_skill');

      await typeWithDelay(generateTestResponse(text), 3500);

      await typeWithDelay(
        `That's a taste of what your agents will be able to do. I'm ready to lead — let's head to Surveillance and start building the team.`,
        2500,
      );

      finalizeMeeting(missionTextRef.current);
      setStep('done');
    }
  }, [input, step, typeWithDelay, orgName, ceoName]);

  // Handle APPROVE click in chat
  const handleApproveSkill = useCallback(async () => {
    if (step !== 'waiting_skill_approve') return;
    skillApprovedRef.current = true;

    const firstSkill = skillDefinitions.find(s => s.id === FIRST_SKILL_ID)!;
    const model = firstSkill.serviceType === 'llm' ? firstSkill.defaultModel ?? null : null;

    saveSkill(firstSkill.id, true, model);

    if (approvalIdRef.current) {
      updateApprovalStatus(approvalIdRef.current, 'approved');
    }

    const service = getRequiredService(firstSkill, model);
    const keyMissing = service ? !hasApiKey(service) : false;

    if (keyMissing && service) {
      saveApproval({
        id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'api_key_request',
        title: `API Key Required: ${service}`,
        description: `Skill "${firstSkill.name}" requires a ${service} API key to function.`,
        status: 'pending',
        metadata: JSON.stringify({ service, skillId: firstSkill.id, model }),
      });
      setNeedsApprovalNav(true);
    }

    window.dispatchEvent(new Event('approvals-changed'));

    if (keyMissing) {
      await typeWithDelay(
        `${firstSkill.name} is now enabled! I've also requested the ${service} API key — you can provide it in Approvals anytime.`,
        1800,
      );
    } else {
      await typeWithDelay(
        `${firstSkill.name} is now enabled and connected. We're ready to go!`,
        1800,
      );
    }

    await typeWithDelay(
      `Want to take it for a spin? Ask me to research anything and I'll show you what it can do.`,
      2000,
    );

    setStep('waiting_test_input');
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [step, typeWithDelay]);

  // Handle LATER click in chat
  const handleSkipSkill = useCallback(async () => {
    if (step !== 'waiting_skill_approve') return;
    skillApprovedRef.current = true;

    if (approvalIdRef.current) {
      updateApprovalStatus(approvalIdRef.current, 'dismissed');
    }
    window.dispatchEvent(new Event('approvals-changed'));

    await typeWithDelay(
      `No problem — you can enable skills anytime from the Skills page.`,
      1500,
    );
    await typeWithDelay(
      `Head to Surveillance when you're ready and we'll start hiring agents to bring our mission to life.`,
      2000,
    );

    finalizeMeeting(missionTextRef.current);
    setStep('done');
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

  // Post-meeting screen — show greeting instead of restarting onboarding
  if (meetingDone && messages.length === 0) {
    return <PostMeetingChat ceoName={ceoName} founderName={founderName} llmEnabled={llmEnabled} />;
  }

  const inputEnabled = step === 'waiting_input' || step === 'waiting_test_input';

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
        <div className="w-8 h-8 rounded-full bg-yellow-400/20 border border-yellow-400/40 flex items-center justify-center">
          <span className="font-pixel text-[10px] text-yellow-300">{'\u265B'}</span>
        </div>
        <div className="flex-1">
          <div className="font-pixel text-[10px] tracking-wider text-yellow-300">
            CEO {ceoName}
          </div>
          <div className="font-pixel text-[7px] tracking-wider text-zinc-500">
            {typing ? 'TYPING...' : 'ONLINE'}
          </div>
        </div>
        {llmEnabled && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-pixel text-[7px] tracking-widest text-emerald-400">
              LLM: CONNECTED
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
                  : 'bg-zinc-800/60 border border-zinc-700/50',
              ].join(' ')}
            >
              {msg.sender === 'ceo' && (
                <div className="font-pixel text-[7px] tracking-wider text-yellow-300/70 mb-1.5">
                  CEO {ceoName}
                </div>
              )}
              <div className={[
                'font-pixel text-[9px] tracking-wider leading-relaxed whitespace-pre-line',
                msg.sender === 'user' ? 'text-emerald-200' : 'text-zinc-300',
              ].join(' ')}>
                {msg.text}
              </div>

              {msg.approvalCard && (
                <SingleSkillApproval
                  skillName={msg.approvalCard.skillName}
                  skillDescription={msg.approvalCard.skillDescription}
                  skillIcon={msg.approvalCard.skillIcon}
                  onApprove={handleApproveSkill}
                  onSkip={handleSkipSkill}
                  disabled={step !== 'waiting_skill_approve'}
                />
              )}
            </div>
          </div>
        ))}

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

        {step === 'done' && !typing && (
          <div className="flex justify-center gap-3 pt-4">
            {needsApprovalNav && (
              <button
                onClick={() => navigate('/approvals')}
                className="retro-button flex items-center gap-2 !text-[9px] !py-3 !px-6 tracking-widest hover:!text-amber-400"
              >
                <ClipboardCheck size={14} />
                GO TO APPROVALS
              </button>
            )}
            <button
              onClick={() => navigate('/surveillance')}
              className="retro-button flex items-center gap-2 !text-[9px] !py-3 !px-6 tracking-widest hover:!text-emerald-400"
            >
              <Cctv size={14} />
              GO TO SURVEILLANCE
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
                : step === 'waiting_test_input'
                  ? 'Ask me to research anything...'
                  : step === 'done' || meetingDone
                    ? 'Chat coming soon...'
                    : 'Waiting for CEO...'
            }
            disabled={!inputEnabled}
            className="flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 font-pixel text-[9px] tracking-wider text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSend}
            disabled={!inputEnabled || !input.trim()}
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
// Single Skill Approval Card
// ---------------------------------------------------------------------------

function SingleSkillApproval({
  skillName,
  skillDescription,
  skillIcon: SkillIcon,
  onApprove,
  onSkip,
  disabled,
}: {
  skillName: string;
  skillDescription: string;
  skillIcon: React.ElementType;
  onApprove: () => void;
  onSkip: () => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-3 rounded-lg border border-yellow-400/30 bg-yellow-400/[0.04] overflow-hidden">
      <div className="px-3 py-2 border-b border-yellow-400/20 bg-yellow-400/[0.06]">
        <div className="font-pixel text-[8px] tracking-widest text-yellow-300">
          {'\u265B'} ENABLE SKILL
        </div>
      </div>

      <div className="px-3 py-3 flex items-start gap-2.5">
        <SkillIcon size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-pixel text-[9px] tracking-wider text-zinc-200">
            {skillName}
          </div>
          <div className="font-pixel text-[7px] tracking-wider text-zinc-500 leading-relaxed mt-0.5">
            {skillDescription}
          </div>
        </div>
      </div>

      {!disabled && (
        <div className="flex items-center justify-between px-3 py-2.5 border-t border-yellow-400/20 bg-yellow-400/[0.03]">
          <button
            onClick={onSkip}
            className="font-pixel text-[7px] tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            LATER
          </button>
          <button
            onClick={onApprove}
            className="retro-button !text-[8px] !py-1.5 !px-4 tracking-widest hover:!text-emerald-400"
          >
            APPROVE
          </button>
        </div>
      )}

      {disabled && (
        <div className="flex items-center justify-center px-3 py-2 border-t border-emerald-500/20 bg-emerald-500/[0.04]">
          <span className="font-pixel text-[7px] tracking-wider text-emerald-400">
            {'\u2713'} ENABLED
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post-meeting screen — CEO greeting + mission summary
// ---------------------------------------------------------------------------

function PostMeetingChat({ ceoName, founderName, llmEnabled }: { ceoName: string; founderName: string; llmEnabled: boolean }) {
  const mission = getSetting('primary_mission');
  const [greeting] = useState(() => randomGreeting(founderName));

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
        <div className="w-8 h-8 rounded-full bg-yellow-400/20 border border-yellow-400/40 flex items-center justify-center">
          <span className="font-pixel text-[10px] text-yellow-300">{'\u265B'}</span>
        </div>
        <div className="flex-1">
          <div className="font-pixel text-[10px] tracking-wider text-yellow-300">
            CEO {ceoName}
          </div>
          <div className="font-pixel text-[7px] tracking-wider text-zinc-500">
            ONLINE
          </div>
        </div>
        {llmEnabled && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-pixel text-[7px] tracking-widest text-emerald-400">
              LLM: CONNECTED
            </span>
          </div>
        )}
      </div>

      {/* Greeting + mission */}
      <div ref={undefined} className="flex-1 overflow-y-auto no-scrollbar px-6 py-4 space-y-4">
        {/* CEO greeting bubble */}
        <div className="flex justify-start">
          <div className="max-w-[70%] rounded-lg px-4 py-3 bg-zinc-800/60 border border-zinc-700/50">
            <div className="font-pixel text-[7px] tracking-wider text-yellow-300/70 mb-1.5">
              CEO {ceoName}
            </div>
            <div className="font-pixel text-[9px] tracking-wider leading-relaxed text-zinc-300">
              {greeting}
            </div>
          </div>
        </div>

        {/* Mission card */}
        {mission && (
          <div className="flex justify-center pt-2">
            <div className="max-w-md w-full p-4 rounded-lg bg-zinc-800/40 border border-zinc-700/40">
              <div className="font-pixel text-[7px] tracking-widest text-emerald-400/70 mb-2">
                PRIMARY MISSION
              </div>
              <div className="font-pixel text-[9px] tracking-wider text-zinc-300 leading-relaxed">
                {mission}
              </div>
            </div>
          </div>
        )}

        {/* Status note */}
        <div className="flex justify-center pt-2">
          <div className="font-pixel text-[7px] tracking-wider text-zinc-600 text-center leading-relaxed">
            {llmEnabled
              ? 'AI-powered conversations active. Type a message below.'
              : 'Provide an API key in the Vault to enable AI-powered conversations.'}
          </div>
        </div>
      </div>

      {/* Input — enabled when llmEnabled, otherwise placeholder */}
      <div className="px-6 py-4 border-t border-zinc-800">
        <div className="flex items-center gap-3">
          <input
            type="text"
            disabled={!llmEnabled}
            placeholder={llmEnabled ? 'Message CEO...' : 'Add an API key in the Vault to chat...'}
            className="flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 font-pixel text-[9px] tracking-wider text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <button
            disabled={!llmEnabled}
            className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
