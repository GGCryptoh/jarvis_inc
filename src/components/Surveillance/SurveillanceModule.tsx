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
import { loadAgents, saveAgent, seedAgentsIfEmpty, deleteAgent as dbDeleteAgent } from '../../lib/database';
import type { AgentRow } from '../../lib/database';
import SurveillanceControls from './SurveillanceControls';
import CRTFrame from './CRTFrame';
import PixelOffice from './PixelOffice';
import HireAgentModal from './HireAgentModal';
import type { AgentConfig } from './HireAgentModal';
import { Pencil, Trash2 } from 'lucide-react';

// Default tasks assigned to fresh agents
const DEFAULT_TASKS = [
  'Awaiting assignment...',
  'Running diagnostics...',
  'Scanning environment...',
  'Calibrating sensors...',
  'Indexing knowledge base...',
  'Optimizing parameters...',
];

/** Convert a DB row + index into a full runtime Agent. */
function rowToAgent(row: AgentRow, index: number): Agent {
  const pos = DESK_POSITIONS[index % DESK_POSITIONS.length];
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    color: row.color,
    skinTone: row.skin_tone,
    status: 'working',
    position: { ...pos },
    targetPosition: { ...pos },
    currentTask: DEFAULT_TASKS[index % DEFAULT_TASKS.length],
    confidence: 70 + Math.floor(Math.random() * 25),
    costSoFar: parseFloat((Math.random() * 0.5).toFixed(2)),
    model: row.model,
  };
}

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

  // ---- Load agents from DB on mount ----
  useEffect(() => {
    // Seed defaults if DB is empty
    const seeds: AgentRow[] = initialAgents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      color: a.color,
      skin_tone: a.skinTone,
      model: a.model,
    }));
    seedAgentsIfEmpty(seeds);

    // Load from DB
    const rows = loadAgents();
    const loaded = rows.map((row, i) => rowToAgent(row, i));

    // Restore dummy task/confidence/cost for the original 6
    loaded.forEach((agent) => {
      const original = initialAgents.find((a) => a.id === agent.id);
      if (original) {
        agent.currentTask = original.currentTask;
        agent.confidence = original.confidence;
        agent.costSoFar = original.costSoFar;
      }
    });

    setAgents(loaded);
  }, []);

  // ---- Scene transitions ----
  const changeScene = useCallback((mode: SceneMode) => {
    setSceneMode(mode);

    setAgents(prev => {
      let updated: Agent[];

      if (mode === 'welcome') {
        updated = prev.map((agent, i) => ({
          ...agent,
          targetPosition: ALL_HANDS_POSITIONS[i % ALL_HANDS_POSITIONS.length],
        }));
        // placeholder welcome — the real one is triggered by hiring
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
          .filter(a => !a.isNew)
          .map((agent, i) => ({
            ...agent,
            targetPosition: targetPositions[i % targetPositions.length],
          }));
      }

      return updated;
    });
  }, []);

  // ---- Hire a new agent ----
  const handleHire = useCallback((config: AgentConfig) => {
    const id = `agent-${Date.now()}`;

    // Save to DB
    saveAgent({
      id,
      name: config.name,
      role: config.role,
      color: config.color,
      skin_tone: config.skinTone,
      model: config.model,
    });

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
      const updated = prev
        .filter(a => !a.isNew)
        .map((agent, i) => ({
          ...agent,
          targetPosition: ALL_HANDS_POSITIONS[i % ALL_HANDS_POSITIONS.length],
        }));
      updated.push(newAgent);
      return updated;
    });

    setHireModalOpen(false);

    // After welcome animation, transition new agent to their desk
    setTimeout(() => {
      setAgents(prev => {
        const allReal = prev.map(a => ({ ...a, isNew: undefined }));
        return allReal.map((agent, i) => ({
          ...agent,
          targetPosition: DESK_POSITIONS[i % DESK_POSITIONS.length],
        }));
      });
      setSceneMode('working');
    }, 4000);
  }, []);

  // ---- Edit an existing agent ----
  const handleEdit = useCallback((config: AgentConfig) => {
    if (!editingAgent) return;

    // Save to DB
    saveAgent({
      id: editingAgent.id,
      name: config.name,
      role: config.role,
      color: config.color,
      skin_tone: config.skinTone,
      model: config.model,
    });

    // Update in state
    setAgents(prev =>
      prev.map(a =>
        a.id === editingAgent.id
          ? { ...a, name: config.name, role: config.role, color: config.color, skinTone: config.skinTone, model: config.model }
          : a,
      ),
    );

    // Update selected agent too
    setSelectedAgent(prev =>
      prev && prev.id === editingAgent.id
        ? { ...prev, name: config.name, role: config.role, color: config.color, skinTone: config.skinTone, model: config.model }
        : prev,
    );

    setEditingAgent(null);
  }, [editingAgent]);

  // ---- Fire (delete) an agent ----
  const handleFire = useCallback((agentId: string) => {
    dbDeleteAgent(agentId);
    setAgents(prev => {
      const remaining = prev.filter(a => a.id !== agentId);
      // Re-assign desk positions
      return remaining.map((agent, i) => ({
        ...agent,
        targetPosition: DESK_POSITIONS[i % DESK_POSITIONS.length],
      }));
    });
    setSelectedAgent(null);
    setSceneMode('working');
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
      <SurveillanceControls
        sceneMode={sceneMode}
        onChangeScene={changeScene}
        agentCount={agents.filter(a => !a.isNew).length}
        onHireAgent={() => setHireModalOpen(true)}
      />

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
          onEdit={(agent) => setEditingAgent(agent)}
          onFire={(agent) => handleFire(agent.id)}
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
}

function AgentDetailSidebar({ agent, onClose, onEdit, onFire }: AgentDetailSidebarProps) {
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

        {/* Action buttons */}
        <div className="flex flex-col gap-1">
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
