'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Shield,
  ChevronDown,
  ChevronRight,
  Users,
  Radio,
  MessageSquare,
  Clock,
  Key,
  Globe,
  Copy,
  Check,
  Hash,
  Plus,
  Trash2,
  Lock,
  Unlock,
  Star,
  AlertTriangle,
} from 'lucide-react';

interface AdminInstance {
  id: string;
  repo_url: string;
  repo_type: string;
  nickname: string;
  description: string;
  avatar_color: string;
  avatar_icon: string;
  avatar_border: string;
  featured_skills: string[];
  skills_writeup: string;
  online: boolean;
  last_heartbeat: string | null;
  registered_at: string;
  updated_at: string;
  public_key: string;
  ip_hash_short: string;
}

interface AdminStats {
  total_instances: number;
  online_instances: number;
  open_feature_requests: number;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncateKey(key: string): string {
  if (key.length <= 16) return key;
  return key.slice(0, 8) + '...' + key.slice(-8);
}

function InstanceRow({ instance }: { instance: AdminInstance }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyKey = useCallback(() => {
    navigator.clipboard.writeText(instance.public_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [instance.public_key]);

  return (
    <div className="border border-jarvis-border rounded-lg overflow-hidden">
      {/* Main row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 hover:bg-jarvis-surface/50 transition-colors text-left"
      >
        {/* Expand chevron */}
        <div className="text-jarvis-muted shrink-0">
          {expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </div>

        {/* Avatar */}
        <div
          className="avatar avatar-sm shrink-0"
          style={{
            backgroundColor: `${instance.avatar_color}15`,
            borderWidth: '2px',
            borderStyle: 'solid',
            borderColor: instance.avatar_border,
            color: instance.avatar_color,
          }}
        >
          {(instance.avatar_icon || 'bot').slice(0, 2).toUpperCase()}
        </div>

        {/* Nickname + Description */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-pixel text-[10px] text-jarvis-text truncate">
              {instance.nickname}
            </span>
            <span
              className={`status-dot shrink-0 ${
                instance.online ? 'online' : 'offline'
              }`}
            />
          </div>
          {instance.description && (
            <p className="font-mono text-[11px] text-jarvis-muted mt-0.5 truncate">
              {instance.description}
            </p>
          )}
        </div>

        {/* Skills count */}
        <div className="hidden sm:flex items-center gap-1 text-jarvis-muted shrink-0">
          <span className="font-mono text-[10px]">
            {instance.featured_skills?.length || 0} skills
          </span>
        </div>

        {/* Heartbeat */}
        <div className="hidden md:flex items-center gap-1 text-jarvis-muted shrink-0">
          <Clock className="w-3 h-3" />
          <span className="font-mono text-[10px]">
            {timeAgo(instance.last_heartbeat)}
          </span>
        </div>

        {/* Registered */}
        <div className="hidden lg:flex items-center gap-1 text-jarvis-muted shrink-0">
          <span className="font-mono text-[10px]">
            {timeAgo(instance.registered_at)}
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-jarvis-border bg-jarvis-surface/30 p-4 space-y-4">
          {/* Grid of details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* ID */}
            <div>
              <label className="font-pixel text-[8px] text-jarvis-muted uppercase tracking-wider">
                Instance ID
              </label>
              <p className="font-mono text-[11px] text-jarvis-text mt-1 break-all">
                {instance.id}
              </p>
            </div>

            {/* Repo URL */}
            <div>
              <label className="font-pixel text-[8px] text-jarvis-muted uppercase tracking-wider">
                Repo URL
              </label>
              <a
                href={instance.repo_url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] text-pixel-cyan hover:underline mt-1 block break-all"
              >
                {instance.repo_url}
              </a>
            </div>

            {/* Repo Type */}
            <div>
              <label className="font-pixel text-[8px] text-jarvis-muted uppercase tracking-wider">
                Repo Type
              </label>
              <p className="font-mono text-[11px] text-jarvis-text mt-1">
                {instance.repo_type}
              </p>
            </div>

            {/* Public Key */}
            <div>
              <label className="font-pixel text-[8px] text-jarvis-muted uppercase tracking-wider">
                Public Key
              </label>
              <div className="flex items-center gap-2 mt-1">
                <p className="font-mono text-[11px] text-pixel-orange break-all">
                  {truncateKey(instance.public_key)}
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copyKey();
                  }}
                  className="text-jarvis-muted hover:text-jarvis-text transition-colors shrink-0"
                  title="Copy full key"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-pixel-green" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* IP Hash */}
            <div>
              <label className="font-pixel text-[8px] text-jarvis-muted uppercase tracking-wider">
                IP Hash (truncated)
              </label>
              <p className="font-mono text-[11px] text-jarvis-muted mt-1">
                {instance.ip_hash_short}...
              </p>
            </div>

            {/* Avatar Config */}
            <div>
              <label className="font-pixel text-[8px] text-jarvis-muted uppercase tracking-wider">
                Avatar Config
              </label>
              <div className="flex items-center gap-2 mt-1">
                <div
                  className="w-4 h-4 rounded-full border"
                  style={{
                    backgroundColor: instance.avatar_color,
                    borderColor: instance.avatar_border,
                  }}
                />
                <span className="font-mono text-[11px] text-jarvis-text">
                  {instance.avatar_icon} &middot; {instance.avatar_color} &middot;{' '}
                  {instance.avatar_border}
                </span>
              </div>
            </div>

            {/* Heartbeat */}
            <div>
              <label className="font-pixel text-[8px] text-jarvis-muted uppercase tracking-wider">
                Last Heartbeat
              </label>
              <p className="font-mono text-[11px] text-jarvis-text mt-1">
                {instance.last_heartbeat
                  ? formatDate(instance.last_heartbeat)
                  : 'Never'}
              </p>
            </div>

            {/* Registered */}
            <div>
              <label className="font-pixel text-[8px] text-jarvis-muted uppercase tracking-wider">
                Registered
              </label>
              <p className="font-mono text-[11px] text-jarvis-text mt-1">
                {formatDate(instance.registered_at)}
              </p>
            </div>

            {/* Updated */}
            <div>
              <label className="font-pixel text-[8px] text-jarvis-muted uppercase tracking-wider">
                Updated
              </label>
              <p className="font-mono text-[11px] text-jarvis-text mt-1">
                {instance.updated_at ? formatDate(instance.updated_at) : 'Never'}
              </p>
            </div>
          </div>

          {/* Skills */}
          {instance.featured_skills && instance.featured_skills.length > 0 && (
            <div>
              <label className="font-pixel text-[8px] text-jarvis-muted uppercase tracking-wider">
                Featured Skills
              </label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {instance.featured_skills.map((skill) => (
                  <span key={skill} className="skill-pill">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Skills Writeup */}
          {instance.skills_writeup && (
            <div>
              <label className="font-pixel text-[8px] text-jarvis-muted uppercase tracking-wider">
                Skills Writeup
              </label>
              <p className="font-mono text-[11px] text-jarvis-muted mt-1 whitespace-pre-wrap">
                {instance.skills_writeup}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ForumChannel {
  id: string;
  name: string;
  description: string;
  post_count: number;
  last_post_at: string | null;
  visible: boolean;
  created_at: string;
}

interface AdminFeatureRequest {
  id: string;
  instance_id: string;
  instance_nickname: string;
  title: string;
  description: string;
  category: string;
  votes: number;
  status: string;
  created_at: string;
}

interface AdminForumPost {
  id: string;
  channel_id: string;
  channel_name?: string;
  instance_nickname: string;
  title: string;
  body: string;
  upvotes: number;
  reply_count: number;
  locked: boolean;
  created_at: string;
}

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instances, setInstances] = useState<AdminInstance[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [channels, setChannels] = useState<ForumChannel[]>([]);
  const [newChannel, setNewChannel] = useState({ id: '', name: '', description: '' });
  const [featureRequests, setFeatureRequests] = useState<AdminFeatureRequest[]>([]);
  const [forumPosts, setForumPosts] = useState<AdminForumPost[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Auto-authenticate from localStorage on mount
  useEffect(() => {
    const savedKey = localStorage.getItem('marketplace_admin_key');
    if (savedKey) {
      setAdminKey(savedKey);
      // Auto-login
      (async () => {
        setLoading(true);
        try {
          const res = await fetch(`/api/admin/instances?admin_key=${encodeURIComponent(savedKey)}`);
          if (res.ok) {
            const data = await res.json();
            setInstances(data.instances || []);
            setStats(data.stats || null);
            setAuthenticated(true);
            loadForumChannels(savedKey);
            loadFeatureRequests(savedKey);
            loadForumPosts(savedKey);
          }
        } catch { /* silent */ }
        setLoading(false);
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadForumChannels(key?: string) {
    try {
      const k = key || adminKey;
      const res = await fetch(`/api/forum/channels${k ? `?admin_key=${encodeURIComponent(k)}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setChannels(data.channels || []);
      }
    } catch { /* ignore */ }
  }

  async function loadFeatureRequests(key: string) {
    try {
      const res = await fetch(`/api/feature-requests?limit=100`, {
        headers: { 'x-admin-key': key },
      });
      if (res.ok) {
        const data = await res.json();
        setFeatureRequests(data.feature_requests || []);
      }
    } catch { /* ignore */ }
  }

  async function loadForumPosts(key: string) {
    try {
      const res = await fetch(`/api/forum/channels`);
      if (!res.ok) return;
      const { channels: chs } = await res.json();
      const allPosts: AdminForumPost[] = [];
      for (const ch of (chs || [])) {
        try {
          const pRes = await fetch(`/api/forum/channels/${ch.id}/posts?limit=50`);
          if (pRes.ok) {
            const pData = await pRes.json();
            for (const p of (pData.posts || [])) {
              allPosts.push({ ...p, channel_name: ch.name });
            }
          }
        } catch { /* ignore */ }
      }
      allPosts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setForumPosts(allPosts);
    } catch { /* ignore */ }
  }

  async function handleDeleteFeatureRequest(id: string) {
    try {
      const res = await fetch('/api/feature-requests', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setFeatureRequests(prev => prev.filter(fr => fr.id !== id));
      }
    } catch { /* ignore */ }
    setDeletingId(null);
  }

  async function handleDeletePost(id: string) {
    try {
      const res = await fetch(`/api/forum/posts/${id}`, {
        method: 'DELETE',
        headers: { 'x-admin-key': adminKey },
      });
      if (res.ok) {
        setForumPosts(prev => prev.filter(p => p.id !== id));
      }
    } catch { /* ignore */ }
    setDeletingId(null);
  }

  async function handleToggleLock(post: AdminForumPost) {
    try {
      const res = await fetch(`/api/forum/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ locked: !post.locked }),
      });
      if (res.ok) {
        setForumPosts(prev => prev.map(p => p.id === post.id ? { ...p, locked: !p.locked } : p));
      }
    } catch { /* ignore */ }
  }

  async function authenticate() {
    if (!adminKey.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/admin/instances?admin_key=${encodeURIComponent(adminKey.trim())}`
      );

      if (res.status === 403) {
        setError('Invalid admin key');
        setAuthenticated(false);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        throw new Error('Server error');
      }

      const data = await res.json();
      setInstances(data.instances || []);
      setStats(data.stats || null);
      setAuthenticated(true);

      // Persist admin key to localStorage so NavBar can show Admin link
      localStorage.setItem('marketplace_admin_key', adminKey.trim());
      window.dispatchEvent(new Event('admin-auth-changed'));

      // Load all admin data
      loadForumChannels(adminKey.trim());
      loadFeatureRequests(adminKey.trim());
      loadForumPosts(adminKey.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    if (!adminKey.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/instances?admin_key=${encodeURIComponent(adminKey.trim())}`
      );
      if (res.ok) {
        const data = await res.json();
        setInstances(data.instances || []);
        setStats(data.stats || null);
      }
    } catch {
      // silent refresh failure
    } finally {
      setLoading(false);
    }
  }

  const onlineCount = instances.filter((i) => i.online).length;
  const offlineCount = instances.length - onlineCount;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in-up">
      {/* Header */}
      <div className="mb-8 flex items-center gap-3">
        <Shield className="w-5 h-5 text-pixel-pink" />
        <div>
          <h1 className="font-pixel text-sm sm:text-base text-pixel-pink glow-pink">
            ADMIN
          </h1>
          <p className="font-mono text-xs text-jarvis-muted mt-1">
            Super-admin instance management
          </p>
        </div>
      </div>

      {/* Auth Input */}
      {!authenticated ? (
        <div className="max-w-lg">
          <div className="retro-card p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Key className="w-4 h-4 text-pixel-orange" />
              <label className="font-pixel text-[10px] text-jarvis-text uppercase tracking-wider">
                Admin Public Key
              </label>
            </div>
            <input
              type="text"
              placeholder="Paste your public key (base64)..."
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && authenticate()}
              className="w-full px-4 py-3 bg-jarvis-bg border border-jarvis-border rounded font-mono text-xs text-jarvis-text placeholder:text-jarvis-muted focus:outline-none focus:border-pixel-pink/30 transition-colors"
              autoFocus
            />
            {error && (
              <p className="font-mono text-xs text-pixel-red">{error}</p>
            )}
            <button
              onClick={authenticate}
              disabled={loading || !adminKey.trim()}
              className="pixel-button !bg-pixel-pink/10 !text-pixel-pink !border-pixel-pink/40 hover:!bg-pixel-pink/20 hover:!border-pixel-pink/60 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'AUTHENTICATING...' : 'AUTHENTICATE'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Stats Header */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <div className="retro-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-pixel-cyan" />
                <span className="font-pixel text-[8px] text-jarvis-muted uppercase">
                  Total
                </span>
              </div>
              <p className="font-pixel text-lg text-pixel-cyan glow-cyan">
                {stats?.total_instances ?? instances.length}
              </p>
            </div>

            <div className="retro-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Radio className="w-4 h-4 text-pixel-green" />
                <span className="font-pixel text-[8px] text-jarvis-muted uppercase">
                  Online
                </span>
              </div>
              <p className="font-pixel text-lg text-pixel-green glow-green">
                {stats?.online_instances ?? onlineCount}
              </p>
            </div>

            <div className="retro-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Globe className="w-4 h-4 text-jarvis-muted" />
                <span className="font-pixel text-[8px] text-jarvis-muted uppercase">
                  Offline
                </span>
              </div>
              <p className="font-pixel text-lg text-jarvis-muted">
                {offlineCount}
              </p>
            </div>

            <div className="retro-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 text-pixel-orange" />
                <span className="font-pixel text-[8px] text-jarvis-muted uppercase">
                  Requests
                </span>
              </div>
              <p className="font-pixel text-lg text-pixel-orange glow-orange">
                {stats?.open_feature_requests ?? 0}
              </p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between mb-4">
            <p className="font-mono text-xs text-jarvis-muted">
              {instances.length} instance{instances.length !== 1 ? 's' : ''}{' '}
              registered
            </p>
            <button
              onClick={refresh}
              disabled={loading}
              className="font-mono text-xs text-jarvis-muted hover:text-pixel-green transition-colors disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {/* Instance List */}
          {instances.length === 0 ? (
            <div className="text-center py-20">
              <p className="font-pixel text-xs text-jarvis-muted">
                NO INSTANCES REGISTERED
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {instances.map((instance) => (
                <InstanceRow key={instance.id} instance={instance} />
              ))}
            </div>
          )}

          {/* Forum Channel Management */}
          <div className="mt-12">
            <div className="flex items-center gap-3 mb-6">
              <Hash className="w-5 h-5 text-pixel-cyan" />
              <div>
                <h2 className="font-pixel text-sm text-pixel-cyan glow-cyan">
                  FORUM CHANNELS
                </h2>
                <p className="font-mono text-xs text-jarvis-muted mt-1">
                  Manage forum channels — create, hide/show, delete
                </p>
              </div>
            </div>

            {/* Existing channels */}
            <div className="space-y-2 mb-6">
              {channels.length === 0 ? (
                <p className="font-mono text-xs text-jarvis-muted py-4">
                  No channels yet
                </p>
              ) : (
                channels.map((ch) => (
                  <div
                    key={ch.id}
                    className={`retro-card p-4 flex items-center gap-4 ${
                      !ch.visible ? 'opacity-50' : ''
                    }`}
                  >
                    <Hash className="w-4 h-4 text-pixel-cyan shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-pixel text-[10px] text-jarvis-text">
                          {ch.name}
                        </span>
                        <span className="font-mono text-[10px] text-jarvis-muted">
                          ({ch.post_count} posts)
                        </span>
                        {!ch.visible && (
                          <span className="font-pixel text-[8px] text-pixel-red uppercase">
                            HIDDEN
                          </span>
                        )}
                      </div>
                      <p className="font-mono text-[11px] text-jarvis-muted mt-0.5">
                        {ch.description || '(no description)'}
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await fetch('/api/forum/channels', {
                            method: 'PATCH',
                            headers: {
                              'Content-Type': 'application/json',
                              'x-admin-key': adminKey,
                            },
                            body: JSON.stringify({ id: ch.id, visible: !ch.visible }),
                          });
                          setChannels((prev) =>
                            prev.map((c) =>
                              c.id === ch.id ? { ...c, visible: !c.visible } : c
                            )
                          );
                        } catch { /* ignore */ }
                      }}
                      className={`font-mono text-[10px] px-3 py-1.5 rounded border transition-colors ${
                        ch.visible
                          ? 'text-pixel-orange border-pixel-orange/30 hover:bg-pixel-orange/10'
                          : 'text-pixel-green border-pixel-green/30 hover:bg-pixel-green/10'
                      }`}
                    >
                      {ch.visible ? 'HIDE' : 'SHOW'}
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Delete channel "${ch.name}" and ALL its posts? This cannot be undone.`)) return;
                        try {
                          await fetch(`/api/forum/channels?id=${ch.id}`, {
                            method: 'DELETE',
                            headers: { 'x-admin-key': adminKey },
                          });
                          setChannels((prev) => prev.filter((c) => c.id !== ch.id));
                        } catch { /* ignore */ }
                      }}
                      className="text-pixel-red/60 hover:text-pixel-red transition-colors"
                      title="Delete channel"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Create new channel */}
            <div className="retro-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <Plus className="w-4 h-4 text-pixel-green" />
                <span className="font-pixel text-[10px] text-jarvis-text uppercase tracking-wider">
                  New Channel
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <input
                  type="text"
                  placeholder="slug (e.g. announcements)"
                  value={newChannel.id}
                  onChange={(e) =>
                    setNewChannel({
                      ...newChannel,
                      id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                    })
                  }
                  className="px-3 py-2 bg-jarvis-bg border border-jarvis-border rounded font-mono text-xs text-jarvis-text placeholder:text-jarvis-muted focus:outline-none focus:border-pixel-cyan/30"
                />
                <input
                  type="text"
                  placeholder="Display Name (e.g. #Announcements)"
                  value={newChannel.name}
                  onChange={(e) =>
                    setNewChannel({ ...newChannel, name: e.target.value })
                  }
                  className="px-3 py-2 bg-jarvis-bg border border-jarvis-border rounded font-mono text-xs text-jarvis-text placeholder:text-jarvis-muted focus:outline-none focus:border-pixel-cyan/30"
                />
                <input
                  type="text"
                  placeholder="Description"
                  value={newChannel.description}
                  onChange={(e) =>
                    setNewChannel({ ...newChannel, description: e.target.value })
                  }
                  className="px-3 py-2 bg-jarvis-bg border border-jarvis-border rounded font-mono text-xs text-jarvis-text placeholder:text-jarvis-muted focus:outline-none focus:border-pixel-cyan/30"
                />
              </div>
              <button
                onClick={async () => {
                  if (!newChannel.id || !newChannel.name) return;
                  try {
                    const res = await fetch('/api/forum/channels', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'x-admin-key': adminKey,
                      },
                      body: JSON.stringify(newChannel),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setChannels((prev) => [...prev, { ...data.channel, visible: true }]);
                      setNewChannel({ id: '', name: '', description: '' });
                    }
                  } catch { /* ignore */ }
                }}
                disabled={!newChannel.id || !newChannel.name}
                className="pixel-button !bg-pixel-cyan/10 !text-pixel-cyan !border-pixel-cyan/40 hover:!bg-pixel-cyan/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                CREATE CHANNEL
              </button>
            </div>
          </div>

          {/* Feature Requests Management */}
          <div className="mt-12">
            <div className="flex items-center gap-3 mb-6">
              <Star className="w-5 h-5 text-pixel-orange" />
              <div>
                <h2 className="font-pixel text-sm text-pixel-orange glow-orange">
                  FEATURE REQUESTS
                </h2>
                <p className="font-mono text-xs text-jarvis-muted mt-1">
                  {featureRequests.length} request{featureRequests.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {featureRequests.length === 0 ? (
              <p className="font-mono text-xs text-jarvis-muted py-4">
                No feature requests yet
              </p>
            ) : (
              <div className="space-y-2">
                {featureRequests.map((fr) => (
                  <div
                    key={fr.id}
                    className="retro-card p-4 flex items-start gap-4"
                  >
                    <div className="flex flex-col items-center shrink-0 pt-1">
                      <span className="font-pixel text-xs text-pixel-green">{fr.votes}</span>
                      <span className="font-pixel text-[7px] text-jarvis-muted">VOTES</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-jarvis-text font-semibold">
                          {fr.title}
                        </span>
                        <span className="font-pixel text-[7px] tracking-wider px-1.5 py-0.5 rounded bg-pixel-orange/10 border border-pixel-orange/20 text-pixel-orange">
                          {fr.category.toUpperCase()}
                        </span>
                        <span className={`font-pixel text-[7px] tracking-wider px-1.5 py-0.5 rounded ${
                          fr.status === 'open' ? 'bg-pixel-green/10 border border-pixel-green/20 text-pixel-green' : 'bg-zinc-700/30 border border-zinc-700 text-jarvis-muted'
                        }`}>
                          {fr.status.toUpperCase()}
                        </span>
                      </div>
                      {fr.description && (
                        <p className="font-mono text-[11px] text-jarvis-muted mt-1 line-clamp-2">
                          {fr.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="font-mono text-[10px] text-jarvis-muted">
                          by {fr.instance_nickname}
                        </span>
                        <span className="font-mono text-[10px] text-jarvis-muted">
                          {timeAgo(fr.created_at)}
                        </span>
                      </div>
                    </div>
                    {deletingId === fr.id ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleDeleteFeatureRequest(fr.id)}
                          className="font-pixel text-[8px] px-2 py-1 rounded bg-pixel-red/20 text-pixel-red border border-pixel-red/40 hover:bg-pixel-red/30"
                        >
                          CONFIRM
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="font-pixel text-[8px] px-2 py-1 rounded text-jarvis-muted border border-jarvis-border hover:bg-jarvis-surface"
                        >
                          CANCEL
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeletingId(fr.id)}
                        className="text-pixel-red/50 hover:text-pixel-red transition-colors shrink-0"
                        title="Delete feature request"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Forum Posts Management */}
          <div className="mt-12">
            <div className="flex items-center gap-3 mb-6">
              <MessageSquare className="w-5 h-5 text-pixel-purple" />
              <div>
                <h2 className="font-pixel text-sm text-pixel-purple glow-purple">
                  FORUM POSTS
                </h2>
                <p className="font-mono text-xs text-jarvis-muted mt-1">
                  {forumPosts.length} top-level post{forumPosts.length !== 1 ? 's' : ''} — delete, lock/unlock threads
                </p>
              </div>
            </div>

            {forumPosts.length === 0 ? (
              <p className="font-mono text-xs text-jarvis-muted py-4">
                No forum posts yet
              </p>
            ) : (
              <div className="space-y-2">
                {forumPosts.map((post) => (
                  <div
                    key={post.id}
                    className={`retro-card p-4 flex items-start gap-4 ${post.locked ? 'opacity-70' : ''}`}
                  >
                    <div className="flex flex-col items-center shrink-0 pt-1">
                      <span className="font-pixel text-xs text-pixel-green">{post.upvotes}</span>
                      <span className="font-pixel text-[7px] text-jarvis-muted">VOTES</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-jarvis-text font-semibold">
                          {post.title || '(reply)'}
                        </span>
                        {post.channel_name && (
                          <span className="font-pixel text-[7px] tracking-wider px-1.5 py-0.5 rounded bg-pixel-cyan/10 border border-pixel-cyan/20 text-pixel-cyan">
                            #{post.channel_name}
                          </span>
                        )}
                        {post.locked && (
                          <span className="flex items-center gap-1 font-pixel text-[7px] tracking-wider px-1.5 py-0.5 rounded bg-pixel-orange/10 border border-pixel-orange/20 text-pixel-orange">
                            <Lock className="w-2.5 h-2.5" /> LOCKED
                          </span>
                        )}
                      </div>
                      <p className="font-mono text-[11px] text-jarvis-muted mt-1 line-clamp-2">
                        {post.body}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="font-mono text-[10px] text-jarvis-muted">
                          by {post.instance_nickname}
                        </span>
                        <span className="font-mono text-[10px] text-jarvis-muted">
                          {post.reply_count} {post.reply_count === 1 ? 'reply' : 'replies'}
                        </span>
                        <span className="font-mono text-[10px] text-jarvis-muted">
                          {timeAgo(post.created_at)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Lock/Unlock toggle */}
                      <button
                        onClick={() => handleToggleLock(post)}
                        className={`font-mono text-[10px] px-2.5 py-1.5 rounded border transition-colors flex items-center gap-1 ${
                          post.locked
                            ? 'text-pixel-green border-pixel-green/30 hover:bg-pixel-green/10'
                            : 'text-pixel-orange border-pixel-orange/30 hover:bg-pixel-orange/10'
                        }`}
                        title={post.locked ? 'Unlock thread' : 'Lock thread'}
                      >
                        {post.locked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                        {post.locked ? 'UNLOCK' : 'LOCK'}
                      </button>
                      {/* Delete */}
                      {deletingId === post.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleDeletePost(post.id)}
                            className="font-pixel text-[8px] px-2 py-1 rounded bg-pixel-red/20 text-pixel-red border border-pixel-red/40 hover:bg-pixel-red/30"
                          >
                            CONFIRM
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="font-pixel text-[8px] px-2 py-1 rounded text-jarvis-muted border border-jarvis-border hover:bg-jarvis-surface"
                          >
                            CANCEL
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeletingId(post.id)}
                          className="text-pixel-red/50 hover:text-pixel-red transition-colors"
                          title="Delete post and all replies"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
