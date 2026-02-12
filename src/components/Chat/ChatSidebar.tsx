import { useState } from 'react';
import { Plus, Lock, Trash2, MessageSquare } from 'lucide-react';
import { type ConversationRow, countChatMessages } from '../../lib/database';
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
          const msgCount = countChatMessages(conv.id);

          return (
            <div key={conv.id} className="relative">
              <button
                onClick={() => onSelect(conv.id)}
                className={[
                  'w-full text-left px-3 py-3 transition-colors group',
                  isActive
                    ? 'bg-emerald-500/[0.08] border-l-2 border-emerald-400'
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
                      isActive ? 'text-emerald-300' : 'text-zinc-300',
                    ].join(' ')}>
                      {conv.title}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-pixel text-[6px] tracking-wider text-zinc-600">
                        {msgCount} msg{msgCount !== 1 ? 's' : ''}
                      </span>
                      <span className="font-pixel text-[6px] tracking-wider text-zinc-700">
                        {formatDate(conv.updated_at)}
                      </span>
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
              </button>

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
