import { useState, useMemo } from 'react';
import type { Agent } from '../../types';
import { getAgentUsage } from '../../lib/llmUsage';

/** Short activity labels shown in thought bubbles per status. */
const THOUGHT_LABELS: Partial<Record<Agent['status'], string[]>> = {
  working: ['compiling...', 'debug...', 'thinking...', 'coding...', 'refactor...', 'testing...'],
  meeting: ['hmm...', 'noted', 'agree', 'idea!', 'sync...'],
};

interface AgentSpriteProps {
  agent: Agent;
  onClick: () => void;
  floorPlannerActive?: boolean;
  /** Desk facing direction — affects sprite horizontal flip. */
  facing?: 'left' | 'right';
}

function getAnimationClass(status: Agent['status']): string {
  switch (status) {
    case 'working':
      return 'agent-typing';
    case 'walking':
    case 'arriving':
      return 'agent-walking';
    case 'celebrating':
      return 'agent-celebrating';
    case 'meeting':
      return 'agent-meeting';
    case 'break':
      return 'agent-break';
    case 'idle':
    default:
      return 'agent-idle';
  }
}

function getStatusColor(status: Agent['status']): string {
  switch (status) {
    case 'working':
      return '#50fa7b';
    case 'walking':
      return '#ffb86c';
    case 'meeting':
      return '#bd93f9';
    case 'break':
      return '#8be9fd';
    case 'arriving':
      return '#f1fa8c';
    case 'celebrating':
      return '#ff79c6';
    case 'idle':
    default:
      return '#64748b';
  }
}

