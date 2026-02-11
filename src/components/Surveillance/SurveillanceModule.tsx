import { useState, useEffect, useCallback, useRef } from 'react';
import type { Agent, AgentStatus, SceneMode, Position } from '../../types';
import {
  initialAgents,
  ENTRANCE_POSITION,
} from '../../data/dummyData';
import {
  generateDeskPositions,
  generateMeetingPositions,
  generateBreakPositions,
  generateAllHandsPositions,
  generateClusterPositions,
  getDeskCountWithSpare,
  getRoomTier,
  TIER_DESK_PRESETS,
  TIER_CEO_POSITION,
} from '../../lib/positionGenerator';
import { loadCEO } from '../../lib/database';
import SurveillanceControls from './SurveillanceControls';
import CRTFrame from './CRTFrame';
import PixelOffice from './PixelOffice';
import HireAgentModal from './HireAgentModal';
import type { AgentConfig } from './HireAgentModal';
import { Pencil, Trash2 } from 'lucide-react';

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
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sceneMode, setSceneMode] = useState<SceneMode>('working');
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [hireModalOpen, setHireModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  // Dynamic desk fallback (kept for scene transitions beyond tier presets)

  // CEO state
  const [ceoAgent, setCeoAgent] = useState<Agent | null>(null);

  // Room tier — computed from agent count
  const roomTier = getRoomTier(agents.length);

  // ---- Load sample agents from static data (no DB writes) ----
  useEffect(() => {
    const count = initialAgents.length;
    const tier = getRoomTier(count);
    const tierPresets = TIER_DESK_PRESETS[tier];
    const fallbackDesks = generateDeskPositions(getDeskCountWithSpare(count));

    const loaded: Agent[] = initialAgents.map((a, i) => {
      const pos = tierPresets[i] ?? fallbackDesks[i] ?? { x: 30 + (i % 3) * 20, y: 40 + Math.floor(i / 3) * 20 };
      return {
        ...a,
        position: { ...pos },
        targetPosition: { ...pos },
      };
    });

    setAgents(loaded);

    // Load CEO from DB (read-only)
    const ceoRow = loadCEO();
    if (ceoRow) {
      const ceoPos = TIER_CEO_POSITION[tier];
      setCeoAgent({
        id: 'ceo',
        name: ceoRow.name,
        role: 'Chief Executive Officer',
        color: '#f1fa8c',
        skinTone: '#ffcc99',
        status: 'working',
        position: { ...ceoPos },
        targetPosition: { ...ceoPos },
        currentTask: `Philosophy: ${ceoRow.philosophy}`,
        confidence: 99,
        costSoFar: 0,
        model: ceoRow.model,
      });
    }
  }, []);

  // ---- Scene transitions ----
  // Ref to share cluster center between agent and CEO state updates
  const clusterCenterRef = useRef<Position>({ x: 40, y: 50 });

  const changeScene = useCallback((mode: SceneMode) => {
    setSceneMode(mode);

    setAgents(prev => {
      const realAgents = prev.filter(a => !a.isNew);
      const count = realAgents.length;

      if (mode === 'welcome') {
        const positions = generateAllHandsPositions(count);
        const updated = realAgents.map((agent, i) => ({
          ...agent,
          targetPosition: positions[i],
        }));
        // placeholder welcome
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
        return updated;
      }

      if (mode === 'working') {
        const tier = getRoomTier(count);
        const presets = TIER_DESK_PRESETS[tier];
        const fallback = generateDeskPositions(getDeskCountWithSpare(count));
        return realAgents.map((agent, i) => ({
          ...agent,
          targetPosition: presets[i] ?? fallback[i] ?? { x: 30 + (i % 3) * 20, y: 40 + Math.floor(i / 3) * 20 },
        }));
      }

      if (mode === 'meeting') {
        // Ad-hoc cluster meeting — agents converge toward the midpoint of their current positions
        const currentPositions = realAgents.map(a => a.position);
        const cluster = generateClusterPositions(currentPositions, 8);
        clusterCenterRef.current = cluster.center;
        return realAgents.map((agent, i) => ({
          ...agent,
          targetPosition: cluster.positions[i],
        }));
      }

      let targetPositions: Position[];
      if (mode === 'all_hands') {
        targetPositions = generateAllHandsPositions(count);
      } else {
        // break
        targetPositions = generateBreakPositions(count);
      }

      return realAgents.map((agent, i) => ({
        ...agent,
        targetPosition: targetPositions[i],
      }));
    });

    // Move CEO to meeting/allhands or back to office
    setCeoAgent(prev => {
      if (!prev) return prev;
      if (mode === 'meeting') {
        // CEO joins the cluster — positioned near the cluster center
        const c = clusterCenterRef.current;
        return { ...prev, targetPosition: { x: c.x + 5, y: c.y - 5 } };
      }
      if (mode === 'all_hands') {
        return { ...prev, targetPosition: { x: 38, y: 38 } };
      }
      return { ...prev, targetPosition: { ...TIER_CEO_POSITION[getRoomTier(agents.length)] } };
    });
  }, []);

  // ---- Hire a new agent (state-only, no DB) ----
  const handleHire = useCallback((config: AgentConfig) => {
    const id = `agent-${Date.now()}`;

    // Create runtime agent at entrance
    const newAgent: Agent = {
      id,
      name: config.name,
      role: config.role,
      color: config.color,
      skinTone: config.skinTone,
      status: 'arriving',
      position: { ...ENTRANCE_POSITION },
      targetPosition: { x: 38, y: 44 },
      currentTask: 'Onboarding...',
      confidence: 50,
      costSoFar: 0,
      model: config.model,
    };

    // Move existing agents to welcome positions, add new one
    setSceneMode('welcome');
    setAgents(prev => {
      const realAgents = prev.filter(a => !a.isNew);
      const positions = generateAllHandsPositions(realAgents.length);
      const updated = realAgents.map((agent, i) => ({
        ...agent,
        targetPosition: positions[i],
      }));
      updated.push(newAgent);
      return updated;
    });

    setHireModalOpen(false);

    // After welcome animation, transition all to desks with new desk count
    setTimeout(() => {
      setAgents(prev => {
        const allReal = prev.map(a => ({ ...a, isNew: undefined }));
        const tier = getRoomTier(allReal.length);
        const presets = TIER_DESK_PRESETS[tier];
        const fallback = generateDeskPositions(getDeskCountWithSpare(allReal.length));

        return allReal.map((agent, i) => ({
          ...agent,
          targetPosition: presets[i] ?? fallback[i] ?? { x: 30 + (i % 3) * 20, y: 40 + Math.floor(i / 3) * 20 },
        }));
      });
      setSceneMode('working');
    }, 4000);
  }, []);

  // ---- Edit an existing agent (state-only, no DB) ----
  const handleEdit = useCallback((config: AgentConfig) => {
    if (!editingAgent) return;

    setAgents(prev =>
      prev.map(a =>
        a.id === editingAgent.id
          ? { ...a, name: config.name, role: config.role, color: config.color, skinTone: config.skinTone, model: config.model }
          : a,
      ),
    );

    setSelectedAgent(prev =>
      prev && prev.id === editingAgent.id
        ? { ...prev, name: config.name, role: config.role, color: config.color, skinTone: config.skinTone, model: config.model }
        : prev,
    );

    setEditingAgent(null);
  }, [editingAgent]);

  // ---- Fire (delete) an agent (state-only, no DB) ----
  const handleFire = useCallback((agentId: string) => {
    setAgents(prev => {
      const remaining = prev.filter(a => a.id !== agentId);
      const tier = getRoomTier(remaining.length);
      const presets = TIER_DESK_PRESETS[tier];
      const fallback = generateDeskPositions(getDeskCountWithSpare(remaining.length));
      return remaining.map((agent, i) => ({
        ...agent,
        targetPosition: presets[i] ?? fallback[i] ?? { x: 30 + (i % 3) * 20, y: 40 + Math.floor(i / 3) * 20 },
      }));
    });
    setSelectedAgent(null);
    setSceneMode('working');
  }, []);

  // ---- Position interpolation (constant-speed) loop ----
  useEffect(() => {
    const MOVE_SPEED = 0.6; // % per 50ms tick → uniform speed

    const interval = setInterval(() => {
      const lerpEntity = (entity: Agent): Agent => {
        const dx = entity.targetPosition.x - entity.position.x;
        const dy = entity.targetPosition.y - entity.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.5) {
          return {
            ...entity,
            position: { ...entity.targetPosition },
            status: modeToStatus(sceneMode),
          };
        }

        // Normalize direction, apply constant speed (no overshoot)
        const step = Math.min(MOVE_SPEED, dist);
        const nx = dx / dist;
        const ny = dy / dist;

        return {
          ...entity,
          status: 'walking' as AgentStatus,
          position: {
            x: entity.position.x + nx * step,
            y: entity.position.y + ny * step,
          },
        };
      };

      setAgents(prev => prev.map(lerpEntity));
      setCeoAgent(prev => prev ? lerpEntity(prev) : prev);
    }, 50);

    return () => clearInterval(interval);
  }, [sceneMode]);

  // Keep selectedAgent in sync when agents update
  useEffect(() => {
    if (selectedAgent) {
      if (selectedAgent.id === 'ceo' && ceoAgent) {
        setSelectedAgent(ceoAgent);
      } else {
        const fresh = agents.find(a => a.id === selectedAgent.id);
        if (fresh) setSelectedAgent(fresh);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, ceoAgent]);

  const TOP_MENU = ['OVERVIEW', 'NETWORK', 'ANALYTICS', 'SETTINGS'] as const;

  return (
    <div className="flex h-full">
      {/* Left panel -- controls */}
      <SurveillanceControls
        sceneMode={sceneMode}
        onChangeScene={changeScene}
        agentCount={agents.filter(a => !a.isNew).length}
        onHireAgent={() => setHireModalOpen(true)}
      />

      {/* Center -- CRT feed */}
      <div className="flex-1 flex flex-col p-4 min-w-0">
        {/* Live indicator */}
        <div className="font-pixel text-pixel-orange text-[9px] mb-2 flex items-center gap-2 tracking-wider">
          <span className="animate-blink">&#9679;</span> SAMPLE SURVEILLANCE &mdash; DEMO MODE
        </div>

        {/* Top Menu Buttons */}
        <div className="flex items-center gap-1 mb-2">
          {TOP_MENU.map((label, i) => (
            <button
              key={label}
              className={`font-pixel text-[7px] tracking-wider px-3 py-1.5 border transition-colors
                ${i === 0
                  ? 'border-pixel-cyan/50 text-pixel-cyan bg-pixel-cyan/15'
                  : 'border-gray-600/40 text-gray-500 hover:text-gray-300 hover:border-gray-500 bg-transparent'
                }`}
            >
              {label}
            </button>
          ))}
        </div>

        <CRTFrame>
          <PixelOffice
            agents={agents}
            onAgentClick={setSelectedAgent}
            sceneMode={sceneMode}
            ceo={ceoAgent}
            doorOpen={null}
            roomTier={roomTier}
          />
        </CRTFrame>
      </div>

      {/* Right panel -- agent detail sidebar */}
      {selectedAgent && (
        <AgentDetailSidebar
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onEdit={(agent) => setEditingAgent(agent)}
          onFire={(agent) => handleFire(agent.id)}
          isCEO={selectedAgent.id === 'ceo'}
        />
      )}

      {/* Hire / Edit modal */}
      <HireAgentModal
        open={hireModalOpen || !!editingAgent}
        onClose={() => { setHireModalOpen(false); setEditingAgent(null); }}
        onSubmit={editingAgent ? handleEdit : handleHire}
        editAgent={editingAgent}
      />
    </div>
  );
}

/* ================================================================
   Inline Agent Detail Sidebar
   ================================================================ */

interface AgentDetailSidebarProps {
  agent: Agent;
  onClose: () => void;
  onEdit: (agent: Agent) => void;
  onFire: (agent: Agent) => void;
  isCEO?: boolean;
}

function AgentDetailSidebar({ agent, onClose, onEdit, onFire, isCEO }: AgentDetailSidebarProps) {
  const [confirmFire, setConfirmFire] = useState(false);

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
        <span>{isCEO ? 'CEO DETAIL' : 'AGENT DETAIL'}</span>
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
              {isCEO ? `CEO ${agent.name}` : agent.name}
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
          <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">{isCEO ? 'PHILOSOPHY' : 'CURRENT TASK'}</div>
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

        {/* Action buttons */}
        <div className="flex flex-col gap-1">
          {!isCEO && (
            <>
              <button
                className="retro-button w-full !text-[8px] !py-2 text-center tracking-widest hover:!text-pixel-cyan flex items-center justify-center gap-2"
                onClick={() => onEdit(agent)}
              >
                <Pencil size={10} />
                EDIT SPRITE
              </button>

              {!confirmFire ? (
                <button
                  className="retro-button w-full !text-[8px] !py-2 text-center tracking-widest hover:!text-pixel-pink flex items-center justify-center gap-2"
                  onClick={() => setConfirmFire(true)}
                >
                  <Trash2 size={10} />
                  FIRE AGENT
                </button>
              ) : (
                <div className="flex gap-1">
                  <button
                    className="retro-button flex-1 !text-[7px] !py-2 text-center tracking-widest !border-t-red-500/50 !border-l-red-500/50 hover:!text-red-400"
                    onClick={() => onFire(agent)}
                  >
                    CONFIRM
                  </button>
                  <button
                    className="retro-button flex-1 !text-[7px] !py-2 text-center tracking-widest"
                    onClick={() => setConfirmFire(false)}
                  >
                    CANCEL
                  </button>
                </div>
              )}
            </>
          )}

          <button
            className="retro-button w-full !text-[9px] !py-2 text-center tracking-widest hover:!text-pixel-orange"
            onClick={onClose}
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
