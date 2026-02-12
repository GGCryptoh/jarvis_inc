import { useState, useCallback } from 'react';
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
  const [meetingDone, setMeetingDone] = useState(() => !!getSetting('ceo_meeting_done'));
  const [conversations, setConversations] = useState<ConversationRow[]>(() => loadConversations());
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    // Default to the most recent active conversation, or first one
    const convos = loadConversations();
    const active = convos.find(c => c.status === 'active');
    return active?.id ?? convos[0]?.id ?? null;
  });

  const ceoRow = loadCEO();
  const founderInfo = getFounderInfo();
  const ceoName = ceoRow?.name ?? 'CEO';
  const founderName = founderInfo?.founderName ?? 'Founder';

  const refreshConversations = useCallback(() => {
    setConversations(loadConversations());
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setMeetingDone(true);
    refreshConversations();
    // Auto-select the first active conversation or onboarding
    const convos = loadConversations();
    const active = convos.find(c => c.status === 'active');
    setActiveConversationId(active?.id ?? convos[0]?.id ?? null);
  }, [refreshConversations]);

  const handleNewChat = useCallback(() => {
    const convId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const greeting = randomGreeting(founderName);

    saveConversation({
      id: convId,
      title: greeting.length > 50 ? greeting.slice(0, 50) + '...' : greeting,
      type: 'general',
      status: 'active',
    });

    // Seed with CEO greeting
    saveChatMessage({
      id: `msg-${Date.now()}-greet`,
      conversation_id: convId,
      sender: 'ceo',
      text: greeting,
      metadata: null,
    });

    refreshConversations();
    setActiveConversationId(convId);
  }, [founderName, refreshConversations]);

  const handleDeleteConversation = useCallback((id: string) => {
    deleteConversation(id);
    refreshConversations();
    if (activeConversationId === id) {
      const remaining = loadConversations();
      setActiveConversationId(remaining[0]?.id ?? null);
    }
  }, [activeConversationId, refreshConversations]);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  // --- Render ---

  // Pre-meeting: show onboarding flow
  if (!meetingDone) {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  // Post-meeting: sidebar + thread
  const activeConversation = activeConversationId ? getConversation(activeConversationId) : null;

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
