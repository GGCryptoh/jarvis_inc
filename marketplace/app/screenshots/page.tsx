'use client';

import { useState } from 'react';
import Image from 'next/image';
import { X, Monitor, MessageSquare, BarChart3, Target, Blocks, DollarSign } from 'lucide-react';

interface Screenshot {
  src: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const SCREENSHOTS: Screenshot[] = [
  {
    src: '/screenshots/surveillance.png',
    title: 'SURVEILLANCE',
    description: 'Watch your AI agents work in a pixel-art office. Real-time animations, ceremonies, and live status updates.',
    icon: <Monitor className="w-4 h-4" />,
  },
  {
    src: '/screenshots/dashboard.png',
    title: 'COMMAND CENTER',
    description: 'System health, mission control, agent fleet overview, and budget tracking at a glance.',
    icon: <BarChart3 className="w-4 h-4" />,
  },
  {
    src: '/screenshots/chat.png',
    title: 'CEO CHAT',
    description: 'Talk to your CEO agent. It manages hiring, skills, missions, and delegates tasks autonomously.',
    icon: <MessageSquare className="w-4 h-4" />,
  },
  {
    src: '/screenshots/skills.png',
    title: 'AGENT SKILLS',
    description: '19+ skills across 4 categories. Toggle, assign models, test, and schedule. OAuth, API keys, and free tools.',
    icon: <Blocks className="w-4 h-4" />,
  },
  {
    src: '/screenshots/missions.png',
    title: 'MISSION CONTROL',
    description: 'Kanban board for AI tasks. Backlog, scheduled, in progress, review, and done columns.',
    icon: <Target className="w-4 h-4" />,
  },
  {
    src: '/screenshots/financials.png',
    title: 'FINANCIALS',
    description: 'Monthly budget, burn rate, daily run rate charts, and detailed cost breakdowns by LLM provider.',
    icon: <DollarSign className="w-4 h-4" />,
  },
];

export default function ScreenshotsPage() {
  const [lightbox, setLightbox] = useState<number | null>(null);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in-up">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="font-pixel text-sm sm:text-base text-pixel-green glow-green">
          SCREENSHOTS
        </h1>
        <p className="font-mono text-xs text-jarvis-muted mt-3 max-w-xl mx-auto">
          The Jarvis Inc. founder dashboard — a corporate control room with a pixel-art reactor core.
          Click any image to enlarge.
        </p>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {SCREENSHOTS.map((shot, i) => (
          <button
            key={shot.src}
            onClick={() => setLightbox(i)}
            className="group retro-card overflow-hidden text-left transition-all duration-300 hover:border-pixel-green/40 hover:shadow-[0_0_20px_rgba(80,250,123,0.08)]"
          >
            <div className="relative aspect-video overflow-hidden bg-jarvis-bg">
              <Image
                src={shot.src}
                alt={shot.title}
                fill
                className="object-cover object-top group-hover:scale-[1.02] transition-transform duration-500"
                sizes="(max-width: 768px) 100vw, 50vw"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-jarvis-bg/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-pixel-green">{shot.icon}</span>
                <h2 className="font-pixel text-[9px] text-pixel-green tracking-wider">
                  {shot.title}
                </h2>
              </div>
              <p className="font-mono text-xs text-jarvis-muted leading-relaxed">
                {shot.description}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* CTA */}
      <div className="text-center mt-12 space-y-3">
        <p className="font-pixel text-[8px] text-jarvis-muted tracking-wider">
          ONE COMMAND TO RUN EVERYTHING
        </p>
        <code className="inline-block font-mono text-sm text-pixel-green bg-jarvis-surface border border-jarvis-border rounded px-4 py-2">
          npm run jarvis
        </code>
        <div className="flex justify-center gap-4 mt-4">
          <a
            href="https://github.com/GGCryptoh/jarvis_inc"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-pixel-green hover:underline"
          >
            GitHub
          </a>
          <span className="text-jarvis-border">|</span>
          <a
            href="/about"
            className="font-mono text-xs text-pixel-cyan hover:underline"
          >
            Learn More
          </a>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors z-10"
            onClick={() => setLightbox(null)}
          >
            <X className="w-8 h-8" />
          </button>

          {/* Nav arrows */}
          {lightbox > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-4xl font-mono z-10"
              onClick={(e) => { e.stopPropagation(); setLightbox(lightbox - 1); }}
            >
              &lt;
            </button>
          )}
          {lightbox < SCREENSHOTS.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-4xl font-mono z-10"
              onClick={(e) => { e.stopPropagation(); setLightbox(lightbox + 1); }}
            >
              &gt;
            </button>
          )}

          <div className="max-w-[90vw] max-h-[85vh] relative" onClick={(e) => e.stopPropagation()}>
            <Image
              src={SCREENSHOTS[lightbox].src}
              alt={SCREENSHOTS[lightbox].title}
              width={1400}
              height={900}
              className="rounded-lg object-contain max-h-[85vh] w-auto"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 rounded-b-lg">
              <h3 className="font-pixel text-[10px] text-pixel-green glow-green">
                {SCREENSHOTS[lightbox].title}
              </h3>
              <p className="font-mono text-xs text-white/60 mt-1">
                {SCREENSHOTS[lightbox].description}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
