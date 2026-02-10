import { useState, useEffect, useCallback } from 'react';
import type { Agent, AgentStatus, SceneMode } from '../../types';
import {
  initialAgents,
  DESK_POSITIONS,
  MEETING_POSITIONS,
  WATER_COOLER_POSITIONS,
  ALL_HANDS_POSITIONS,
  ENTRANCE_POSITION,
} from '../../data/dummyData';
import SurveillanceControls from './SurveillanceControls';
import CRTFrame from './CRTFrame';
import PixelOffice from './PixelOffice';

/** Map a SceneMode to the AgentStatus agents should assume once they arrive. */
function modeToStatus(mode: SceneMode): AgentStatus {
  switch (mode) {
    case 'working':
      return 'working';
    case 'meeting':
      return 'meeting';
    case 'break':
      return 'break';
    case 'all_hands':
    case 'welcome':
    default:
      return 'idle';
  }
}

export default function SurveillanceModule() {
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [sceneMode, setSceneMode] = useState<SceneMode>('working');
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  // ---- Scene transitions ----
  const changeScene = useCallback((mode: SceneMode) => {
    setSceneMode(mode);

    setAgents(prev => {
      let updated: Agent[];

      if (mode === 'welcome') {
        // Existing agents gather in center
        updated = prev.map((agent, i) => ({
          ...agent,
          targetPosition: ALL_HANDS_POSITIONS[i % ALL_HANDS_POSITIONS.length],
        }));

        // Add a new agent at the entrance that will walk in
        const newId = `agent-${Date.now()}`;
        const newAgent: Agent = {
          id: newId,
          name: 'NOVA',
          role: 'New Recruit',
          color: '#ff79c6',
          skinTone: '#ffcc99',
          status: 'arriving',
          position: { ...ENTRANCE_POSITION },
          targetPosition: { x: 38, y: 44 },
          currentTask: 'Onboarding...',
          confidence: 50,
          costSoFar: 0,
          model: 'Claude 3.5',
          isNew: true,
        };
        updated.push(newAgent);
      } else {
        const targetPositions =
          mode === 'working'
            ? DESK_POSITIONS
            : mode === 'meeting'
              ? MEETING_POSITIONS
              : mode === 'all_hands'
                ? ALL_HANDS_POSITIONS
                : WATER_COOLER_POSITIONS;

        updated = prev
          // Remove any temporarily-added "welcome" agents when switching away
          .filter(a => !a.isNew)
          .map((agent, i) => ({
            ...agent,
            targetPosition: targetPositions[i % targetPositions.length],
          }));
      }

      return updated;
    });
  }, []);

  // ---- Position interpolation (lerp) loop ----
  useEffect(() => {
    const interval = setInterval(() => {
      setAgents(prev =>
        prev.map(agent => {
          const dx = agent.targetPosition.x - agent.position.x;
          const dy = agent.targetPosition.y - agent.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 0.5) {
            return {
              ...agent,
              position: { ...agent.targetPosition },
              status: modeToStatus(sceneMode),
            };
          }

          const speed = 0.08;
          return {
            ...agent,
            status: 'walking' as AgentStatus,
            position: {
              x: agent.position.x + dx * speed,
              y: agent.position.y + dy * speed,
            },
          };
        }),
      );
    }, 50);

    return () => clearInterval(interval);
  }, [sceneMode]);

  // Keep selectedAgent in sync when agents update
  useEffect(() => {
    if (selectedAgent) {
      const fresh = agents.find(a => a.id === selectedAgent.id);
      if (fresh) {
        setSelectedAgent(fresh);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents]);

  return (
    <div className="flex h-full">
      {/* Left panel -- controls */}
      <SurveillanceControls sceneMode={sceneMode} onChangeScene={changeScene} />

      {/* Center -- CRT feed */}
      <div className="flex-1 flex flex-col p-4 min-w-0">
        {/* Live indicator */}
        <div className="font-pixel text-pixel-green text-[9px] mb-2 flex items-center gap-2 tracking-wider">
          <span className="animate-blink">&#9679;</span> SURVEILLANCE FEED &mdash; LIVE
        </div>

        <CRTFrame>
          <PixelOffice
            agents={agents}
            onAgentClick={setSelectedAgent}
            sceneMode={sceneMode}
          />
        </CRTFrame>
      </div>

      {/* Right panel -- agent detail sidebar */}
      {selectedAgent && (
        <AgentDetailSidebar
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}

/* ================================================================
   Inline Agent Detail Sidebar
   ================================================================ */

interface AgentDetailSidebarProps {
  agent: Agent;
  onClose: () => void;
}

function AgentDetailSidebar({ agent, onClose }: AgentDetailSidebarProps) {
  const confidenceColor =
    agent.confidence >= 85
      ? 'bg-pixel-green'
      : agent.confidence >= 60
        ? 'bg-pixel-orange'
        : 'bg-pixel-pink';

  return (
    <div className="w-[280px] flex-shrink-0 border-l-2 border-pixel-crt-border bg-pixel-bg flex flex-col">
      {/* Title bar */}
      <div className="retro-window-title !text-[8px] !py-2 !px-3">
        <span>AGENT DETAIL</span>
      </div>

      {/* Body */}
      <div className="retro-window-body !m-2 flex-1 flex flex-col gap-3 overflow-y-auto no-scrollbar">
        {/* Agent identity */}
        <div className="flex items-center gap-3">
          {/* Mini sprite preview */}
          <div className="flex flex-col items-center">
            <div className="w-[10px] h-[4px] rounded-t-sm" style={{ backgroundColor: agent.color }} />
            <div className="w-[10px] h-[8px] rounded-sm" style={{ backgroundColor: agent.skinTone }} />
            <div className="w-[12px] h-[10px] rounded-sm" style={{ backgroundColor: agent.color }} />
            <div className="flex gap-[2px]">
              <div className="w-[4px] h-[6px] rounded-b-sm bg-slate-700" />
              <div className="w-[4px] h-[6px] rounded-b-sm bg-slate-700" />
            </div>
          </div>
          <div>
            <div className="font-pixel text-[10px] tracking-wider" style={{ color: agent.color }}>
              {agent.name}
            </div>
            <div className="font-pixel text-[7px] text-gray-400 tracking-wider mt-1">
              {agent.role}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-pixel-crt-border" />

        {/* Model badge */}
        <div>
          <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">MODEL</div>
          <span className="inline-block font-pixel text-[7px] tracking-wider px-2 py-1 bg-pixel-floor border border-pixel-crt-border text-pixel-cyan rounded-sm">
            {agent.model}
          </span>
        </div>

        {/* Current task */}
        <div>
          <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">CURRENT TASK</div>
          <div className="retro-inset p-2 font-pixel text-[7px] text-pixel-green leading-relaxed tracking-wider">
            {agent.currentTask}
          </div>
        </div>

        {/* Status */}
        <div>
          <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">STATUS</div>
          <div className="flex items-center gap-2">
            <span
              className="w-[6px] h-[6px] rounded-full"
              style={{
                backgroundColor:
                  agent.status === 'working'
                    ? '#50fa7b'
                    : agent.status === 'walking'
                      ? '#ffb86c'
                      : agent.status === 'meeting'
                        ? '#bd93f9'
                        : agent.status === 'break'
                          ? '#8be9fd'
                          : '#64748b',
              }}
            />
            <span className="font-pixel text-[8px] text-gray-300 tracking-wider uppercase">
              {agent.status}
            </span>
          </div>
        </div>

        {/* Confidence bar */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="font-pixel text-[6px] text-gray-500 tracking-wider">CONFIDENCE</span>
            <span className="font-pixel text-[8px] text-gray-300 tracking-wider">{agent.confidence}%</span>
          </div>
          <div className="retro-inset h-[10px] p-[2px]">
            <div
              className={`h-full rounded-[1px] ${confidenceColor} transition-all duration-500`}
              style={{ width: `${agent.confidence}%` }}
            />
          </div>
        </div>

        {/* Cost */}
        <div>
          <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">COST SO FAR</div>
          <div className="font-pixel text-[12px] text-pixel-yellow tracking-wider">
            ${agent.costSoFar.toFixed(2)}
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Close button */}
        <button
          className="retro-button w-full !text-[9px] !py-2 text-center tracking-widest hover:!text-pixel-pink"
          onClick={onClose}
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}
