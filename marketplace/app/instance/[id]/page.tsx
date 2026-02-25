import Link from 'next/link';
import { ArrowLeft, ExternalLink, Clock, Calendar } from 'lucide-react';
import { getInstanceById } from '@/lib/db';
import { notFound } from 'next/navigation';
import EscBack from './EscBack';

export const dynamic = 'force-dynamic';

interface InstancePageProps {
  params: Promise<{ id: string }>;
}

export default async function InstancePage({ params }: InstancePageProps) {
  const { id } = await params;
  let instance;

  try {
    instance = await getInstanceById(id);
  } catch {
    // DB error — show not found
  }

  if (!instance) {
    notFound();
  }

  const registeredDate = instance.registered_at
    ? new Date(instance.registered_at).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Unknown';

  const lastHeartbeat = instance.last_heartbeat
    ? formatRelativeTime(new Date(instance.last_heartbeat))
    : 'Never';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in-up">
      <EscBack />
      {/* Back link */}
      <Link
        href="/gallery"
        className="inline-flex items-center gap-2 font-mono text-xs text-jarvis-muted hover:text-pixel-green transition-colors mb-8"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Gallery
      </Link>

      {/* Instance Header */}
      <div className="retro-card p-6 sm:p-8 mb-6">
        <div className="flex flex-col sm:flex-row items-start gap-6">
          {/* Large Avatar */}
          <div
            className="avatar avatar-lg shrink-0"
            style={{
              backgroundColor: `${instance.avatar_color}15`,
              borderWidth: '3px',
              borderStyle: 'solid',
              borderColor: instance.avatar_border,
              color: instance.avatar_color,
            }}
          >
            {(instance.avatar_icon || 'bot').slice(0, 3).toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-pixel text-sm sm:text-base text-jarvis-text">
                {instance.nickname}
              </h1>
              <span
                className={`status-dot ${
                  instance.online ? 'online' : 'offline'
                }`}
              />
              <span className="font-mono text-xs text-jarvis-muted">
                {instance.online ? 'Online' : 'Offline'}
              </span>
            </div>

            {instance.org_name && (
              <p className="font-mono text-xs text-pixel-purple/70 mt-1">
                {instance.org_name}
              </p>
            )}

            {instance.description && (
              <p className="font-mono text-sm text-jarvis-muted mt-3 leading-relaxed">
                {instance.description}
              </p>
            )}

            {/* Meta Row */}
            <div className="flex flex-wrap items-center gap-4 mt-4">
              <div className="flex items-center gap-1.5 text-jarvis-muted">
                <Calendar className="w-3.5 h-3.5" />
                <span className="font-mono text-xs">
                  Registered {registeredDate}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-jarvis-muted">
                <Clock className="w-3.5 h-3.5" />
                <span className="font-mono text-xs">
                  Last seen {lastHeartbeat}
                </span>
              </div>
            </div>

            {/* Repo Link */}
            {instance.repo_url && (
              <a
                href={instance.repo_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-4 font-mono text-xs text-pixel-green hover:text-pixel-green/80 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {instance.repo_url}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Featured Skills */}
      {instance.featured_skills && instance.featured_skills.length > 0 && (
        <div className="retro-card p-6 sm:p-8 mb-6">
          <h2 className="font-pixel text-[10px] text-pixel-cyan glow-cyan mb-4">
            FEATURED SKILLS
          </h2>
          <div className="flex flex-wrap gap-2">
            {instance.featured_skills.map((skill: string) => (
              <span
                key={skill}
                className="inline-block px-3 py-1.5 font-mono text-xs text-pixel-cyan bg-pixel-cyan/5 border border-pixel-cyan/20 rounded"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Skills Writeup */}
      {instance.skills_writeup && (
        <div className="retro-card p-6 sm:p-8">
          <h2 className="font-pixel text-[10px] text-pixel-purple glow-purple mb-4">
            ABOUT THIS INSTANCE
          </h2>
          <div className="font-mono text-sm text-jarvis-muted leading-relaxed whitespace-pre-wrap">
            {instance.skills_writeup}
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
