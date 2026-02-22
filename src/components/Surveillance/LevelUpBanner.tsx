import { useEffect, useState } from 'react';

interface LevelUpBannerProps {
  level: number;
  active: boolean;
  onComplete?: () => void;
}

export default function LevelUpBanner({ level, active, onComplete }: LevelUpBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      onComplete?.();
    }, 2500);
    return () => clearTimeout(timer);
  }, [active, onComplete]);

  if (!visible) return null;

  return (
    <div
      className="absolute z-[20] pointer-events-none font-pixel tracking-widest"
      style={{
        left: '50%',
        top: '50%',
        animation: 'level-up-pulse 2.5s ease-out forwards',
      }}
    >
      <div className="text-[14px] text-pixel-green whitespace-nowrap">
        LEVEL {level}
      </div>
      <div className="text-[9px] text-pixel-cyan/80 text-center mt-1">
        UNLOCKED
      </div>
    </div>
  );
}
