import { useState, useEffect } from 'react';
import { Plus, Lock, Trash2, MessageSquare } from 'lucide-react';
import { type ConversationRow, countChatMessages, getConversationReadCount } from '../../lib/database';
import DeleteConvoDialog from './DeleteConvoDialog';

interface ChatSidebarProps {
  conversations: ConversationRow[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'Z');
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function ChatSidebar({ conversations, activeConversationId, onSelect, onNewChat, onDelete }: ChatSidebarProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [messageCounts, setMessageCounts] = useState<Record<string, number>>({});
  const [unreadConvos, setUnreadConvos] = useState<Set<string>>(new Set());

  // Preload all message counts + detect unread when conversations change or read status changes
  const [readVersion, setReadVersion] = useState(0);

  useEffect(() => {
    const onChatRead = () => setReadVersion(v => v + 1);
    window.addEventListener('chat-read', onChatRead);
    return () => window.removeEventListener('chat-read', onChatRead);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const counts: Record<string, number> = {};
      const unread = new Set<string>();
      await Promise.all(
        conversations.map(async (conv) => {
          const count = await countChatMessages(conv.id);
          counts[conv.id] = count;
          const readCount = getConversationReadCount(conv.id);
          if (count > readCount) unread.add(conv.id);
        })
      );
      if (!cancelled) {
        setMessageCounts(counts);
        setUnreadConvos(unread);
      }
    })();
    return () => { cancelled = true; };
  }, [conversations, readVersion]);

  return (
    <div className="w-60 flex-shrink-0 bg-jarvis-surface border-r border-white/[0.06] flex flex-col h-full">
      {/* Header + New Chat */}
      <div className="px-3 py-3 border-b border-white/[0.06]">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 transition-colors"
        >
          <Plus size={14} />
          <span className="font-pixel text-[8px] tracking-widest">NEW CHAT</span>
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {conversations.length === 0 && (
          <div className="px-3 py-8 text-center">
            <MessageSquare size={20} className="mx-auto text-zinc-700 mb-2" />
            <div className="font-pixel text-[7px] tracking-wider text-zinc-600">
              No conversations yet
            </div>
          </div>
        )}

        {conversations.map(conv => {
          const isActive = conv.id === activeConversationId;
          const isOnboarding = conv.type === 'onboarding';
          const isDeleting = deleteTarget === conv.id;
          const msgCount = messageCounts[conv.id] ?? 0;
          const isUnread = unreadConvos.has(conv.id) && !isActive;

          return (
            <div key={conv.id} className="relative">
              <div
                role="button"
                tabIndex={0}
                onClick={() => onSelect(conv.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(conv.id); } }}
                className={[
                  'w-full text-left px-3 py-3 transition-colors group cursor-pointer',
                  isActive
                    ? 'bg-emerald-500/[0.08] border-l-2 border-emerald-400'
                    : isUnread
                      ? 'border-l-2 border-yellow-400 bg-yellow-400/[0.04]'
                      : 'border-l-2 border-transparent hover:bg-white/[0.02]',
                ].join(' ')}
              >
                <div className="flex items-start gap-2">
                  {isOnboarding && (
                    <Lock size={10} className="text-amber-400/60 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={[
                      'font-pixel text-[8px] tracking-wider truncate',
                      isActive ? 'text-emerald-300' : isUnread ? 'text-yellow-300' : 'text-zinc-300',
                    ].join(' ')}>
                      {conv.title}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={[
                        'font-pixel text-[6px] tracking-wider',
                        isUnread ? 'text-yellow-400/70' : 'text-zinc-600',
                      ].join(' ')}>
                        {msgCount} msg{msgCount !== 1 ? 's' : ''}
                      </span>
                      <span className="font-pixel text-[6px] tracking-wider text-zinc-700">
                        {formatDate(conv.updated_at)}
                      </span>
                      {isUnread && (
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />
                      )}
                    </div>
                  </div>

                  {/* Delete button — not shown for onboarding */}
                  {!isOnboarding && (
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteTarget(conv.id); }}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all flex-shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Inline delete confirmation */}
              {isDeleting && (
                <DeleteConvoDialog
                  onConfirm={() => { onDelete(conv.id); setDeleteTarget(null); }}
                  onCancel={() => setDeleteTarget(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
