import type { Agent, Position, SceneMode } from '../../types';
import AgentSprite from './AgentSprite';
import CEOSprite from './CEOSprite';
import { CEO_OFFICE_POSITION } from '../../lib/positionGenerator';

interface PixelOfficeProps {
  agents: Agent[];
  onAgentClick: (agent: Agent) => void;
  sceneMode: SceneMode;
  deskPositions: Position[];
  newDeskIndex: number | null;
  ceo: Agent | null;
  doorOpen?: boolean | null; // null = static, true = opening, false = closing
}

export default function PixelOffice({ agents, onAgentClick, sceneMode, deskPositions, newDeskIndex, ceo, doorOpen = null }: PixelOfficeProps) {
  const gold = '#f1fa8c';

  return (
    <div
      className="relative w-full h-full pixel-grid overflow-hidden"
      style={{ minHeight: '400px' }}
    >
      {/* ---- Dynamic Desks (50% bigger) ---- */}
      {deskPositions.map((pos, i) => (
        <div
          key={`desk-${i}`}
          className={`absolute z-[1] ${newDeskIndex === i ? 'animate-desk-materialize desk-sparkle' : ''}`}
          style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          {/* Desk surface */}
          <div className="w-[60px] h-[30px] bg-pixel-desk rounded-sm border border-yellow-900/50 shadow-[3px_3px_0_rgba(0,0,0,0.3)]">
            {/* Monitor on desk */}
            <div className="absolute -top-[9px] left-1/2 -translate-x-1/2 w-[21px] h-[15px] bg-gray-800 border border-gray-600 rounded-sm">
              <div className="w-[15px] h-[9px] mx-auto mt-[2px] rounded-[1px] bg-pixel-monitor opacity-30 animate-screen-flicker" />
            </div>
          </div>
          {/* Chair */}
          <div className="absolute top-[30px] left-1/2 -translate-x-1/2 w-[18px] h-[15px] bg-gray-700 rounded-b-full border-b border-gray-600" />
        </div>
      ))}

      {/* ---- CEO Command Station (50% bigger) ---- */}
      {ceo && (
        <div
          className="absolute z-[2]"
          style={{
            left: `${CEO_OFFICE_POSITION.x}%`,
            top: `${CEO_OFFICE_POSITION.y}%`,
            transform: 'translate(-50%, -50%)',
            filter: `drop-shadow(0 0 12px ${gold}33)`,
          }}
        >
          {/* Wide executive desk */}
          <div
            className="w-[105px] h-[36px] rounded-sm shadow-[4px_4px_0_rgba(0,0,0,0.4)]"
            style={{
              backgroundColor: '#5c3d2e',
              border: `2px solid ${gold}55`,
            }}
          >
            <div className="absolute top-0 left-[6px] right-[6px] h-[2px]" style={{ backgroundColor: `${gold}44` }} />
          </div>

          {/* 3-Monitor Array */}
          <div className="absolute -top-[27px] left-1/2 -translate-x-1/2 flex items-end gap-[3px]">
            <div className="w-[21px] h-[15px] bg-gray-800 border border-gray-600 rounded-sm -rotate-6">
              <div className="w-[15px] h-[9px] mx-auto mt-[2px] rounded-[1px] bg-pixel-monitor opacity-40 animate-screen-flicker" />
            </div>
            <div className="w-[27px] h-[20px] bg-gray-800 border border-gray-600 rounded-sm">
              <div className="w-[21px] h-[14px] mx-auto mt-[2px] rounded-[1px] bg-pixel-monitor opacity-40 animate-screen-flicker" />
            </div>
            <div className="w-[21px] h-[15px] bg-gray-800 border border-gray-600 rounded-sm rotate-6">
              <div className="w-[15px] h-[9px] mx-auto mt-[2px] rounded-[1px] bg-pixel-monitor opacity-40 animate-screen-flicker" />
            </div>
          </div>

          {/* Status display panel */}
          <div className="absolute -top-[4px] left-1/2 -translate-x-1/2 flex gap-[3px]">
            <div className="w-[4px] h-[4px] rounded-full bg-emerald-500 animate-pulse" />
            <div className="w-[4px] h-[4px] rounded-full bg-yellow-400" />
            <div className="w-[4px] h-[4px] rounded-full bg-emerald-500" />
            <div className="w-[12px] h-[3px] mt-[0.5px] rounded-full bg-pixel-cyan/40" />
          </div>

          {/* Executive high-back chair */}
          <div className="absolute top-[36px] left-1/2 -translate-x-1/2">
            <div className="w-[24px] h-[21px] bg-gray-600 rounded-b-full border-b border-gray-500" />
            <div className="absolute -top-[6px] left-1/2 -translate-x-1/2 w-[21px] h-[9px] bg-gray-600 rounded-t-sm border-t border-x border-gray-500" />
          </div>

          {/* Gold Nameplate */}
          <div className="absolute top-[9px] left-1/2 -translate-x-1/2">
            <div
              className="px-[6px] py-[2px] rounded-[1px] font-pixel text-[6px] tracking-wider whitespace-nowrap text-center"
              style={{
                backgroundColor: `${gold}33`,
                border: `0.5px solid ${gold}66`,
                color: gold,
                textShadow: `0 0 3px ${gold}66`,
              }}
            >
              CEO {ceo.name}
            </div>
          </div>
        </div>
      )}

      {/* ---- Conference Table (50% bigger) ---- */}
      <div
        className="absolute z-[1]"
        style={{ left: '35%', top: '67%', transform: 'translate(-50%, -50%)' }}
      >
        <div className="w-[120px] h-[75px] bg-pixel-desk rounded-lg border-2 border-yellow-900/40 shadow-[4px_4px_0_rgba(0,0,0,0.3)]">
          <div className="absolute inset-[6px] rounded-md border border-yellow-800/20" />
        </div>
      </div>

      {/* ---- Water Cooler (1.5x original) ---- */}
      <div
        className="absolute z-[1]"
        style={{ left: '75%', top: '12%', transform: 'translate(-50%, -50%)' }}
      >
        <div className="w-[18px] h-[27px] bg-sky-400/60 rounded-t-md border border-sky-500/40 shadow-[2px_2px_0_rgba(0,0,0,0.3)]">
          <div className="w-[12px] h-[6px] mx-auto mt-[3px] bg-sky-300/40 rounded-sm" />
        </div>
        <div className="w-[24px] h-[12px] -ml-[3px] bg-gray-600 rounded-b-sm border border-gray-500" />
        <div className="font-pixel text-[7px] text-sky-300/60 text-center mt-1 tracking-wider">H2O</div>
      </div>

      {/* ---- Entrance / Door (3x original) with animated panels ---- */}
      <div
        className="absolute z-[1]"
        style={{ left: '50%', top: '96%', transform: 'translate(-50%, -50%)' }}
      >
        <div className="relative">
          <div className="w-[108px] h-[72px] bg-gray-700 border-t-3 border-l-3 border-r-3 border-gray-500 rounded-t-sm overflow-hidden">
            <div className="flex h-full">
              <div
                className={`flex-1 border-r border-gray-600 m-[6px] bg-gray-600/50 ${
                  doorOpen === true ? 'door-open-left' : doorOpen === false ? 'door-close-left' : ''
                }`}
              />
              <div
                className={`flex-1 m-[6px] bg-gray-600/50 ${
                  doorOpen === true ? 'door-open-right' : doorOpen === false ? 'door-close-right' : ''
                }`}
              />
            </div>
          </div>
          <div className="w-[132px] h-[18px] -ml-[12px] bg-yellow-900/40 rounded-sm border border-yellow-800/30" />
          <div className="font-pixel text-[8px] text-gray-500 text-center mt-1 tracking-wider">ENTRANCE</div>
        </div>
      </div>

      {/* ---- Plant (50% bigger) ---- */}
      <div
        className="absolute z-[1]"
        style={{ left: '88%', top: '50%', transform: 'translate(-50%, -50%)' }}
      >
        <div className="w-[15px] h-[12px] bg-orange-800 rounded-b-sm border border-orange-700 mx-auto" />
        <div className="absolute -top-[12px] left-1/2 -translate-x-1/2">
          <div className="w-[9px] h-[9px] bg-green-600 rounded-full -ml-[5px] absolute" />
          <div className="w-[9px] h-[9px] bg-green-500 rounded-full ml-[5px] absolute" />
          <div className="w-[8px] h-[11px] bg-green-500 rounded-full absolute -top-[6px] left-[1px]" />
        </div>
      </div>

      {/* ---- Whiteboard (2x original) ---- */}
      <div
        className="absolute z-[1]"
        style={{ left: '85%', top: '10%', transform: 'translate(-50%, -50%)' }}
      >
        <div className="w-[88px] h-[56px] bg-gray-200 rounded-sm border-2 border-gray-400 shadow-[4px_4px_0_rgba(0,0,0,0.3)]">
          <div className="m-[6px] space-y-[6px]">
            <div className="w-[48px] h-[4px] bg-red-400/60 rounded-full" />
            <div className="w-[36px] h-[4px] bg-blue-400/60 rounded-full" />
            <div className="w-[56px] h-[4px] bg-green-500/60 rounded-full" />
            <div className="w-[28px] h-[4px] bg-purple-400/60 rounded-full" />
          </div>
        </div>
        <div className="w-[60px] h-[6px] bg-gray-400 rounded-b-sm mx-auto border-b border-gray-500" />
        <div className="font-pixel text-[8px] text-gray-500 text-center mt-1 tracking-wider">BOARD</div>
      </div>

      {/* ---- Scene context labels ---- */}
      {sceneMode === 'meeting' && (
        <div
          className="absolute font-pixel text-[8px] text-pixel-purple/40 tracking-widest z-[0]"
          style={{ left: '35%', top: '58%', transform: 'translate(-50%, -50%)' }}
        >
          CONF ROOM
        </div>
      )}
      {sceneMode === 'break' && (
        <div
          className="absolute font-pixel text-[8px] text-pixel-cyan/40 tracking-widest z-[0]"
          style={{ left: '77%', top: '12%', transform: 'translate(-50%, -50%)' }}
        >
          BREAK AREA
        </div>
      )}

      {/* ---- Agent Sprites ---- */}
      {agents.map(agent => (
        <AgentSprite
          key={agent.id}
          agent={agent}
          onClick={() => onAgentClick(agent)}
        />
      ))}

      {/* ---- CEO Sprite ---- */}
      {ceo && (
        <CEOSprite
          agent={ceo}
          onClick={() => onAgentClick(ceo)}
        />
      )}
    </div>
  );
}
