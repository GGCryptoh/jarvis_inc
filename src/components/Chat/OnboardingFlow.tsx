import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, ClipboardCheck, Cctv, CloudRain } from 'lucide-react';
import {
  loadCEO, getFounderInfo, getSetting, setSetting,
  saveSkill, loadSkills, loadApprovals, saveApproval, updateApprovalStatus,
  getVaultEntryByService, saveConversation, saveChatMessage,
} from '../../lib/database';
import { getServiceForModel, MODEL_OPTIONS, MODEL_SERVICE_MAP } from '../../lib/models';
import { playOnlineJingle } from '../../lib/sounds';
import { getSkillById, getAllSkills } from '../../lib/skillsCache';
import type { FullSkillDefinition } from '../../lib/skillResolver';
import { resolveIcon } from '../../lib/iconResolver';
import { recommendSkills } from '../../lib/skillRecommender';
import { streamCEOResponse } from '../../lib/llm/chatService';
import ResearchOfferCard from './ResearchOfferCard';
import RichMessageContent from './ToolCallBlock';

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
  weatherCard?: {
    skillName: string;
    skillDescription: string;
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
  // Weather CLI skill offer
  | 'offering_weather'
  | 'waiting_weather_approve'
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
const SECOND_SKILL_ID = 'weather-cli';

function getRequiredService(skill: FullSkillDefinition, model: string | null): string | null {
  if (skill.serviceType === 'none') return null;
  if (skill.serviceType === 'fixed' || skill.fixedService) return skill.fixedService ?? null;
  if (model) return getServiceForModel(model);
  return null;
}

async function hasApiKey(service: string): Promise<boolean> {
  return (await getVaultEntryByService(service)) !== null;
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
  const [step, setStepRaw] = useState<ConvoStep>('welcome');
  const [typing, setTyping] = useState(false);
  const restoredRef = useRef(false);
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
  const weatherApprovalIdRef = useRef<string | null>(null);
  const weatherApprovedRef = useRef(false);
  const stepRef = useRef<ConvoStep>('welcome');

  // Wrap setStep to persist to DB
  const setStep = useCallback((s: ConvoStep) => {
    setStepRaw(s);
    stepRef.current = s;
    setSetting('onboarding_step', s).catch(() => {});
  }, []);

  useEffect(() => { stepRef.current = step; }, [step]);

  // Persist messages to DB whenever they change
  useEffect(() => {
    messagesRef.current = messages;
    if (messages.length > 0) {
      setSetting('onboarding_messages', JSON.stringify(messages)).catch(() => {});
    }
  }, [messages]);

  // Async-loaded identity data
  const [ceoName, setCeoName] = useState('CEO');
  const [founderName, setFounderName] = useState('Founder');
  const [orgName, setOrgName] = useState('the organization');
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [modelOptions, setModelOptions] = useState<{ name: string; service: string; hasKey: boolean }[]>([]);
  const [revealPhase, setRevealPhase] = useState<'hidden' | 'flicker' | 'typing' | 'done'>('hidden');
  const [revealText, setRevealText] = useState('');

  // Load identity data asynchronously
  useEffect(() => {
    const load = async () => {
      const [ceoData, founderInfo, skills] = await Promise.all([
        loadCEO(),
        getFounderInfo(),
        loadSkills(),
      ]);

      setCeoName(ceoData?.name ?? 'CEO');
      setFounderName(founderInfo?.founderName ?? 'Founder');
      setOrgName(founderInfo?.orgName ?? 'the organization');

      // LLM enabled check
      const skillEnabled = skills.some(s => s.id === FIRST_SKILL_ID && s.enabled);
      if (skillEnabled) {
        const firstSkill = getSkillById(FIRST_SKILL_ID);
        if (firstSkill) {
          const model = firstSkill.serviceType === 'llm' ? firstSkill.defaultModel ?? null : null;
          const service = getRequiredService(firstSkill, model);
          if (service) {
            const keyExists = await hasApiKey(service);
            setLlmEnabled(keyExists);
          }
        }
      }

      // Build model options with key indicators
      const vaultServices = new Set<string>();
      for (const service of ['Anthropic', 'OpenAI', 'Google', 'DeepSeek', 'xAI']) {
        const entry = await getVaultEntryByService(service);
        if (entry) vaultServices.add(service);
      }
      const options = MODEL_OPTIONS.map(name => ({
        name,
        service: MODEL_SERVICE_MAP[name] ?? 'Unknown',
        hasKey: vaultServices.has(MODEL_SERVICE_MAP[name] ?? ''),
      }));
      setModelOptions(options);
      // Default to CEO's model or first available
      const ceoModel = ceoData?.model ?? 'Claude Opus 4.6';
      setSelectedModel(ceoModel);

      // ── Restore saved onboarding state (survives route navigation) ──
      const savedStep = await getSetting('onboarding_step');
      const savedMsgs = await getSetting('onboarding_messages');

      if (savedStep && savedStep !== 'welcome' && savedMsgs) {
        try {
          const parsed: ChatMessage[] = JSON.parse(savedMsgs);
          // Re-hydrate approval card icons (React components can't be JSON-serialized)
          for (const msg of parsed) {
            if (msg.approvalCard) {
              const allSkills = getAllSkills();
              const def = allSkills.find(s => s.name === msg.approvalCard!.skillName);
              if (def) msg.approvalCard.skillIcon = resolveIcon(def.icon);
            }
          }

          // Snap transient steps to nearest stable state
          let restoredStep = savedStep as ConvoStep;
          if (restoredStep === 'acknowledging') restoredStep = 'waiting_skill_approve';
          if (restoredStep === 'testing_skill') restoredStep = 'waiting_test_input';
          if (restoredStep === 'offering_research') restoredStep = 'waiting_research_decision';
          if (restoredStep === 'asking_more_info') restoredStep = 'waiting_more_info';
          if (restoredStep === 'research_acknowledged') restoredStep = 'done';

          setMessages(parsed);
          setStepRaw(restoredStep);
          stepRef.current = restoredStep;
          onboardingRan.current = true;
          restoredRef.current = true;

          // Restore flags based on how far we progressed
          const pastApproval = ['waiting_test_input', 'testing_skill', 'offering_research',
            'waiting_research_decision', 'asking_more_info', 'waiting_more_info',
            'research_acknowledged', 'done'].includes(savedStep);
          if (pastApproval) skillApprovedRef.current = true;
          if (pastApproval && skillEnabled) setRevealPhase('done');

          // Restore mission text from first user message
          const firstUserMsg = parsed.find(m => m.sender === 'user');
          if (firstUserMsg) missionTextRef.current = firstUserMsg.text;

          // Restore approval ID if still at approval step
          if (restoredStep === 'waiting_skill_approve') {
            const approvals = await loadApprovals();
            const sa = approvals.find(a => {
              try {
                const meta = typeof a.metadata === 'string' ? JSON.parse(a.metadata) : (a.metadata ?? {});
                return a.type === 'skill_enable' && meta.skillId === FIRST_SKILL_ID;
              } catch { return false; }
            });
            if (sa) approvalIdRef.current = sa.id;
          }

          // Focus input for interactive states
          if (['waiting_input', 'waiting_test_input', 'waiting_more_info'].includes(restoredStep)) {
            setTimeout(() => inputRef.current?.focus(), 200);
          }
        } catch {
          // Corrupted saved state — fall through to fresh start
        }
      }

      setDataLoaded(true);
    };
    load();
  }, []);

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

  // Cinematic LLM: ONLINE reveal sequence
  const triggerLLMReveal = useCallback(async () => {
    // Phase 1: CRT flicker
    setRevealPhase('flicker');
    await new Promise(r => setTimeout(r, 150));

    // Phase 2: Typewriter effect
    setRevealPhase('typing');
    playOnlineJingle();
    const text = 'LLM: ONLINE';
    for (let i = 0; i <= text.length; i++) {
      setRevealText(text.slice(0, i));
      await new Promise(r => setTimeout(r, 40));
    }

    // Phase 3: Done — badge stays with glow
    await new Promise(r => setTimeout(r, 200));
    setRevealPhase('done');
    setLlmEnabled(true);
  }, []);

  // Handle skill approved from Approvals page (external)
  const advanceAfterApproval = useCallback(async () => {
    const firstSkill = getSkillById(FIRST_SKILL_ID)!;
    const model = firstSkill.serviceType === 'llm' ? firstSkill.defaultModel ?? null : null;
    await saveSkill(firstSkill.id, true, model);

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
        loadApprovals().then(pending => {
          const stillPending = pending.some(a => a.id === approvalIdRef.current);
          if (!stillPending) {
            skillApprovedRef.current = true;
            advanceAfterApproval();
          }
        });
      }
    }
    window.addEventListener('approvals-changed', handleApprovalsChanged);
    return () => window.removeEventListener('approvals-changed', handleApprovalsChanged);
  }, [advanceAfterApproval]);

  // Listen for vault changes — delayed reveal when API key is added after approval
  useEffect(() => {
    if (!needsApprovalNav || revealPhase !== 'hidden') return;

    const checkVault = async () => {
      const service = MODEL_SERVICE_MAP[selectedModel] ?? '';
      if (!service) return;
      const entry = await getVaultEntryByService(service);
      if (entry) {
        // Key was added! Trigger the reveal
        setNeedsApprovalNav(false);
        await triggerLLMReveal();
        await typeWithDelay(
          'Systems connected. I can see the network now. Want to take it for a spin?',
          2000,
        );
        setStep('waiting_test_input');
        stepRef.current = 'waiting_test_input';
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    };

    const handler = () => { checkVault(); };
    window.addEventListener('approvals-changed', handler);
    // Also poll every 3s in case the event is missed
    const interval = setInterval(checkVault, 3000);
    return () => {
      window.removeEventListener('approvals-changed', handler);
      clearInterval(interval);
    };
  }, [needsApprovalNav, selectedModel, revealPhase, triggerLLMReveal, typeWithDelay]);

  // Onboarding conversation flow — wait for data to load
  useEffect(() => {
    if (!dataLoaded) return;
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
  }, [dataLoaded]);

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

  // Offer Weather CLI skill (after first skill test, before market research)
  const offerWeatherSkill = useCallback(async () => {
    // Check if weather-cli exists in DB (synced from repo)
    // Retry a few times — on fresh installs the skill seed may still be running
    let weatherRow: Awaited<ReturnType<typeof loadSkills>>[number] | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      const allSkills = await loadSkills();
      weatherRow = allSkills.find(s => s.id === SECOND_SKILL_ID);
      if (weatherRow) break;
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
    }

    if (!weatherRow) {
      // Not synced after retries — skip to market research
      await offerMarketResearch();
      return;
    }

    if (weatherRow.enabled) {
      await typeWithDelay(`I see Weather CLI is already online — nice.`, 1500);
      await offerMarketResearch();
      return;
    }

    setStep('offering_weather');

    // Create approval
    const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await saveApproval({
      id: approvalId,
      type: 'skill_enable',
      title: 'Enable Skill: Weather CLI',
      description: `CEO ${ceoName} recommends enabling "Weather CLI" — real-time weather data, no API key required`,
      status: 'pending',
      metadata: { skillId: SECOND_SKILL_ID, skillName: 'Weather CLI', connectionType: 'cli' },
    });
    window.dispatchEvent(new Event('approvals-changed'));
    weatherApprovalIdRef.current = approvalId;

    await typeWithDelay(
      `One more — I found a Weather CLI tool in our skills repo. Real-time forecasts from wttr.in, no API key needed. Quick approvals like this keep our toolkit sharp.`,
      2500,
      {
        weatherCard: {
          skillName: 'Weather CLI',
          skillDescription: 'Real-time weather forecasts, current conditions, and moon phases — powered by wttr.in, zero config required',
        },
      },
    );

    setStep('waiting_weather_approve');
  }, [typeWithDelay, offerMarketResearch, ceoName]);

  // Create post-onboarding missions
  // Finalize meeting — save settings + persist onboarding conversation to DB
  // NOTE: Does NOT call onComplete() — the "done" step shows nav buttons,
  // and onComplete is called when the user clicks one of them.
  const finalizeMeeting = useCallback(async (missionText: string, researchAccepted: boolean, researchContext: string) => {
    await setSetting('ceo_meeting_done', 'true');
    await setSetting('primary_mission', missionText);
    // Auto-close missions when results approved — default on after ceremony
    await setSetting('auto_close_on_approve', 'true');
    // Clear persisted onboarding state (no longer needed after completion)
    await setSetting('onboarding_step', '');
    await setSetting('onboarding_messages', '');
    // No mission created — primary_mission setting is the strategic north star.
    // Real missions come from CEO chat interactions with task plans.

    // Persist onboarding conversation to DB
    const convId = `conv-onboarding-${Date.now()}`;
    await saveConversation({ id: convId, title: `Welcome to ${orgName}`, type: 'onboarding', status: 'archived' });
    // Save all messages using ref for latest snapshot
    for (const msg of messagesRef.current) {
      await saveChatMessage({
        id: msg.id,
        conversation_id: convId,
        sender: msg.sender,
        text: msg.text,
        metadata: msg.approvalCard ? { approvalCard: true } : msg.researchOffer ? { researchOffer: true } : null,
      });
    }

  }, [ceoName, orgName]);

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

      const firstSkill = getSkillById(FIRST_SKILL_ID);
      const recommendedIds = recommendSkills(text);
      const recommended = recommendedIds
        .map(id => getSkillById(id))
        .filter((s): s is FullSkillDefinition => s !== undefined);

      // If skills haven't synced yet (fresh install), skip straight to weather/research
      if (!firstSkill) {
        if (recommended.length > 0) {
          const skillNames = recommended.map(s => s.name).join(', ');
          await typeWithDelay(
            `Based on your mission, capabilities like ${skillNames} will be useful. Skills are still syncing — you can enable them from the Skills page once they're ready.`,
            2500,
          );
        } else {
          await typeWithDelay(
            `Skills are still syncing from the repo. Head to the Skills page in a moment to enable what you need.`,
            2000,
          );
        }
        await offerWeatherSkill();
        return;
      }

      // Check if the first skill is already enabled
      const existingSkills = await loadSkills();
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
      const pendingApprovals = await loadApprovals();
      const existingApproval = pendingApprovals.find(a => {
        try {
          const meta = typeof a.metadata === 'string' ? JSON.parse(a.metadata) : (a.metadata ?? {});
          return a.type === 'skill_enable' && meta.skillId === FIRST_SKILL_ID;
        } catch { return false; }
      });

      let approvalId: string;
      const model = firstSkill.serviceType === 'llm' ? firstSkill.defaultModel ?? null : null;
      if (existingApproval) {
        approvalId = existingApproval.id;
      } else {
        approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await saveApproval({
          id: approvalId,
          type: 'skill_enable',
          title: `Enable Skill: ${firstSkill.name}`,
          description: `CEO ${ceoName} recommends enabling "${firstSkill.name}" — ${firstSkill.description}`,
          status: 'pending',
          metadata: { skillId: firstSkill.id, skillName: firstSkill.name, model },
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
            skillIcon: resolveIcon(firstSkill.icon),
          },
        },
      );

      setStep('waiting_skill_approve');

    } else if (step === 'waiting_test_input') {
      setMessages(prev => [...prev, { id: `msg-${Date.now()}`, sender: 'user', text }]);
      setInput('');
      setStep('testing_skill');

      // Try real LLM streaming for the skill test
      const controller = await streamCEOResponse(text, [], {
        onToken: (token) => {
          setTyping(false);
          setStreamingText(prev => (prev ?? '') + token);
        },
        onDone: (fullText) => {
          setStreamingText(null);
          setTyping(false);
          addCeoMessage(fullText);
          offerWeatherSkill();
        },
        onError: (error) => {
          setStreamingText(null);
          setTyping(false);
          addCeoMessage(`Connection interrupted: ${error.message}\n\nCheck your API key in The Vault and try again.`);
          setStep('waiting_test_input'); // Allow retry
          setTimeout(() => inputRef.current?.focus(), 100);
        },
      });

      if (controller) {
        abortRef.current = controller;
        setTyping(true);
      } else {
        addCeoMessage('LLM connection lost. Head to The Vault to check your API key, then come back and try again.');
        setStep('waiting_test_input');
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
        `I'm ready to lead ${orgName}. Let's head to Surveillance — or stay and chat with me.`,
        2000,
      );

      setStep('research_acknowledged');
      await finalizeMeeting(missionTextRef.current, true, researchContextRef.current);
      setStep('done');
    }
  }, [input, step, typeWithDelay, orgName, ceoName, offerMarketResearch, offerWeatherSkill, finalizeMeeting, addCeoMessage]);

  // Handle APPROVE click in chat
  const handleApproveSkill = useCallback(async () => {
    if (step !== 'waiting_skill_approve') return;
    skillApprovedRef.current = true;

    const firstSkill = getSkillById(FIRST_SKILL_ID)!;
    const model = selectedModel || firstSkill.defaultModel || null;

    await saveSkill(firstSkill.id, true, model);

    if (approvalIdRef.current) {
      await updateApprovalStatus(approvalIdRef.current, 'approved');
    }

    const service = model ? (MODEL_SERVICE_MAP[model] ?? null) : null;
    const keyMissing = service ? !(await getVaultEntryByService(service)) : true;

    if (keyMissing && service) {
      await saveApproval({
        id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'api_key_request',
        title: `API Key Required: ${service}`,
        description: `Skill "${firstSkill.name}" requires a ${service} API key to function.`,
        status: 'pending',
        metadata: { service, skillId: firstSkill.id, model },
      });
      setNeedsApprovalNav(true);
      window.dispatchEvent(new Event('approvals-changed'));

      await typeWithDelay(
        `${firstSkill.name} is now enabled! I've requested the ${service} API key — head to The Vault to add it, and I'll come online.`,
        2000,
      );
      // Don't advance to test yet — wait for key via vault listener
    } else {
      window.dispatchEvent(new Event('approvals-changed'));

      // Key exists — trigger cinematic reveal!
      await triggerLLMReveal();
      await typeWithDelay(
        `Systems connected. I can see the network now. Want to take it for a spin?`,
        2000,
      );
      setStep('waiting_test_input');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [step, selectedModel, typeWithDelay, triggerLLMReveal]);

  // Handle LATER click in chat (skip skill -> still offer research)
  const handleSkipSkill = useCallback(async () => {
    if (step !== 'waiting_skill_approve') return;
    skillApprovedRef.current = true;

    if (approvalIdRef.current) {
      await updateApprovalStatus(approvalIdRef.current, 'dismissed');
    }
    window.dispatchEvent(new Event('approvals-changed'));

    await typeWithDelay(
      `No problem — you can enable skills anytime from the Skills page.`,
      1500,
    );

    // Still offer weather, then market research
    await offerWeatherSkill();
  }, [step, typeWithDelay, offerWeatherSkill]);

  // Handle APPROVE for Weather CLI skill
  const handleApproveWeather = useCallback(async () => {
    if (step !== 'waiting_weather_approve') return;
    weatherApprovedRef.current = true;

    // Enable in DB (no model needed — CLI tool)
    await saveSkill(SECOND_SKILL_ID, true, null);

    if (weatherApprovalIdRef.current) {
      await updateApprovalStatus(weatherApprovalIdRef.current, 'approved');
    }
    window.dispatchEvent(new Event('approvals-changed'));
    window.dispatchEvent(new Event('skills-changed'));

    await typeWithDelay(
      `Weather CLI is live. Now our agents can pull real-time forecasts — useful for logistics, events, or just checking if it's going to snow.`,
      2000,
    );

    await offerMarketResearch();
  }, [step, typeWithDelay, offerMarketResearch]);

  // Handle LATER for Weather CLI skill
  const handleSkipWeather = useCallback(async () => {
    if (step !== 'waiting_weather_approve') return;
    weatherApprovedRef.current = true;

    if (weatherApprovalIdRef.current) {
      await updateApprovalStatus(weatherApprovalIdRef.current, 'dismissed');
    }
    window.dispatchEvent(new Event('approvals-changed'));

    await typeWithDelay(
      `No worries — it'll be in the Skills page whenever you need it.`,
      1500,
    );

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
      `I'm ready to lead ${orgName}. Let's head to Surveillance — or stay and chat with me.`,
      2000,
    );

    setStep('research_acknowledged');
    await finalizeMeeting(missionTextRef.current, true, '');
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
      `I'm ready to lead ${orgName}. Let's head to Surveillance — or stay and chat with me.`,
      2000,
    );

    setStep('research_acknowledged');
    await finalizeMeeting(missionTextRef.current, false, '');
    setStep('done');
  }, [step, typeWithDelay, orgName, finalizeMeeting]);

  const inputEnabled = step === 'waiting_input' || step === 'waiting_test_input' || step === 'waiting_more_info';

  // Don't render until data is loaded
  if (!dataLoaded) {
    return null;
  }

  return (
    <div className="flex-1 flex flex-col h-full relative">
      {revealPhase === 'flicker' && (
        <div className="absolute inset-0 llm-reveal-flicker bg-black/30 z-50 pointer-events-none" />
      )}
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
        {revealPhase !== 'hidden' && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 ${revealPhase === 'typing' || revealPhase === 'done' ? 'llm-reveal-badge' : ''}`}>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-pixel text-[10px] tracking-widest text-emerald-400">
              {revealPhase === 'typing' ? revealText : revealPhase === 'done' ? 'LLM: ONLINE' : ''}
            </span>
          </div>
        )}
        {llmEnabled && revealPhase === 'hidden' && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-pixel text-[10px] tracking-widest text-emerald-400">
              LLM: ONLINE
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
                {msg.sender === 'ceo' ? <RichMessageContent text={msg.text} /> : msg.text}
              </div>

              {msg.approvalCard && (
                <SingleSkillApproval
                  skillName={msg.approvalCard.skillName}
                  skillDescription={msg.approvalCard.skillDescription}
                  skillIcon={msg.approvalCard.skillIcon}
                  onApprove={handleApproveSkill}
                  onSkip={handleSkipSkill}
                  disabled={skillApprovedRef.current || step !== 'waiting_skill_approve'}
                  models={modelOptions}
                  selectedModel={selectedModel}
                  onModelChange={setSelectedModel}
                />
              )}

              {msg.weatherCard && (
                <CLISkillApproval
                  skillName={msg.weatherCard.skillName}
                  skillDescription={msg.weatherCard.skillDescription}
                  onApprove={handleApproveWeather}
                  onSkip={handleSkipWeather}
                  disabled={weatherApprovedRef.current || step !== 'waiting_weather_approve'}
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
  models,
  selectedModel,
  onModelChange,
}: {
  skillName: string;
  skillDescription: string;
  skillIcon: React.ElementType;
  onApprove: () => void;
  onSkip: () => void;
  disabled: boolean;
  models: { name: string; service: string; hasKey: boolean }[];
  selectedModel: string;
  onModelChange: (model: string) => void;
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

      <div className="px-3 py-2 border-t border-yellow-400/10">
        <div className="font-pixel text-[9px] tracking-widest text-zinc-500 mb-1.5">MODEL</div>
        <select
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 font-pixel text-[10px] text-zinc-200 tracking-wider focus:border-emerald-500 focus:outline-none"
          disabled={disabled}
        >
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.hasKey ? '\u25CF' : '\uD83D\uDD12'} {m.name} ({m.service})
            </option>
          ))}
        </select>
        {!models.find(m => m.name === selectedModel)?.hasKey && (
          <div className="font-pixel text-[9px] tracking-wider text-amber-400/70 mt-1">
            API key needed — you'll be prompted after approval
          </div>
        )}
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

/** Simplified approval card for CLI skills (no model selector needed) */
function CLISkillApproval({
  skillName,
  skillDescription,
  onApprove,
  onSkip,
  disabled,
}: {
  skillName: string;
  skillDescription: string;
  onApprove: () => void;
  onSkip: () => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-3 rounded-lg border border-cyan-400/30 bg-cyan-400/[0.04] overflow-hidden">
      <div className="px-3 py-2 border-b border-cyan-400/20 bg-cyan-400/[0.06]">
        <div className="font-pixel text-[11px] tracking-widest text-cyan-300">
          {'\u265B'} ENABLE CLI TOOL
        </div>
      </div>

      <div className="px-3 py-3 flex items-start gap-2.5">
        <CloudRain size={14} className="text-cyan-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-pixel text-[10px] tracking-wider text-zinc-200">
            {skillName}
          </div>
          <div className="font-pixel text-[10px] tracking-wider text-zinc-500 leading-relaxed mt-0.5">
            {skillDescription}
          </div>
        </div>
      </div>

      <div className="px-3 py-2 border-t border-cyan-400/10">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          <span className="font-pixel text-[9px] tracking-wider text-cyan-400/70">
            CLI TOOL — NO API KEY REQUIRED
          </span>
        </div>
      </div>

      {!disabled && (
        <div className="flex items-center justify-between px-3 py-2.5 border-t border-cyan-400/20 bg-cyan-400/[0.03]">
          <button
            onClick={onSkip}
            className="font-pixel text-[10px] tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            LATER
          </button>
          <button
            onClick={onApprove}
            className="retro-button !text-[8px] !py-1.5 !px-4 tracking-widest hover:!text-cyan-400"
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
