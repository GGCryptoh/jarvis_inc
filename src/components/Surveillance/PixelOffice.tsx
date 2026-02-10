import type { Agent, SceneMode } from '../../types';
import {
  DESK_POSITIONS,
  WATER_COOLER_POSITIONS,
} from '../../data/dummyData';
import AgentSprite from './AgentSprite';

interface PixelOfficeProps {
  agents: Agent[];
  onAgentClick: (agent: Agent) => void;
  sceneMode: SceneMode;
}

export default function PixelOffice({ agents, onAgentClick, sceneMode }: PixelOfficeProps) {
  return (
    <div
      className="relative w-full h-full pixel-grid overflow-hidden"
      style={{ minHeight: '400px' }}
    >
      {/* ---- Static Furniture ---- */}

      {/* Desks (6 desks at DESK_POSITIONS) */}
      {DESK_POSITIONS.map((pos, i) => (
        <div
          key={`desk-${i}`}
          className="absolute z-[1]"
          style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          {/* Desk surface */}
          <div className="w-[40px] h-[20px] bg-pixel-desk rounded-sm border border-yellow-900/50 shadow-[2px_2px_0_rgba(0,0,0,0.3)]">
            {/* Monitor on desk */}
            <div className="absolute -top-[6px] left-1/2 -translate-x-1/2 w-[14px] h-[10px] bg-gray-800 border border-gray-600 rounded-sm">
              {/* Monitor screen glow */}
              <div className="w-[10px] h-[6px] mx-auto mt-[1px] rounded-[1px] bg-pixel-monitor opacity-30 animate-screen-flicker" />
            </div>
          </div>
          {/* Chair (below desk) */}
          <div className="absolute top-[20px] left-1/2 -translate-x-1/2 w-[12px] h-[10px] bg-gray-700 rounded-b-full border-b border-gray-600" />
        </div>
      ))}

      {/* Conference Table */}
      <div
        className="absolute z-[1]"
        style={{ left: '35%', top: '67%', transform: 'translate(-50%, -50%)' }}
      >
        <div className="w-[80px] h-[50px] bg-pixel-desk rounded-lg border-2 border-yellow-900/40 shadow-[3px_3px_0_rgba(0,0,0,0.3)]">
          {/* Table surface detail */}
          <div className="absolute inset-[4px] rounded-md border border-yellow-800/20" />
        </div>
      </div>

      {/* Water Cooler */}
      <div
        className="absolute z-[1]"
        style={{ left: `${WATER_COOLER_POSITIONS[0].x}%`, top: `${WATER_COOLER_POSITIONS[0].y - 6}%`, transform: 'translate(-50%, -50%)' }}
      >
        {/* Water bottle */}
        <div className="w-[12px] h-[18px] bg-sky-400/60 rounded-t-md border border-sky-500/40 shadow-[1px_1px_0_rgba(0,0,0,0.3)]">
          <div className="w-[8px] h-[4px] mx-auto mt-[2px] bg-sky-300/40 rounded-sm" />
        </div>
        {/* Base */}
        <div className="w-[16px] h-[8px] -ml-[2px] bg-gray-600 rounded-b-sm border border-gray-500" />
        {/* Label */}
        <div className="font-pixel text-[5px] text-sky-300/60 text-center mt-1 tracking-wider">H2O</div>
      </div>

      {/* Entrance / Door (bottom center) */}
      <div
        className="absolute z-[1]"
        style={{ left: '50%', top: '96%', transform: 'translate(-50%, -50%)' }}
      >
        <div className="relative">
          {/* Door frame */}
          <div className="w-[36px] h-[24px] bg-gray-700 border-t-2 border-l-2 border-r-2 border-gray-500 rounded-t-sm">
            {/* Door panels */}
            <div className="flex h-full">
              <div className="flex-1 border-r border-gray-600 m-[2px] bg-gray-600/50" />
              <div className="flex-1 m-[2px] bg-gray-600/50" />
            </div>
          </div>
          {/* Welcome mat */}
          <div className="w-[44px] h-[6px] -ml-[4px] bg-yellow-900/40 rounded-sm border border-yellow-800/30" />
          {/* Label */}
          <div className="font-pixel text-[5px] text-gray-500 text-center mt-1 tracking-wider">ENTRANCE</div>
        </div>
      </div>

      {/* Plant (decorative - top left) */}
      <div
        className="absolute z-[1]"
        style={{ left: '88%', top: '50%', transform: 'translate(-50%, -50%)' }}
      >
        {/* Pot */}
        <div className="w-[10px] h-[8px] bg-orange-800 rounded-b-sm border border-orange-700 mx-auto" />
        {/* Leaves */}
        <div className="absolute -top-[8px] left-1/2 -translate-x-1/2">
          <div className="w-[6px] h-[6px] bg-green-600 rounded-full -ml-[3px] absolute" />
          <div className="w-[6px] h-[6px] bg-green-500 rounded-full ml-[3px] absolute" />
          <div className="w-[5px] h-[7px] bg-green-500 rounded-full absolute -top-[4px] left-[1px]" />
        </div>
      </div>

      {/* Whiteboard (right wall area) */}
      <div
        className="absolute z-[1]"
        style={{ left: '85%', top: '10%', transform: 'translate(-50%, -50%)' }}
      >
        <div className="w-[44px] h-[28px] bg-gray-200 rounded-sm border-2 border-gray-400 shadow-[2px_2px_0_rgba(0,0,0,0.3)]">
          {/* Scribbles on whiteboard */}
          <div className="m-[3px] space-y-[3px]">
            <div className="w-[24px] h-[2px] bg-red-400/60 rounded-full" />
            <div className="w-[18px] h-[2px] bg-blue-400/60 rounded-full" />
            <div className="w-[28px] h-[2px] bg-green-500/60 rounded-full" />
            <div className="w-[14px] h-[2px] bg-purple-400/60 rounded-full" />
          </div>
        </div>
        {/* Tray */}
        <div className="w-[30px] h-[3px] bg-gray-400 rounded-b-sm mx-auto border-b border-gray-500" />
        <div className="font-pixel text-[5px] text-gray-500 text-center mt-1 tracking-wider">BOARD</div>
      </div>

      {/* Floor label for scene context */}
      {sceneMode === 'meeting' && (
        <div
          className="absolute font-pixel text-[6px] text-pixel-purple/40 tracking-widest z-[0]"
          style={{ left: '35%', top: '58%', transform: 'translate(-50%, -50%)' }}
        >
          CONF ROOM
        </div>
      )}
      {sceneMode === 'break' && (
        <div
          className="absolute font-pixel text-[6px] text-pixel-cyan/40 tracking-widest z-[0]"
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
    </div>
  );
}
