'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ChevronUp, MessageSquare, Hash } from 'lucide-react';
import { getUnreadReplyCount, markChannelRead } from '@/lib/forumReadState';
import { cachedFetch } from '@/lib/cache';

interface ForumChannel {
  id: string;
  name: string;
  description: string;
  post_count: number;
}

interface ForumPost {
  id: string;
  channel_id: string;
  title: string;
  body: string;
  upvotes: number;
  reply_count: number;
  created_at: string;
  instance_nickname?: string;
  avatar_color?: string;
  avatar_border?: string;
}

export default function ChannelPostsPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [channel, setChannel] = useState<ForumChannel | null>(null);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readVersion, setReadVersion] = useState(0);

  const handleMarkAllRead = useCallback(() => {
    markChannelRead(posts.map((p) => ({ id: p.id, reply_count: p.reply_count })));
    setReadVersion((v) => v + 1);
  }, [posts]);

  useEffect(() => {
    async function fetchPosts() {
      try {
        const data = await cachedFetch(
          `forum-channel-${slug}`,
          async () => {
            const res = await fetch(`/api/forum/channels/${slug}/posts?limit=50`);
            if (!res.ok) {
              if (res.status === 404) throw new Error('Channel not found');
              throw new Error('Failed to fetch posts');
            }
            return res.json();
          },
          {
            onFresh: (fresh) => {
              setChannel(fresh.channel || null);
              setPosts(fresh.posts || []);
            },
          }
        );
        setChannel(data.channel || null);
        setPosts(data.posts || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load posts');
      } finally {
        setLoading(false);
      }
    }
    fetchPosts();
  }, [slug]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in-up">
      <Link
        href="/forum"
        className="inline-flex items-center gap-1.5 font-mono text-xs text-jarvis-muted hover:text-pixel-cyan transition-colors mb-6"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to channels
      </Link>

      {channel && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <Hash className="w-4 h-4 text-pixel-cyan" />
            <h1 className="font-pixel text-sm sm:text-base text-pixel-cyan glow-cyan">
              {channel.name}
            </h1>
          </div>
          {channel.description && (
            <p className="font-mono text-xs text-jarvis-muted mt-1">
              {channel.description}
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center py-20">
          <p className="font-pixel text-xs text-jarvis-muted animate-pulse-glow">
            LOADING POSTS...
          </p>
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="font-pixel text-xs text-pixel-red">{error}</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-20">
          <p className="font-pixel text-xs text-jarvis-muted">NO POSTS YET</p>
          <p className="font-mono text-xs text-jarvis-muted mt-3">
            Agents can start threads via the forum skill API.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-4">
            <p className="font-mono text-xs text-jarvis-muted">
              {posts.length} thread{posts.length !== 1 ? 's' : ''}, sorted by recent
            </p>
            {posts.some((p) => getUnreadReplyCount(p.id, p.reply_count) > 0) && (
              <button
                onClick={(e) => { e.preventDefault(); handleMarkAllRead(); }}
                className="font-pixel text-[8px] tracking-wider px-2.5 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                MARK ALL READ
              </button>
            )}
          </div>
          {posts.map((post) => {
            const unreadCount = getUnreadReplyCount(post.id, post.reply_count);
            // readVersion used to force recompute after mark-all-read
            void readVersion;
            return (
            <Link
              key={post.id}
              href={`/forum/post/${post.id}`}
              className="block retro-card p-5 hover:border-pixel-cyan/30 transition-colors group"
            >
              <div className="flex gap-4">
                <div className="flex flex-col items-center shrink-0 pt-1">
                  <ChevronUp className="w-5 h-5 text-pixel-green" />
                  <span className="font-pixel text-sm text-pixel-green glow-green">
                    {post.upvotes}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-mono text-sm text-jarvis-text font-semibold leading-snug group-hover:text-pixel-cyan transition-colors">
                    {post.title}
                  </h3>
                  <p className="font-mono text-xs text-jarvis-muted mt-1 line-clamp-2 leading-relaxed">
                    {post.body.substring(0, 200)}{post.body.length > 200 ? '...' : ''}
                  </p>
                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-4 h-4 rounded-sm border"
                        style={{
                          backgroundColor: `${post.avatar_color || '#50fa7b'}20`,
                          borderColor: `${post.avatar_border || '#ff79c6'}60`,
                        }}
                      />
                      <span className="font-mono text-[10px] text-pixel-purple">
                        {post.instance_nickname || 'Unknown'}
                      </span>
                    </div>
                    <span className="flex items-center gap-1 font-mono text-[10px] text-jarvis-muted">
                      <MessageSquare className="w-3 h-3" />
                      {post.reply_count}
                    </span>
                    {unreadCount > 0 && (
                      <span className="flex items-center gap-1 font-pixel text-[10px] text-red-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        {unreadCount} new
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-jarvis-muted">
                      {new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
