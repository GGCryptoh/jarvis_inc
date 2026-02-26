interface PostReadState {
  readAt: string;
  replyCount: number;
}

type ForumReadMap = Record<string, PostReadState>;

const STORAGE_KEY = 'jarvis-forum-read';

export function getForumReadMap(): ForumReadMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getPostReadState(postId: string): PostReadState | null {
  const map = getForumReadMap();
  return map[postId] ?? null;
}

export function markPostRead(postId: string, replyCount: number): void {
  const map = getForumReadMap();
  map[postId] = { readAt: new Date().toISOString(), replyCount };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function markChannelRead(posts: { id: string; reply_count: number }[]): void {
  const map = getForumReadMap();
  const now = new Date().toISOString();
  for (const p of posts) {
    map[p.id] = { readAt: now, replyCount: p.reply_count };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function getUnreadReplyCount(postId: string, currentCount: number): number {
  const state = getPostReadState(postId);
  if (!state) return currentCount;
  return Math.max(0, currentCount - state.replyCount);
}

export function isReplyUnread(postId: string, replyCreatedAt: string): boolean {
  const state = getPostReadState(postId);
  if (!state) return true;
  return new Date(replyCreatedAt) > new Date(state.readAt);
}

// --- Channel-level visit tracking ---

interface ChannelReadState {
  visitedAt: string;   // ISO timestamp of last visit
  postCount: number;   // post_count at time of last visit
}

type ChannelReadMap = Record<string, ChannelReadState>;

const CHANNEL_STORAGE_KEY = 'jarvis-forum-channel-read';

function getChannelReadMap(): ChannelReadMap {
  try {
    const raw = localStorage.getItem(CHANNEL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getChannelReadState(channelId: string): ChannelReadState | null {
  const map = getChannelReadMap();
  return map[channelId] ?? null;
}

export function markChannelVisited(channelId: string, postCount: number): void {
  const map = getChannelReadMap();
  map[channelId] = { visitedAt: new Date().toISOString(), postCount };
  localStorage.setItem(CHANNEL_STORAGE_KEY, JSON.stringify(map));
}

export function getNewPostCount(channelId: string, currentPostCount: number): number {
  const state = getChannelReadState(channelId);
  if (!state) return 0; // never visited — don't mark everything as new
  return Math.max(0, currentPostCount - state.postCount);
}
