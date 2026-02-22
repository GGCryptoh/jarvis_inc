import { useState, useEffect } from 'react';

const PIXEL_COLORS = ['#50fa7b', '#ff79c6', '#f1fa8c', '#8be9fd', '#ffb86c', '#bd93f9', '#ff5555'];

interface PixelConfettiProps {
  active: boolean;
  onComplete?: () => void;
}

export default function PixelConfetti({ active, onComplete }: PixelConfettiProps) {
  const [particles, setParticles] = useState<Array<{
    id: number;
    color: string;
    x: string;
    peak: string;
    fall: string;
    size: number;
    delay: string;
    duration: string;
  }>>([]);

  useEffect(() => {
    if (!active) {
      setParticles([]);
      return;
    }

    const generated = Array.from({ length: 25 }, (_, i) => ({
      id: i,
      color: PIXEL_COLORS[i % PIXEL_COLORS.length],
      x: `${(Math.random() - 0.5) * 200}px`,
      peak: `${-80 - Math.random() * 80}px`,
      fall: `${40 + Math.random() * 60}px`,
      size: 4 + Math.floor(Math.random() * 5),
      delay: `${Math.random() * 0.3}s`,
      duration: `${1.5 + Math.random() * 0.8}s`,
    }));

    setParticles(generated);

    const timer = setTimeout(() => {
      setParticles([]);
      onComplete?.();
    }, 2500);

    return () => clearTimeout(timer);
  }, [active, onComplete]);

  if (particles.length === 0) return null;

  return (
    <div className="absolute inset-0 z-[18] pointer-events-none overflow-hidden">
      {/* Burst origin: center of office */}
      <div className="absolute left-1/2 top-1/2">
        {particles.map(p => (
          <div
            key={p.id}
            style={{
              position: 'absolute',
              width: `${p.size}px`,
              height: `${p.size}px`,
              backgroundColor: p.color,
              boxShadow: `0 0 4px ${p.color}88`,
              borderRadius: '1px',
              animation: `confetti-burst ${p.duration} cubic-bezier(0.25, 0.46, 0.45, 0.94) ${p.delay} forwards`,
              '--confetti-x': p.x,
              '--confetti-peak': p.peak,
              '--confetti-fall': p.fall,
            } as React.CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
