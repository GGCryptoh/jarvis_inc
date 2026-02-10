import { Monitor, Users, Megaphone, Coffee, UserPlus } from 'lucide-react';
import type { SceneMode } from '../../types';

interface SurveillanceControlsProps {
  sceneMode: SceneMode;
  onChangeScene: (mode: SceneMode) => void;
}

const SCENE_BUTTONS: { mode: SceneMode; label: string; icon: React.ElementType }[] = [
  { mode: 'working', label: 'WORKING', icon: Monitor },
  { mode: 'meeting', label: 'TEAM MEETING', icon: Users },
  { mode: 'all_hands', label: 'ALL HANDS', icon: Megaphone },
  { mode: 'break', label: 'BREAK TIME', icon: Coffee },
  { mode: 'welcome', label: 'WELCOME AGENT', icon: UserPlus },
];

const STATUS_LABELS: Record<SceneMode, string> = {
  working: 'WORK MODE',
  meeting: 'MEETING',
  all_hands: 'ALL HANDS',
  break: 'ON BREAK',
  welcome: 'ONBOARDING',
};

export default function SurveillanceControls({ sceneMode, onChangeScene }: SurveillanceControlsProps) {
  return (
    <div className="w-[200px] flex-shrink-0 bg-pixel-bg border-r-2 border-pixel-crt-border flex flex-col">
      {/* Header */}
      <div className="retro-window-title !text-[8px] !py-2 !px-3">
        <span>CONTROLS</span>
      </div>

      {/* Scene Buttons */}
      <div className="p-2 flex flex-col gap-1">
        {SCENE_BUTTONS.map(({ mode, label, icon: Icon }) => {
          const isActive = sceneMode === mode;
          return (
            <button
              key={mode}
              className={`w-full flex items-center gap-2 px-3 py-2 font-pixel text-[8px] tracking-wider
                border-2 transition-colors
                ${isActive
                  ? 'border-t-pixel-green border-l-pixel-green border-b-pixel-bg border-r-pixel-bg bg-pixel-floor text-pixel-green'
                  : 'border-t-gray-500 border-l-gray-500 border-b-gray-800 border-r-gray-800 bg-pixel-bg text-gray-400 hover:text-pixel-green'
                }`}
              onClick={() => onChangeScene(mode)}
            >
              <Icon size={12} className="flex-shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="mx-3 border-t border-pixel-crt-border" />

      {/* Status Section */}
      <div className="p-3 mt-auto">
        <div className="retro-inset p-2">
          <div className="font-pixel text-[7px] text-gray-500 tracking-wider mb-2">STATUS</div>

          <div className="flex items-center gap-2 mb-2">
            <span className="w-[6px] h-[6px] rounded-full bg-pixel-green animate-blink flex-shrink-0" />
            <span className="font-pixel text-[8px] text-pixel-green tracking-wider">
              {STATUS_LABELS[sceneMode]}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="font-pixel text-[7px] text-gray-500 tracking-wider">AGENTS</span>
            <span className="font-pixel text-[8px] text-pixel-cyan">6</span>
          </div>

          <div className="flex items-center justify-between mt-1">
            <span className="font-pixel text-[7px] text-gray-500 tracking-wider">FEED</span>
            <span className="font-pixel text-[7px] text-pixel-green tracking-wider flex items-center gap-1">
              <span className="animate-blink">&#9679;</span> LIVE
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