export default function AgentSprite({ agent, onClick, floorPlannerActive, facing = 'right' }: AgentSpriteProps) {
  const animationClass = getAnimationClass(agent.status);
  const statusColor = getStatusColor(agent.status);
  const isSeated = agent.status === 'working';
  const isWorking = agent.status === 'working';
  const showThought = agent.status === 'working' || agent.status === 'meeting';

  // Pick a stable thought label based on agent id hash
  const thoughtLabel = useMemo(() => {
    const labels = THOUGHT_LABELS[agent.status];
    if (!labels) return '';
    let hash = 0;
    for (let i = 0; i < agent.id.length; i++) hash = ((hash << 5) - hash + agent.id.charCodeAt(i)) | 0;
    return labels[Math.abs(hash) % labels.length];
  }, [agent.id, agent.status]);

  const [cost, setCost] = useState<{ totalCost: number; taskCount: number } | null>(null);

  const handleMouseEnter = async () => {
    const usage = await getAgentUsage(agent.id);
    setCost(usage);
  };

  const handleMouseLeave = () => {
    setCost(null);
  };

  // Flip sprite horizontally when facing left
  const flipX = facing === 'left' ? 'scaleX(-1)' : '';

  return (
    <div
      className={`agent-sprite cursor-pointer group ${floorPlannerActive ? 'ring-2 ring-pixel-cyan/40 rounded-sm' : ''}`}
      style={{
        left: `${agent.position.x}%`,
        top: `${agent.position.y}%`,
        transform: `translate(-50%, -50%) translateY(${isSeated ? '22px' : '0px'})`,
      }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Thought bubble — visible during working / meeting */}
      {showThought && (
        <div className="agent-thought-bubble">
          <div className="agent-thought-dots">
            <span className="agent-thought-dot" />
            <span className="agent-thought-dot" />
            <span className="agent-thought-dot" />
          </div>
          <div className="agent-thought-label">{thoughtLabel}</div>
        </div>
      )}

      {/* Hover tooltip */}
      <div className="absolute -top-20 left-1/2 -translate-x-1/2 hidden group-hover:block z-30">
        <div className="bg-jarvis-surface border border-jarvis-border rounded px-2 py-1 text-[10px] whitespace-nowrap shadow-lg">
          <div className="text-jarvis-text font-medium">{agent.name}</div>
          <div className="text-jarvis-muted truncate max-w-[140px]">{agent.currentTask}</div>
          <div className="text-pixel-green">
            {agent.confidence}% &bull; ${agent.costSoFar.toFixed(2)}
          </div>
          {cost && (
            <div className="border-t border-jarvis-border mt-1 pt-1 text-[9px]">
              <div className="text-jarvis-muted">TASKS: {cost.taskCount}</div>
              <div className="text-pixel-yellow">COST: ${cost.totalCost.toFixed(4)}</div>
            </div>
          )}
        </div>
        {/* Tooltip arrow */}
        <div className="w-0 h-0 mx-auto border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-jarvis-border" />
      </div>

      {/* Sprite body */}
      <div className={`relative ${animationClass} ${isWorking ? 'agent-humming' : ''}`} style={{ transform: flipX || undefined }}>
        {/* Glow on hover */}
        <div
          className="absolute inset-[-6px] rounded-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          style={{
            boxShadow: `0 0 14px ${agent.color}66, 0 0 28px ${agent.color}33`,
          }}
        />

        {/* Status dot */}
        <div
          className="agent-status-dot"
          style={{ backgroundColor: statusColor }}
        />

        {/* Hair / hat */}
        <div
          className="mx-auto w-[24px] h-[10px] rounded-t-sm"
          style={{ backgroundColor: agent.color }}
        />

        {/* Head */}
        <div
          className="mx-auto w-[24px] h-[19px] rounded-sm relative"
          style={{ backgroundColor: agent.skinTone }}
        >
          {/* Pixel eyes */}
          <div className="absolute top-[6px] left-[5px] w-[3px] h-[3px] bg-black rounded-[0.5px]" />
          <div className="absolute top-[6px] right-[5px] w-[3px] h-[3px] bg-black rounded-[0.5px]" />
        </div>

        {/* Body with arms at torso level */}
        <div className="relative mx-auto flex">
          {/* Left arm — at torso side */}
          <div
            className={`w-[5px] rounded-b-sm mt-[2px] ${isWorking ? 'agent-arm-left' : ''}`}
            style={{
              backgroundColor: agent.color,
              height: isWorking ? '14px' : '18px',
            }}
          >
            {/* Left hand — at bottom of arm */}
            <div
              className="w-[5px] h-[4px] rounded-[1px] mt-auto"
              style={{ backgroundColor: agent.skinTone }}
            />
          </div>

          {/* Torso */}
          <div
            className="w-[24px] h-[24px] rounded-sm"
            style={{ backgroundColor: agent.color }}
          />

          {/* Right arm — at torso side */}
          <div
            className={`w-[5px] rounded-b-sm mt-[2px] ${isWorking ? 'agent-arm-right' : ''}`}
            style={{
              backgroundColor: agent.color,
              height: isWorking ? '14px' : '18px',
            }}
          >
            {/* Right hand — at bottom of arm */}
            <div
              className="w-[5px] h-[4px] rounded-[1px] mt-auto"
              style={{ backgroundColor: agent.skinTone }}
            />
          </div>
        </div>

        {/* Typing hands — extended forward when working (at keyboard position) */}
        {isWorking && (
          <div className="typing-hands flex justify-center -mt-[3px]">
            <div className="flex gap-[6px]">
              <div className="w-[6px] h-[4px] rounded-[1px]" style={{ backgroundColor: agent.skinTone }} />
              <div className="w-[6px] h-[4px] rounded-[1px]" style={{ backgroundColor: agent.skinTone }} />
            </div>
          </div>
        )}

        {/* Legs */}
        <div className="flex justify-center gap-[5px]">
          <div className={`w-[10px] h-[14px] rounded-b-sm bg-slate-700 ${agent.status === 'walking' ? 'animate-bob' : ''}`} />
          <div className={`w-[10px] h-[14px] rounded-b-sm bg-slate-700 ${agent.status === 'walking' ? 'animate-bob [animation-delay:0.2s]' : ''}`} />
        </div>
      </div>

      {/* Working screen glow — subtle reflected light */}
      {isWorking && (
        <div
          className="absolute top-[10px] left-1/2 -translate-x-1/2 w-[19px] h-[14px] rounded-sm animate-screen-flicker pointer-events-none"
          style={{ background: 'radial-gradient(ellipse, rgba(0,255,136,0.2) 0%, transparent 70%)' }}
        />
      )}

      {/* Name label */}
      <div className="text-center mt-1">
        <span
          className="agent-nametag"
          style={{ color: agent.color }}
        >
          {agent.name}
        </span>
      </div>
    </div>
  );
}
