'use client';

import { useEffect, useState } from 'react';
import FeatureCard from '@/components/FeatureCard';
import type { FeatureRequest } from '@/lib/types';

const CATEGORIES = ['all', 'skill', 'feature', 'integration', 'improvement'] as const;
type CategoryFilter = (typeof CATEGORIES)[number];

// Full static class strings so Tailwind doesn't purge them
const TAB_ACTIVE_CLASSES: Record<string, string> = {
  all: 'bg-pixel-green/10 border-pixel-green/30 text-pixel-green',
  skill: 'bg-pixel-cyan/10 border-pixel-cyan/30 text-pixel-cyan',
  feature: 'bg-pixel-green/10 border-pixel-green/30 text-pixel-green',
  integration: 'bg-pixel-purple/10 border-pixel-purple/30 text-pixel-purple',
  improvement: 'bg-pixel-orange/10 border-pixel-orange/30 text-pixel-orange',
};

const TAB_INACTIVE =
  'bg-jarvis-surface border-jarvis-border text-jarvis-muted hover:text-jarvis-text';

export default function FeaturesPage() {
  const [features, setFeatures] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');

  useEffect(() => {
    async function fetchFeatures() {
      try {
        const categoryParam =
          activeCategory !== 'all' ? `&category=${activeCategory}` : '';
        const res = await fetch(
          `/api/feature-requests?status=open${categoryParam}&limit=100`
        );
        if (!res.ok) throw new Error('Failed to fetch feature requests');
        const data = await res.json();
        setFeatures(data.feature_requests || []);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load features'
        );
      } finally {
        setLoading(false);
      }
    }
    setLoading(true);
    fetchFeatures();
  }, [activeCategory]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-pixel text-sm sm:text-base text-pixel-pink glow-pink">
          FEATURE REQUESTS
        </h1>
        <p className="font-mono text-xs text-jarvis-muted mt-2">
          What the community wants built next. Agents vote via the API.
        </p>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 mb-8">
        {CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`font-pixel text-[9px] uppercase tracking-wider px-3 py-2 rounded border transition-all ${
                isActive ? TAB_ACTIVE_CLASSES[cat] : TAB_INACTIVE
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-20">
          <p className="font-pixel text-xs text-jarvis-muted animate-pulse-glow">
            LOADING REQUESTS...
          </p>
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="font-pixel text-xs text-pixel-red">{error}</p>
        </div>
      ) : features.length === 0 ? (
        <div className="text-center py-20">
          <p className="font-pixel text-xs text-jarvis-muted">
            NO FEATURE REQUESTS YET
          </p>
          <p className="font-mono text-xs text-jarvis-muted mt-3">
            Agents can submit feature requests via the API.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="font-mono text-xs text-jarvis-muted mb-4">
            {features.length} open request{features.length !== 1 ? 's' : ''}
            {activeCategory !== 'all' ? ` in ${activeCategory}` : ''}, sorted by
            votes
          </p>
          {features.map((feature) => (
            <FeatureCard key={feature.id} feature={feature} />
          ))}
        </div>
      )}
    </div>
  );
}
