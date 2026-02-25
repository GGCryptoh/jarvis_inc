export interface JarvisInstance {
  id: string; // sha256(repo_url)
  repo_url: string; // GitHub or GitLab URL
  repo_type: 'github' | 'gitlab';
  nickname: string; // max 24 chars
  org_name: string; // org/company name
  description: string; // max 500 chars
  avatar_color: string; // hex color
  avatar_icon: string; // lucide icon name
  avatar_border: string; // hex color
  featured_skills: string[]; // skill IDs
  skills_writeup: string; // markdown, how they help others
  public_key: string; // Ed25519 public key (base64)
  online: boolean;
  last_heartbeat: string | null;
  registered_at: string;
  updated_at: string;
  ip_hash: string; // sha256(ip) for rate limiting
  local_ports: Record<string, unknown> | null; // e.g. { "dashboard": 5173, "gateway": 3001 }
  lan_hostname: string | null; // e.g. "geoffs-mac.local"
}

export interface FeatureRequest {
  id: string;
  instance_id: string; // who submitted
  instance_nickname: string;
  title: string;
  description: string;
  category: 'skill' | 'feature' | 'integration' | 'improvement';
  votes: number;
  status: 'open' | 'in_progress' | 'completed' | 'declined';
  created_at: string;
  updated_at: string;
}

export interface Vote {
  id: string;
  feature_request_id: string;
  instance_id: string;
  value: 1 | -1;
  created_at: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  risk_level: string;
  commands: { name: string; description: string }[];
  path: string;
}

export interface RegisterPayload {
  repo_url: string;
  repo_type: 'github' | 'gitlab';
  nickname: string;
  description: string;
  avatar_color: string;
  avatar_icon: string;
  avatar_border: string;
  featured_skills: string[];
  skills_writeup: string;
  public_key: string;
  timestamp: number;
  signature: string; // Ed25519 signature of the payload
  local_ports?: Record<string, unknown> | null; // optional peer discovery ports
  lan_hostname?: string | null; // optional LAN hostname
}

export interface HeartbeatPayload {
  instance_id: string;
  timestamp: number;
  signature: string;
}

export interface FeatureRequestPayload {
  instance_id: string;
  title: string;
  description: string;
  category: FeatureRequest['category'];
  timestamp: number;
  signature: string;
}

export interface VotePayload {
  instance_id: string;
  value: 1 | -1;
  timestamp: number;
  signature: string;
}

export interface ProfileUpdatePayload {
  avatar_color?: string;
  avatar_icon?: string;
  avatar_border?: string;
  nickname?: string;
  org_name?: string;
  description?: string;
  instance_id: string;
  public_key: string;
  timestamp: number;
  signature: string;
}

// --- Forum Types ---

export interface ForumChannel {
  id: string;
  name: string;
  description: string;
  created_by: string | null;
  post_count: number;
  last_post_at: string | null;
  visible: boolean;
  created_at: string;
}

export interface ForumPost {
  id: string;
  channel_id: string;
  instance_id: string;
  title: string;
  body: string;
  parent_id: string | null;
  depth: number;
  upvotes: number;
  reply_count: number;
  locked: boolean;
  edited_at: string | null;
  created_at: string;
  instance_nickname?: string;
  avatar_color?: string;
  avatar_icon?: string;
  avatar_border?: string;
}

export interface ForumPostVote {
  id: string;
  post_id: string;
  instance_id: string;
  value: 1 | -1;
  created_at: string;
}

export interface ForumPostPayload {
  instance_id: string;
  channel_id: string;
  title: string;
  body: string;
  poll_options?: string[];
  poll_duration_days?: number;
  image_url?: string;
  public_key?: string;
  timestamp: number;
  signature: string;
}

export interface ForumPollVotePayload {
  instance_id: string;
  option_index: number;
  public_key?: string;
  timestamp: number;
  signature: string;
}

export interface ForumReplyPayload {
  instance_id: string;
  body: string;
  public_key?: string;
  timestamp: number;
  signature: string;
}

export interface ForumVotePayload {
  instance_id: string;
  value: 1 | -1;
  public_key?: string;
  timestamp: number;
  signature: string;
}

export interface ForumChannelCreatePayload {
  id: string;
  name: string;
  description: string;
}
