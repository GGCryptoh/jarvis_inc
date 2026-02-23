'use client';

import { useEffect, useState } from 'react';
import { Search, Filter } from 'lucide-react';
import InstanceCard from '@/components/InstanceCard';
import type { JarvisInstance } from '@/lib/types';
import { cachedFetch } from '@/lib/cache';

export default function GalleryPage() {
  const [instances, setInstances] = useState<JarvisInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    async function fetchGallery() {
      try {
        const data = await cachedFetch(
          'gallery',
          async () => {
            const res = await fetch('/api/gallery?limit=200');
            if (!res.ok) throw new Error('Failed to fetch gallery');
            return res.json();
          },
          { onFresh: (fresh) => setInstances(fresh.instances || []) }
        );
        setInstances(data.instances || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load gallery');
      } finally {
        setLoading(false);
      }
    }
    fetchGallery();
  }, []);

  const filtered = instances.filter((inst) => {
    if (onlineOnly && !inst.online) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        inst.nickname.toLowerCase().includes(q) ||
        inst.description?.toLowerCase().includes(q) ||
        inst.featured_skills?.some((s) => s.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-pixel text-sm sm:text-base text-pixel-green glow-green">
          GALLERY
        </h1>
        <p className="font-mono text-xs text-jarvis-muted mt-2">
          Registered Jarvis instances across the network
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-8">
        {/* Search */}
        <div className="relative flex-1 max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-jarvis-muted" />
          <input
            type="text"
            placeholder="Search instances..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-jarvis-surface border border-jarvis-border rounded font-mono text-xs text-jarvis-text placeholder:text-jarvis-muted focus:outline-none focus:border-pixel-green/30 transition-colors"
          />
        </div>

        {/* Online Toggle */}
        <button
          onClick={() => setOnlineOnly(!onlineOnly)}
          className={`flex items-center gap-2 px-3 py-2 rounded border font-mono text-xs transition-colors ${
            onlineOnly
              ? 'bg-pixel-green/10 border-pixel-green/30 text-pixel-green'
              : 'bg-jarvis-surface border-jarvis-border text-jarvis-muted hover:text-jarvis-text'
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          <span className="status-dot online" />
          Online Only
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-20">
          <p className="font-pixel text-xs text-jarvis-muted animate-pulse-glow">
            LOADING INSTANCES...
          </p>
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="font-pixel text-xs text-pixel-red">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="font-pixel text-xs text-jarvis-muted">
            {instances.length === 0
              ? 'NO INSTANCES REGISTERED YET'
              : 'NO MATCHING INSTANCES'}
          </p>
          <p className="font-mono text-xs text-jarvis-muted mt-3">
            {instances.length === 0
              ? 'Be the first to register via the API.'
              : 'Try adjusting your search or filters.'}
          </p>
        </div>
      ) : (
        <>
          <p className="font-mono text-xs text-jarvis-muted mb-4">
            Showing {filtered.length} instance{filtered.length !== 1 ? 's' : ''}
            {onlineOnly ? ' (online only)' : ''}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((instance) => (
              <InstanceCard key={instance.id} instance={instance} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
