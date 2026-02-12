import type { Agent } from '../../types';

interface AgentSpriteProps {
  agent: Agent;
  onClick: () => void;
  floorPlannerActive?: boolean;
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

export default function AgentSprite({ agent, onClick, floorPlannerActive }: AgentSpriteProps) {
  const animationClass = getAnimationClass(agent.status);
  const statusColor = getStatusColor(agent.status);
  const isSeated = agent.status === 'working';

  return (
    <div
      className={`agent-sprite cursor-pointer group ${floorPlannerActive ? 'ring-2 ring-pixel-cyan/40 rounded-sm' : ''}`}
      style={{
        left: `${agent.position.x}%`,
        top: `${agent.position.y}%`,
        transform: `translate(-50%, -50%) translateY(${isSeated ? '22px' : '0px'})`,
      }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {/* Hover tooltip */}
      <div className="absolute -top-20 left-1/2 -translate-x-1/2 hidden group-hover:block z-30">
        <div className="bg-jarvis-surface border border-jarvis-border rounded px-2 py-1 text-[10px] whitespace-nowrap shadow-lg">
          <div className="text-jarvis-text font-medium">{agent.name}</div>
          <div className="text-jarvis-muted truncate max-w-[140px]">{agent.currentTask}</div>
          <div className="text-pixel-green">
            {agent.confidence}% &bull; ${agent.costSoFar.toFixed(2)}
          </div>
        </div>
        {/* Tooltip arrow */}
        <div className="w-0 h-0 mx-auto border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-jarvis-border" />
      </div>

      {/* Sprite body */}
      <div className={`relative ${animationClass}`}>
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
          className="mx-auto w-[24px] h-[19px] rounded-sm"
          style={{ backgroundColor: agent.skinTone }}
        />

        {/* Body */}
        <div
          className="mx-auto w-[29px] h-[24px] rounded-sm"
          style={{ backgroundColor: agent.color }}
        />

        {/* Legs */}
        <div className="flex justify-center gap-[5px]">
          <div className={`w-[10px] h-[14px] rounded-b-sm bg-slate-700 ${agent.status === 'walking' ? 'animate-bob' : ''}`} />
          <div className={`w-[10px] h-[14px] rounded-b-sm bg-slate-700 ${agent.status === 'walking' ? 'animate-bob [animation-delay:0.2s]' : ''}`} />
        </div>
      </div>

      {/* Working screen glow — subtle reflected light */}
      {agent.status === 'working' && (
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
