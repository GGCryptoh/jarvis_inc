import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { JarvisInstance } from '@/lib/types';

interface InstanceCardProps {
  instance: JarvisInstance;
}

export default function InstanceCard({ instance }: InstanceCardProps) {
  return (
    <Link href={`/instance/${instance.id}`} className="block group">
      <div className="retro-card p-5 h-full flex flex-col gap-4">
        {/* Header: Avatar + Name + Status */}
        <div className="flex items-start gap-3">
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

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-pixel text-[10px] text-jarvis-text truncate group-hover:text-pixel-green transition-colors">
                {instance.nickname}
              </h3>
              <span
                className={`status-dot shrink-0 ${
                  instance.online ? 'online' : 'offline'
                }`}
              />
            </div>
            {instance.description && (
              <p className="font-mono text-xs text-jarvis-muted mt-1.5 line-clamp-2 leading-relaxed">
                {instance.description}
              </p>
            )}
          </div>
        </div>

        {/* Skills */}
        {instance.featured_skills && instance.featured_skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-auto">
            {instance.featured_skills.slice(0, 5).map((skill) => (
              <span key={skill} className="skill-pill">
                {skill}
              </span>
            ))}
            {instance.featured_skills.length > 5 && (
              <span className="skill-pill text-pixel-muted">
                +{instance.featured_skills.length - 5}
              </span>
            )}
          </div>
        )}

        {/* Footer: Repo link */}
        {instance.repo_url && (
          <div className="flex items-center gap-1.5 text-jarvis-muted mt-auto pt-2 border-t border-jarvis-border">
            <ExternalLink className="w-3 h-3" />
            <span className="font-mono text-[10px] truncate">
              {instance.repo_type === 'github' ? 'github.com' : 'gitlab.com'}/
              {instance.repo_url.split('/').slice(-2).join('/')}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}
