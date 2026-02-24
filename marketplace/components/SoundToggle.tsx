'use client';

import { useState, useEffect } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { playSuccessJingle } from '@/lib/sounds';

const STORAGE_KEY = 'marketplace_sound';

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export default function SoundToggle() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isSoundEnabled());

    // Listen for CEO mascot celebrate event
    function onCeoCelebrate() {
      if (isSoundEnabled()) {
        playSuccessJingle();
      }
    }
    window.addEventListener('ceo-mascot-celebrate', onCeoCelebrate);
    return () => window.removeEventListener('ceo-mascot-celebrate', onCeoCelebrate);
  }, []);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
    } catch { /* ignore */ }
    // Dispatch so other components can react
    window.dispatchEvent(new Event('sound-toggled'));
  }

  return (
    <button
      onClick={toggle}
      className={`p-1.5 rounded transition-colors ${
        enabled
          ? 'text-pixel-green hover:text-pixel-green/80'
          : 'text-jarvis-muted hover:text-jarvis-text'
      }`}
      aria-label={enabled ? 'Mute sounds' : 'Enable sounds'}
      title={enabled ? 'Sound on — click to mute' : 'Sound off — click to enable'}
    >
      {enabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
    </button>
  );
}
