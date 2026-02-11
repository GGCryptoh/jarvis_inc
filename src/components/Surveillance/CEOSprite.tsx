import type { Agent } from '../../types';

interface CEOSpriteProps {
  agent: Agent;
  onClick: () => void;
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

/**
 * Larger CEO sprite (~2.5-3x size of regular AgentSprite).
 * Features: pixel eyes, suit lapels, tie, arms, crown, gold nametag.
 */
export default function CEOSprite({ agent, onClick }: CEOSpriteProps) {
  const animationClass = getAnimationClass(agent.status);
  const statusColor = getStatusColor(agent.status);
  const gold = '#f1fa8c';
  const isSeated = agent.status === 'working';

  return (
    <div
      className="agent-sprite cursor-pointer group"
      style={{
        left: `${agent.position.x}%`,
        top: `${agent.position.y}%`,
        transform: `translate(-50%, -50%) translateY(${isSeated ? '20px' : '0px'})`,
        zIndex: 6,
      }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {/* Hover tooltip — CEO-specific info */}
      <div className="absolute -top-[70px] left-1/2 -translate-x-1/2 hidden group-hover:block z-30">
        <div className="bg-jarvis-surface border border-jarvis-border rounded px-2 py-1.5 text-[10px] whitespace-nowrap shadow-lg">
          <div className="font-medium" style={{ color: gold }}>CEO {agent.name}</div>
          <div className="text-jarvis-muted truncate max-w-[160px]">{agent.currentTask}</div>
          <div className="text-pixel-cyan text-[9px]">{agent.model}</div>
        </div>
        <div className="w-0 h-0 mx-auto border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-jarvis-border" />
      </div>

      {/* Sprite body — 2.5x scale */}
      <div className={`relative ${animationClass}`}>
        {/* Gold hover glow */}
        <div
          className="absolute inset-[-6px] rounded-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          style={{ boxShadow: `0 0 16px ${gold}66, 0 0 32px ${gold}33` }}
        />

        {/* Status dot — larger, gold-ringed */}
        <div
          className="absolute -top-[4px] -right-[4px] w-[8px] h-[8px] rounded-full z-10"
          style={{
            backgroundColor: statusColor,
            border: `2px solid ${gold}`,
            boxShadow: `0 0 6px ${statusColor}`,
          }}
        />

        {/* Crown */}
        <div className="text-center" style={{ fontSize: '15px', lineHeight: '17px', color: gold, textShadow: `0 0 6px ${gold}66` }}>
          ♛
        </div>

        {/* Hair / hat */}
        <div
          className="mx-auto w-[24px] h-[8px] rounded-t-sm"
          style={{ backgroundColor: agent.color }}
        />

        {/* Head — larger with pixel eyes and mouth */}
        <div
          className="mx-auto w-[24px] h-[21px] rounded-sm relative"
          style={{ backgroundColor: agent.skinTone }}
        >
          {/* Left eye */}
          <div className="absolute top-[6px] left-[5px] w-[3px] h-[3px] bg-black rounded-[0.5px]" />
          {/* Right eye */}
          <div className="absolute top-[6px] right-[5px] w-[3px] h-[3px] bg-black rounded-[0.5px]" />
          {/* Mouth */}
          <div className="absolute bottom-[3px] left-1/2 -translate-x-1/2 w-[6px] h-[2px] bg-black/40 rounded-full" />
        </div>

        {/* Body with suit lapels and tie */}
        <div className="relative mx-auto flex">
          {/* Left arm */}
          <div
            className="w-[6px] h-[18px] rounded-b-sm mt-[3px]"
            style={{ backgroundColor: agent.color }}
          />
          {/* Torso */}
          <div
            className="w-[30px] h-[24px] rounded-sm relative"
            style={{ backgroundColor: agent.color }}
          >
            {/* Suit lapels — darker inner rect */}
            <div
              className="absolute inset-x-[5px] top-0 bottom-[3px] rounded-sm"
              style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}
            />
            {/* Tie — thin contrasting stripe */}
            <div
              className="absolute left-1/2 -translate-x-1/2 top-0 w-[3px] h-[18px]"
              style={{ backgroundColor: gold }}
            />
          </div>
          {/* Right arm */}
          <div
            className="w-[6px] h-[18px] rounded-b-sm mt-[3px]"
            style={{ backgroundColor: agent.color }}
          />
        </div>

        {/* Legs */}
        <div className="flex justify-center gap-[4px]">
          <div className={`w-[9px] h-[12px] rounded-b-sm bg-slate-700 ${agent.status === 'walking' ? 'animate-bob' : ''}`} />
          <div className={`w-[9px] h-[12px] rounded-b-sm bg-slate-700 ${agent.status === 'walking' ? 'animate-bob [animation-delay:0.2s]' : ''}`} />
        </div>
      </div>

      {/* Working screen glow */}
      {agent.status === 'working' && (
        <div className="absolute top-[24px] left-1/2 -translate-x-1/2 w-[15px] h-[12px] rounded-sm bg-pixel-monitor opacity-60 animate-screen-flicker" />
      )}

      {/* Name label — gold, larger font */}
      <div className="text-center mt-1">
        <span
          className="font-pixel text-[8px] tracking-wider whitespace-nowrap"
          style={{ color: gold, textShadow: `1px 1px 0 rgba(0,0,0,0.8), 0 0 4px ${gold}44` }}
        >
          CEO {agent.name}
        </span>
      </div>
    </div>
  );
}
