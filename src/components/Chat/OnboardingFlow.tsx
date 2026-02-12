import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, ClipboardCheck, Cctv } from 'lucide-react';
import {
  loadCEO, getFounderInfo, getSetting, setSetting, saveMission,
  saveSkill, loadSkills, loadApprovals, saveApproval, updateApprovalStatus,
  getVaultEntryByService, saveConversation, saveChatMessage, loadMissions,
} from '../../lib/database';
import { getServiceForModel } from '../../lib/models';
import { skills as skillDefinitions, type SkillDefinition } from '../../data/skillDefinitions';
import { recommendSkills } from '../../lib/skillRecommender';
import { streamCEOResponse } from '../../lib/llm/chatService';
import ResearchOfferCard from './ResearchOfferCard';

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
  researchOffer?: boolean;
}

type ConvoStep =
  | 'welcome'
  | 'waiting_input'
  | 'acknowledging'
  | 'waiting_skill_approve'
  | 'waiting_test_input'
  | 'testing_skill'
  // Market research offer
  | 'offering_research'
  | 'waiting_research_decision'
  | 'asking_more_info'
  | 'waiting_more_info'
  | 'research_acknowledged'
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
// Props
// ---------------------------------------------------------------------------

interface OnboardingFlowProps {
  onComplete: () => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [step, setStep] = useState<ConvoStep>('welcome');
  const [typing, setTyping] = useState(false);
  const [needsApprovalNav, setNeedsApprovalNav] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onboardingRan = useRef(false);
  const missionTextRef = useRef('');
  const researchContextRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const approvalIdRef = useRef<string | null>(null);
  const skillApprovedRef = useRef(false);
  const stepRef = useRef<ConvoStep>('welcome');

  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const ceoRow = useRef(loadCEO());
  const founderInfo = useRef(getFounderInfo());
  const ceoName = ceoRow.current?.name ?? 'CEO';
  const founderName = founderInfo.current?.founderName ?? 'Founder';
  const orgName = founderInfo.current?.orgName ?? 'the organization';

  // LLM enabled check
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

