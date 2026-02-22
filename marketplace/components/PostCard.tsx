import { ChevronUp, ChevronDown, Lock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface ForumPost {
  id: string;
  title: string;
  body: string;
  upvotes: number;
  reply_count: number;
  locked?: boolean;
  created_at: string;
  edited_at: string | null;
  instance_nickname?: string;
  avatar_color?: string;
  avatar_border?: string;
}

interface PostCardProps {
  post: ForumPost;
  isRoot?: boolean;
  isUnread?: boolean;
}

export default function PostCard({ post, isRoot = false, isUnread = false }: PostCardProps) {
  const showUnread = !isRoot && isUnread;

  return (
    <div
      className={`${
        isRoot
          ? 'retro-card p-6'
          : 'bg-jarvis-surface/50 border border-white/[0.04] rounded-lg p-4'
      } ${showUnread ? 'border-l-2 !border-l-red-500 shadow-[inset_0_0_12px_rgba(239,68,68,0.15)]' : ''}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-5 h-5 rounded-sm border flex items-center justify-center"
          style={{
            backgroundColor: `${post.avatar_color || '#50fa7b'}20`,
            borderColor: `${post.avatar_border || '#ff79c6'}60`,
          }}
        >
          <span className="text-[8px]" style={{ color: post.avatar_color || '#50fa7b' }}>
            {(post.instance_nickname || '?')[0].toUpperCase()}
          </span>
        </div>
        <span className="font-mono text-xs text-pixel-purple font-semibold">
          {post.instance_nickname || 'Unknown'}
        </span>
        <span className="font-mono text-[10px] text-jarvis-muted">
          {new Date(post.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        </span>
        {showUnread && (
          <span className="font-pixel text-[8px] text-red-400 tracking-wider">NEW</span>
        )}
        {post.edited_at && (
          <span className="font-mono text-[9px] text-jarvis-muted italic">(edited)</span>
        )}
        {post.locked && (
          <span className="flex items-center gap-1 font-pixel text-[8px] text-pixel-orange">
            <Lock className="w-3 h-3" /> LOCKED
          </span>
        )}
      </div>

      {isRoot && post.title && (
        <h2 className="font-mono text-base text-jarvis-text font-bold mb-3">{post.title}</h2>
      )}

      <div className="font-mono text-xs text-jarvis-text/90 leading-relaxed prose-forum">
        <ReactMarkdown
          components={{
            h1: ({ children }) => <h1 className="text-base font-bold text-jarvis-text mt-3 mb-1">{children}</h1>,
            h2: ({ children }) => <h2 className="text-sm font-bold text-jarvis-text mt-3 mb-1">{children}</h2>,
            h3: ({ children }) => <h3 className="text-xs font-bold text-jarvis-text mt-2 mb-1">{children}</h3>,
            p: ({ children }) => <p className="mb-2">{children}</p>,
            ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
            li: ({ children }) => <li className="mb-0.5">{children}</li>,
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-pixel-cyan hover:underline">
                {children}
              </a>
            ),
            code: ({ className, children }) => {
              const isBlock = className?.includes('language-');
              return isBlock ? (
                <pre className="bg-jarvis-bg/80 border border-jarvis-border rounded p-3 my-2 overflow-x-auto">
                  <code className="font-mono text-[11px] text-pixel-green">{children}</code>
                </pre>
              ) : (
                <code className="bg-jarvis-bg/60 text-pixel-green px-1 py-0.5 rounded text-[11px]">{children}</code>
              );
            },
            pre: ({ children }) => <>{children}</>,
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 border-pixel-cyan/40 pl-3 my-2 text-jarvis-muted italic">{children}</blockquote>
            ),
            hr: () => <hr className="border-jarvis-border my-3" />,
            strong: ({ children }) => <strong className="font-semibold text-jarvis-text">{children}</strong>,
            em: ({ children }) => <em className="italic">{children}</em>,
          }}
        >
          {post.body}
        </ReactMarkdown>
      </div>

      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-white/[0.04]">
        <div className="flex items-center gap-1">
          <ChevronUp className="w-4 h-4 text-pixel-green/60" />
          <span className="font-pixel text-xs text-pixel-green">{post.upvotes}</span>
          <ChevronDown className="w-4 h-4 text-pixel-red/60" />
        </div>
        <span className="font-mono text-[10px] text-jarvis-muted">
          {post.reply_count} {post.reply_count === 1 ? 'reply' : 'replies'}
        </span>
      </div>
    </div>
  );
}
