import { useState, useEffect } from 'react';
import type { Agent } from '../../types';
import { getAgentUsage } from '../../lib/llmUsage';

interface CEOSpriteProps {
  agent: Agent;
  onClick: () => void;
  archetype?: string | null;
  riskTolerance?: string | null;
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
export default function CEOSprite({ agent, onClick, archetype, riskTolerance }: CEOSpriteProps) {
  const animationClass = getAnimationClass(agent.status);
  const statusColor = getStatusColor(agent.status);
  const gold = '#f1fa8c';
  const isSeated = agent.status === 'working';

  const [ceoCost, setCeoCost] = useState(0);

  useEffect(() => {
    getAgentUsage('ceo').then(u => setCeoCost(u.totalCost));
  }, []);

  return (
    <div
      className="agent-sprite cursor-pointer group"
      style={{
        left: `${agent.position.x}%`,
        top: `${agent.position.y}%`,
        transform: `translate(-50%, -50%) translateY(${isSeated ? '24px' : '0px'})`,
        zIndex: 6,
      }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {/* Hover tooltip — CEO-specific info */}
      <div className="absolute -top-[80px] left-1/2 -translate-x-1/2 hidden group-hover:block z-30">
        <div className="bg-jarvis-surface border border-jarvis-border rounded px-2 py-1.5 text-[10px] whitespace-nowrap shadow-lg">
          <div className="font-medium" style={{ color: gold }}>CEO {agent.name}</div>
          {archetype && (
            <div className="text-pixel-pink text-[9px] uppercase">{archetype.replace(/_/g, ' ')}</div>
          )}
          <div className="text-jarvis-muted truncate max-w-[160px]">{agent.currentTask}</div>
          <div className="text-pixel-cyan text-[9px]">{agent.model}</div>
          <div className="border-t border-jarvis-border mt-1 pt-1 text-[9px]">
            <div className="flex items-center gap-2">
              <span className="w-[5px] h-[5px] rounded-full inline-block" style={{ backgroundColor: statusColor }} />
              <span className="text-jarvis-muted uppercase">{agent.status}</span>
              {riskTolerance && (
                <span className="text-pixel-orange">{riskTolerance}</span>
              )}
            </div>
            <div className="text-pixel-yellow">COST: ${ceoCost.toFixed(2)}</div>
          </div>
        </div>
        <div className="w-0 h-0 mx-auto border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-jarvis-border" />
      </div>

      {/* Sprite body — scaled up 20% */}
      <div className={`relative ${animationClass}`}>
        {/* Gold hover glow */}
        <div
          className="absolute inset-[-7px] rounded-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          style={{ boxShadow: `0 0 20px ${gold}66, 0 0 38px ${gold}33` }}
        />

        {/* Status dot — to the left of the head */}
        <div
          className="absolute top-[12px] -left-[14px] w-[9px] h-[9px] rounded-full z-10"
          style={{
            backgroundColor: statusColor,
            border: `2px solid ${gold}`,
            boxShadow: `0 0 6px ${statusColor}`,
          }}
        />

        {/* Crown */}
        <div className="text-center" style={{ fontSize: '18px', lineHeight: '20px', color: gold, textShadow: `0 0 6px ${gold}66` }}>
          ♛
        </div>

        {/* Hair / hat */}
        <div
          className="mx-auto w-[29px] h-[10px] rounded-t-sm"
          style={{ backgroundColor: agent.color }}
        />

        {/* Head — larger with pixel eyes and mouth */}
        <div
          className="mx-auto w-[29px] h-[25px] rounded-sm relative"
          style={{ backgroundColor: agent.skinTone }}
        >
          {/* Left eye */}
          <div className="absolute top-[7px] left-[6px] w-[4px] h-[4px] bg-black rounded-[0.5px]" />
          {/* Right eye */}
          <div className="absolute top-[7px] right-[6px] w-[4px] h-[4px] bg-black rounded-[0.5px]" />
          {/* Mouth */}
          <div className="absolute bottom-[4px] left-1/2 -translate-x-1/2 w-[7px] h-[2px] bg-black/40 rounded-full" />
        </div>

        {/* Body with suit lapels and tie */}
        <div className="relative mx-auto flex">
          {/* Left arm */}
          <div
            className="w-[7px] h-[22px] rounded-b-sm mt-[4px]"
            style={{ backgroundColor: agent.color }}
          />
          {/* Torso */}
          <div
            className="w-[36px] h-[29px] rounded-sm relative"
            style={{ backgroundColor: agent.color }}
          >
            {/* Suit lapels — darker inner rect */}
            <div
              className="absolute inset-x-[6px] top-0 bottom-[4px] rounded-sm"
              style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}
            />
            {/* Tie — thin contrasting stripe */}
            <div
              className="absolute left-1/2 -translate-x-1/2 top-0 w-[4px] h-[22px]"
              style={{ backgroundColor: gold }}
            />
          </div>
          {/* Right arm */}
          <div
            className="w-[7px] h-[22px] rounded-b-sm mt-[4px]"
            style={{ backgroundColor: agent.color }}
          />
        </div>

        {/* Typing hands - visible when working (seated at desk) */}
        {agent.status === 'working' && (
          <div className="typing-hands flex justify-center -mt-[2px]">
            <div className="flex gap-[10px]">
              {/* Left hand */}
              <div className="w-[8px] h-[6px] rounded-[1px]" style={{ backgroundColor: agent.skinTone }} />
              {/* Right hand */}
              <div className="w-[8px] h-[6px] rounded-[1px]" style={{ backgroundColor: agent.skinTone }} />
            </div>
          </div>
        )}

        {/* Legs */}
        <div className="flex justify-center gap-[5px]">
          <div className={`w-[11px] h-[14px] rounded-b-sm bg-slate-700 ${agent.status === 'walking' ? 'animate-bob' : ''}`} />
          <div className={`w-[11px] h-[14px] rounded-b-sm bg-slate-700 ${agent.status === 'walking' ? 'animate-bob [animation-delay:0.2s]' : ''}`} />
        </div>
      </div>

      {/* Working screen glow — subtle reflected light */}
      {agent.status === 'working' && (
        <div
          className="absolute top-[29px] left-1/2 -translate-x-1/2 w-[18px] h-[14px] rounded-sm animate-screen-flicker pointer-events-none"
          style={{ background: 'radial-gradient(ellipse, rgba(0,255,136,0.2) 0%, transparent 70%)' }}
        />
      )}

      {/* Name label — gold, larger font */}
      <div className="text-center mt-1">
        <span
          className="font-pixel text-[9px] tracking-wider whitespace-nowrap"
          style={{ color: gold, textShadow: `1px 1px 0 rgba(0,0,0,0.8), 0 0 4px ${gold}44` }}
        >
          CEO {agent.name}
        </span>
      </div>
    </div>
  );
}