  // Cleanup abort on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing, streamingText]);

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
  }, []);

  // Transition to market research offer
  const offerMarketResearch = useCallback(async () => {
    setStep('offering_research');
    await typeWithDelay(
      `One more thing — based on our mission, I'd like to run a market research brief. Competitive landscape, market sizing, key trends. Want me to start that?`,
      2500,
      { researchOffer: true },
    );
    setStep('waiting_research_decision');
  }, [typeWithDelay]);

  // Create post-onboarding missions
  const createPostOnboardingMissions = useCallback((cName: string, oName: string, researchAccepted: boolean, researchContext: string) => {
    const existing = loadMissions();
    const existingTitles = new Set(existing.map(m => m.title));

    // Market Research Brief
    const researchTitle = `Market Research: ${oName} competitive landscape`;
    if (!existingTitles.has(researchTitle)) {
      saveMission({
        id: `mission-research-${Date.now()}`,
        title: researchTitle + (researchContext ? ` — Focus: ${researchContext}` : ''),
        status: researchAccepted ? 'in_progress' : 'backlog',
        assignee: cName,
        priority: 'high',
        created_by: cName,
      });
    }

    // Skill Review Reminder (recurring)
    const skillReviewTitle = `Review agent skills and capabilities for ${oName}`;
    if (!existingTitles.has(skillReviewTitle)) {
      saveMission({
        id: `mission-skill-review-${Date.now()}`,
        title: skillReviewTitle,
        status: 'backlog',
        assignee: cName,
        priority: 'medium',
        recurring: 'Weekly',
        created_by: cName,
      });
    }

    // CEO Weekly Review (recurring)
    const weeklyTitle = `Weekly review: missions, chat history, capability gaps`;
    if (!existingTitles.has(weeklyTitle)) {
      saveMission({
        id: `mission-weekly-review-${Date.now() + 1}`,
        title: weeklyTitle,
        status: 'backlog',
        assignee: cName,
        priority: 'medium',
        recurring: 'Weekly',
        created_by: cName,
      });
    }

    // Skills marketplace refresh reminder (recurring)
    const marketplaceTitle = `Refresh skills from Marketplace and review new capabilities`;
    if (!existingTitles.has(marketplaceTitle)) {
      saveMission({
        id: `mission-marketplace-${Date.now() + 2}`,
        title: marketplaceTitle,
        status: 'backlog',
        assignee: cName,
        priority: 'medium',
        recurring: 'Weekly',
        created_by: cName,
      });
    }
  }, []);

  // Finalize meeting — save settings + persist onboarding conversation to DB
  // NOTE: Does NOT call onComplete() — the "done" step shows nav buttons,
  // and onComplete is called when the user clicks one of them.
  const finalizeMeeting = useCallback((missionText: string, researchAccepted: boolean, researchContext: string) => {
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

    // Persist onboarding conversation to DB
    const convId = `conv-onboarding-${Date.now()}`;
    saveConversation({ id: convId, title: `Welcome to ${orgName}`, type: 'onboarding', status: 'archived' });
    // Save all messages using ref for latest snapshot
    for (const msg of messagesRef.current) {
      saveChatMessage({
        id: msg.id,
        conversation_id: convId,
        sender: msg.sender,
        text: msg.text,
        metadata: msg.approvalCard ? JSON.stringify({ approvalCard: true }) : msg.researchOffer ? JSON.stringify({ researchOffer: true }) : null,
      });
    }

    // Create post-onboarding missions
    createPostOnboardingMissions(ceoName, orgName, researchAccepted, researchContext);
  }, [ceoName, orgName, createPostOnboardingMissions]);

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

      // Check for existing pending approval for this skill
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

      // Try real LLM streaming for the skill test
      const controller = streamCEOResponse(text, [], {
        onToken: (token) => {
          setTyping(false);
          setStreamingText(prev => (prev ?? '') + token);
        },
        onDone: (fullText) => {
          setStreamingText(null);
          setTyping(false);
          addCeoMessage(fullText);
          offerMarketResearch();
        },
        onError: () => {
          // Fallback to scripted response on error
          setStreamingText(null);
          setTyping(false);
          addCeoMessage(generateTestResponse(text));
          offerMarketResearch();
        },
      });

      if (controller) {
        abortRef.current = controller;
        setTyping(true);
      } else {
        // No LLM — use scripted response
        await typeWithDelay(generateTestResponse(text), 3500);
        await offerMarketResearch();
      }
      return; // early return — async flow is handled by callbacks or typeWithDelay

    } else if (step === 'waiting_more_info') {
      researchContextRef.current = text;
      setMessages(prev => [...prev, { id: `msg-${Date.now()}`, sender: 'user', text }]);
      setInput('');

      await typeWithDelay(
        `Got it — I'll focus the research on that. Adding this to the mission brief now.`,
        2000,
      );

      await typeWithDelay(
        `Also — don't forget to check the Skills page and refresh from the Marketplace. New capabilities drop regularly and your agents will thank you for it.`,
        2500,
      );

      await typeWithDelay(
        `I'm ready to lead ${orgName}. Let's head to Surveillance and start building the team.`,
        2000,
      );

      setStep('research_acknowledged');
      finalizeMeeting(missionTextRef.current, true, researchContextRef.current);
      setStep('done');
    }
  }, [input, step, typeWithDelay, orgName, ceoName, offerMarketResearch, finalizeMeeting]);

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

  // Handle LATER click in chat (skip skill → still offer research)
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

    // Still offer market research
    await offerMarketResearch();
  }, [step, typeWithDelay, offerMarketResearch]);

  // Handle research accept
  const handleResearchAccept = useCallback(async () => {
    if (step !== 'waiting_research_decision') return;

    setStep('asking_more_info');
    await typeWithDelay(
      `Great call. Before I start, is there anything specific to focus on? Competitors, target markets, specific questions? Or I can just run with what we have.`,
      2500,
    );
    setStep('waiting_more_info');
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [step, typeWithDelay]);

  // Handle "JUST GO" button during more info
  const handleJustGo = useCallback(async () => {
    if (step !== 'waiting_more_info') return;
    researchContextRef.current = '';

    await typeWithDelay(
      `No problem, I'll use what we have. Starting the research brief now.`,
      1800,
    );

    await typeWithDelay(
      `Also — I'd recommend checking the Skills page regularly and refreshing from the Marketplace. New capabilities get added and your agents can do more with them.`,
      2500,
    );

    await typeWithDelay(
      `I'm ready to lead ${orgName}. Let's head to Surveillance and start building the team.`,
      2000,
    );

    setStep('research_acknowledged');
    finalizeMeeting(missionTextRef.current, true, '');
    setStep('done');
  }, [step, typeWithDelay, orgName, finalizeMeeting]);

  // Handle research skip
  const handleResearchSkip = useCallback(async () => {
    if (step !== 'waiting_research_decision') return;

    await typeWithDelay(
      `No problem. I've added market research to the backlog — we can pick it up anytime.`,
      1800,
    );

    await typeWithDelay(
      `One tip: keep an eye on the Skills page and refresh from the Marketplace regularly. New skills are being added and they can give our team a real edge.`,
      2500,
    );

    await typeWithDelay(
      `I'm ready to lead ${orgName}. Let's head to Surveillance and start building the team.`,
      2000,
    );

    setStep('research_acknowledged');
    finalizeMeeting(missionTextRef.current, false, '');
    setStep('done');
  }, [step, typeWithDelay, orgName, finalizeMeeting]);

  const inputEnabled = step === 'waiting_input' || step === 'waiting_test_input' || step === 'waiting_more_info';

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
        <div className="w-8 h-8 rounded-full bg-yellow-400/20 border border-yellow-400/40 flex items-center justify-center">
          <span className="font-pixel text-[11px] text-yellow-300">{'\u265B'}</span>
        </div>
        <div className="flex-1">
          <div className="font-pixel text-[11px] tracking-wider text-yellow-300">
            CEO {ceoName}
          </div>
          <div className="font-pixel text-[10px] tracking-wider text-zinc-500">
            {typing ? 'TYPING...' : 'ONLINE'}
          </div>
        </div>
        {llmEnabled && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-pixel text-[10px] tracking-widest text-emerald-400">
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

              {msg.researchOffer && (
                <ResearchOfferCard
                  onAccept={handleResearchAccept}
                  onSkip={handleResearchSkip}
                  disabled={step !== 'waiting_research_decision'}
                />
              )}
            </div>
          </div>
        ))}

        {/* Streaming LLM response */}
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

        {/* JUST GO button during waiting_more_info */}
        {step === 'waiting_more_info' && !typing && (
          <div className="flex justify-center pt-2">
            <button
              onClick={handleJustGo}
              className="font-pixel text-[11px] tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors border border-zinc-700/50 rounded-lg px-4 py-2"
            >
              JUST GO — USE WHAT WE HAVE
            </button>
          </div>
        )}

        {step === 'done' && !typing && (
          <div className="flex justify-center gap-3 pt-4">
            {needsApprovalNav && (
              <button
                onClick={() => { onComplete(); navigate('/approvals'); }}
                className="retro-button flex items-center gap-2 !text-[10px] !py-3 !px-6 tracking-widest hover:!text-amber-400"
              >
                <ClipboardCheck size={14} />
                GO TO APPROVALS
              </button>
            )}
            <button
              onClick={() => { onComplete(); navigate('/surveillance'); }}
              className="retro-button flex items-center gap-2 !text-[10px] !py-3 !px-6 tracking-widest hover:!text-emerald-400"
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
                  : step === 'waiting_more_info'
                    ? 'Add context or hit JUST GO...'
                    : step === 'done'
                      ? 'Onboarding complete'
                      : 'Waiting for CEO...'
            }
            disabled={!inputEnabled}
            className="flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 font-pixel text-[10px] tracking-wider text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
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
// Single Skill Approval Card (internal)
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
        <div className="font-pixel text-[11px] tracking-widest text-yellow-300">
          {'\u265B'} ENABLE SKILL
        </div>
      </div>

      <div className="px-3 py-3 flex items-start gap-2.5">
        <SkillIcon size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-pixel text-[10px] tracking-wider text-zinc-200">
            {skillName}
          </div>
          <div className="font-pixel text-[10px] tracking-wider text-zinc-500 leading-relaxed mt-0.5">
            {skillDescription}
          </div>
        </div>
      </div>

      {!disabled && (
        <div className="flex items-center justify-between px-3 py-2.5 border-t border-yellow-400/20 bg-yellow-400/[0.03]">
          <button
            onClick={onSkip}
            className="font-pixel text-[10px] tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
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
          <span className="font-pixel text-[10px] tracking-wider text-emerald-400">
            {'\u2713'} ENABLED
          </span>
        </div>
      )}
    </div>
  );
}
