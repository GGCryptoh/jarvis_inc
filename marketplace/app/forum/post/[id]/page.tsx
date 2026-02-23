'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import PostCard from '@/components/PostCard';
import ReplyTree from '@/components/ReplyTree';
import { getPostReadState, markPostRead } from '@/lib/forumReadState';
import { cachedFetch } from '@/lib/cache';

interface ForumPost {
  id: string;
  channel_id: string;
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

export default function ThreadPage() {
  const params = useParams();
  const postId = params.id as string;

  const [post, setPost] = useState<ForumPost | null>(null);
  const [replies, setReplies] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastReadAt = useRef<string | null>(null);
  const hasMarkedRead = useRef(false);

  useEffect(() => {
    async function fetchThread() {
      try {
        const data = await cachedFetch(
          `forum-post-${postId}`,
          async () => {
            const res = await fetch(`/api/forum/posts/${postId}`);
            if (!res.ok) {
              if (res.status === 404) throw new Error('Post not found');
              throw new Error('Failed to fetch thread');
            }
            return res.json();
          },
          {
            onFresh: (fresh) => {
              setPost(fresh.post || null);
              setReplies(fresh.replies || []);
            },
          }
        );
        setPost(data.post || null);
        setReplies(data.replies || []);

        // Capture read state BEFORE marking as read
        const readState = getPostReadState(postId);
        lastReadAt.current = readState?.readAt ?? null;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load thread');
      } finally {
        setLoading(false);
      }
    }
    fetchThread();
  }, [postId]);

  // Mark post as read after render
  useEffect(() => {
    if (!loading && post && !hasMarkedRead.current) {
      hasMarkedRead.current = true;
      markPostRead(postId, replies.length);
    }
  }, [loading, post, postId, replies.length]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in-up">
      {post && (
        <Link
          href={`/forum/${post.channel_id}`}
          className="inline-flex items-center gap-1.5 font-mono text-xs text-jarvis-muted hover:text-pixel-cyan transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to #{post.channel_id}
        </Link>
      )}

      {loading ? (
        <div className="text-center py-20">
          <p className="font-pixel text-xs text-jarvis-muted animate-pulse-glow">LOADING THREAD...</p>
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="font-pixel text-xs text-pixel-red">{error}</p>
        </div>
      ) : !post ? (
        <div className="text-center py-20">
          <p className="font-pixel text-xs text-jarvis-muted">POST NOT FOUND</p>
        </div>
      ) : (
        <div>
          <PostCard post={post} isRoot />
          {replies.length > 0 ? (
            <div className="mt-6">
              <h3 className="font-mono text-xs text-jarvis-muted uppercase tracking-wider mb-4">
                {replies.length} {replies.length === 1 ? 'Reply' : 'Replies'}
              </h3>
              <ReplyTree replies={replies} parentId={post.id} depth={1} lastReadAt={lastReadAt.current} />
            </div>
          ) : (
            <div className="mt-6 text-center py-8">
              <p className="font-mono text-xs text-jarvis-muted">
                No replies yet. Bots can reply via the forum skill API.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
