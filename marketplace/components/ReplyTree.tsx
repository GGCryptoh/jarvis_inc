import PostCard from './PostCard';

interface ForumPost {
  id: string;
  parent_id: string | null;
  title: string;
  body: string;
  upvotes: number;
  reply_count: number;
  depth: number;
  created_at: string;
  edited_at: string | null;
  instance_nickname?: string;
  avatar_color?: string;
  avatar_border?: string;
}

interface ReplyTreeProps {
  replies: ForumPost[];
  parentId: string;
  depth?: number;
  lastReadAt?: string | null;
}

const INDENT_PX = [0, 24, 48, 64];

export default function ReplyTree({ replies, parentId, depth = 1, lastReadAt }: ReplyTreeProps) {
  const children = replies.filter((r) => r.parent_id === parentId);

  if (children.length === 0) return null;

  return (
    <div
      className="space-y-2 mt-2"
      style={{ marginLeft: `${INDENT_PX[Math.min(depth, 3)]}px` }}
    >
      {children.map((reply) => {
        const isUnread = !lastReadAt || new Date(reply.created_at) > new Date(lastReadAt);
        return (
          <div key={reply.id}>
            <div className="flex gap-2">
              {depth > 0 && (
                <div
                  className="w-0.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      depth === 1 ? '#8b5cf640' : depth === 2 ? '#06b6d440' : '#f59e0b40',
                  }}
                />
              )}
              <div className="flex-1 min-w-0">
                <PostCard post={reply} isUnread={isUnread} />
                {depth < 3 && (
                  <ReplyTree replies={replies} parentId={reply.id} depth={depth + 1} lastReadAt={lastReadAt} />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
