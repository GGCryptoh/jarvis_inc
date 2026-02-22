import { ChevronUp } from 'lucide-react';
import type { FeatureRequest } from '@/lib/types';

interface FeatureCardProps {
  feature: FeatureRequest;
}

const CATEGORY_CLASSES: Record<string, string> = {
  skill: 'badge-skill',
  feature: 'badge-feature',
  integration: 'badge-integration',
  improvement: 'badge-improvement',
};

export default function FeatureCard({ feature }: FeatureCardProps) {
  return (
    <div className="retro-card p-5 flex gap-4">
      {/* Vote Count */}
      <div className="flex flex-col items-center shrink-0 pt-1">
        <ChevronUp className="w-5 h-5 text-pixel-green" />
        <span className="font-pixel text-sm text-pixel-green glow-green">
          {feature.votes}
        </span>
        <span className="font-mono text-[9px] text-jarvis-muted mt-0.5">
          votes
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap">
          <h3 className="font-mono text-sm text-jarvis-text font-semibold leading-snug">
            {feature.title}
          </h3>
          <span
            className={`badge shrink-0 ${
              CATEGORY_CLASSES[feature.category] || 'badge-feature'
            }`}
          >
            {feature.category}
          </span>
        </div>

        {feature.description && (
          <p className="font-mono text-xs text-jarvis-muted mt-2 line-clamp-2 leading-relaxed">
            {feature.description}
          </p>
        )}

        <div className="flex items-center gap-3 mt-3">
          <span className="font-mono text-[10px] text-jarvis-muted">
            by{' '}
            <span className="text-pixel-purple">
              {feature.instance_nickname}
            </span>
          </span>
          <span className="font-mono text-[10px] text-jarvis-muted">
            {new Date(feature.created_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
