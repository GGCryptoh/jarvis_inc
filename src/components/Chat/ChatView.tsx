import { useState, useCallback, useEffect } from 'react';
import {
  getSetting, loadCEO, getFounderInfo,
  loadConversations, saveConversation, deleteConversation, getConversation,
  saveChatMessage, type ConversationRow,
} from '../../lib/database';
import OnboardingFlow from './OnboardingFlow';
import ChatSidebar from './ChatSidebar';
import ChatThread from './ChatThread';

// ---------------------------------------------------------------------------
// CEO Greetings (used when creating new conversations)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main component — thin router
// ---------------------------------------------------------------------------

export default function ChatView() {
  const [meetingDone, setMeetingDone] = useState<boolean | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<ConversationRow | null>(null);

  const [ceoName, setCeoName] = useState('CEO');
  const [founderName, setFounderName] = useState('Founder');

  // Load initial data from DB
  useEffect(() => {
    const load = async () => {
      const [meetingSetting, ceoRow, founderInfo, convos] = await Promise.all([
        getSetting('ceo_meeting_done'),
        loadCEO(),
        getFounderInfo(),
        loadConversations(),
      ]);

      setMeetingDone(!!meetingSetting);
      setCeoName(ceoRow?.name ?? 'CEO');
      setFounderName(founderInfo?.founderName ?? 'Founder');
      setConversations(convos);

      // Default to the most recent active conversation, or first one
      const active = convos.find(c => c.status === 'active');
      setActiveConversationId(active?.id ?? convos[0]?.id ?? null);
    };
    load();
  }, []);

  // Load active conversation whenever activeConversationId changes
  useEffect(() => {
    if (!activeConversationId) {
      setActiveConversation(null);
      return;
    }
    getConversation(activeConversationId).then(setActiveConversation);
  }, [activeConversationId]);

  const refreshConversations = useCallback(async () => {
    const convos = await loadConversations();
    setConversations(convos);
  }, []);

  const handleOnboardingComplete = useCallback(async () => {
    setMeetingDone(true);
    await refreshConversations();
    // Auto-select the first active conversation or onboarding
    const convos = await loadConversations();
    const active = convos.find(c => c.status === 'active');
    setActiveConversationId(active?.id ?? convos[0]?.id ?? null);
  }, [refreshConversations]);

  const handleNewChat = useCallback(async () => {
    const convId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const greeting = randomGreeting(founderName);

    await saveConversation({
      id: convId,
      title: greeting.length > 50 ? greeting.slice(0, 50) + '...' : greeting,
      type: 'general',
      status: 'active',
    });

    // Seed with CEO greeting
    await saveChatMessage({
      id: `msg-${Date.now()}-greet`,
      conversation_id: convId,
      sender: 'ceo',
      text: greeting,
      metadata: null,
    });

    await refreshConversations();
    setActiveConversationId(convId);
  }, [founderName, refreshConversations]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    await deleteConversation(id);
    await refreshConversations();
    if (activeConversationId === id) {
      const remaining = await loadConversations();
      setActiveConversationId(remaining[0]?.id ?? null);
    }
  }, [activeConversationId, refreshConversations]);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  // --- Render ---

  // Still loading initial data
  if (meetingDone === null) {
    return null;
  }

  // Pre-meeting: show onboarding flow
  if (!meetingDone) {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  // Post-meeting: sidebar + thread
  return (
    <div className="flex-1 flex h-full">
      <ChatSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelect={handleSelectConversation}
        onNewChat={handleNewChat}
        onDelete={handleDeleteConversation}
      />

      {activeConversation ? (
        <ChatThread
          key={activeConversation.id}
          conversation={activeConversation}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="font-pixel text-[10px] tracking-wider text-zinc-500 mb-3">
              No conversation selected
            </div>
            <button
              onClick={handleNewChat}
              className="retro-button !text-[9px] !py-2.5 !px-5 tracking-widest hover:!text-emerald-400"
            >
              START NEW CHAT
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
