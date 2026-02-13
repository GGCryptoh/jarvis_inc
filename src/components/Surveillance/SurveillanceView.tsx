import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Agent, AgentStatus, Position } from '../../types';
import {
  ENTRANCE_POSITION,
} from '../../data/dummyData';
import {
  getRoomTier,
  TIER_DESK_PRESETS,
  TIER_CEO_POSITION,
  generateDeskPositions,
  getDeskCountWithSpare,
} from '../../lib/positionGenerator';
import { loadAgents, saveAgent, deleteAgent as dbDeleteAgent, loadCEO, getSetting, setSetting, saveAgentDeskPosition, saveCEODeskPosition, getVaultEntryByService, saveApproval, loadMissions, logAudit, assignSkillToAgent } from '../../lib/database';
import type { AgentRow } from '../../lib/database';
import { getServiceForModel } from '../../lib/models';
import CRTFrame from './CRTFrame';
import PixelOffice from './PixelOffice';
import HireAgentModal from './HireAgentModal';
import type { AgentConfig } from './HireAgentModal';
import { playSuccessJingle } from '../../lib/sounds';
import { Pencil, Trash2, Zap, PlusCircle } from 'lucide-react';

type CeremonyStage = 'entering' | 'celebrating' | 'walking_to_desk' | 'seated' | null;

const CENTER_STAGE: Position = { x: 45, y: 50 };

const DEFAULT_TASKS = [
  'Awaiting assignment...',
  'Running diagnostics...',
  'Scanning environment...',
  'Calibrating sensors...',
  'Indexing knowledge base...',
  'Optimizing parameters...',
];

function rowToAgent(row: AgentRow, pos: Position, index: number): Agent {
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

export default function SurveillanceView() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [hireModalOpen, setHireModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const [ceoAgent, setCeoAgent] = useState<Agent | null>(null);
  const [ceoArchetype, setCeoArchetype] = useState<string | null>(null);
  const [ceoRiskTolerance, setCeoRiskTolerance] = useState<string | null>(null);

  // Mission priorities for holographic board
  const [priorities, setPriorities] = useState<string[]>([]);

  // Floor planner state
  const [floorPlannerActive, setFloorPlannerActive] = useState(false);
  const [floorPlannerSelectedId, setFloorPlannerSelectedId] = useState<string | null>(null);

  // Room tier — computed from agent count
  const roomTier = getRoomTier(agents.length);

  // ---- Ceremony state ----
  const [ceoStage, setCeoStage] = useState<CeremonyStage>(null);
  const ceoStageRef = useRef<CeremonyStage>(null);

  // ---- Approval notification state ----
  const [showApproval, setShowApproval] = useState(false);

  // Hire ceremony: tracks which agent is being ceremonially introduced
  const [hireCeremony, setHireCeremony] = useState<{ agentId: string; stage: CeremonyStage; deskPos: Position } | null>(null);
  const hireCeremonyRef = useRef<typeof hireCeremony>(null);

  // Keep refs in sync
  useEffect(() => { ceoStageRef.current = ceoStage; }, [ceoStage]);
  useEffect(() => { hireCeremonyRef.current = hireCeremony; }, [hireCeremony]);

  // ---- Load agents from DB + CEO walk-in logic ----
  useEffect(() => {
    (async () => {
      const rows = await loadAgents();
      const tier = getRoomTier(rows.length);
      const tierPresets = TIER_DESK_PRESETS[tier];
      // Fallback desks for agents beyond the tier presets
      const fallbackDesks = generateDeskPositions(getDeskCountWithSpare(rows.length));

      const loaded = rows.map((row, i) => {
        // Use DB position if set, otherwise tier preset, otherwise generated fallback
        const pos: Position = (row.desk_x != null && row.desk_y != null)
          ? { x: row.desk_x, y: row.desk_y }
          : tierPresets[i] ?? fallbackDesks[i] ?? { x: 30 + (i % 3) * 20, y: 40 + Math.floor(i / 3) * 20 };
        return rowToAgent(row, pos, i);
      });
      setAgents(loaded);

      // CEO walk-in on first visit
      const ceoRow = await loadCEO();
      if (ceoRow) {
        setCeoArchetype(ceoRow.archetype ?? null);
        setCeoRiskTolerance(ceoRow.risk_tolerance ?? null);

        const ceoPos = (ceoRow.desk_x != null && ceoRow.desk_y != null)
          ? { x: ceoRow.desk_x, y: ceoRow.desk_y }
          : TIER_CEO_POSITION[tier];

        const walkedIn = await getSetting('ceo_walked_in');
        if (!walkedIn) {
          setCeoStage('entering');
          setCeoAgent({
            id: 'ceo',
            name: ceoRow.name,
            role: 'Chief Executive Officer',
            color: '#f1fa8c',
            skinTone: '#ffcc99',
            status: 'walking',
            position: { ...ENTRANCE_POSITION },
            targetPosition: { ...CENTER_STAGE },
            currentTask: `Philosophy: ${ceoRow.philosophy}`,
            confidence: 99,
            costSoFar: 0,
            model: ceoRow.model,
          });
        } else {
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
          const meetingDone = await getSetting('ceo_meeting_done');
          if (!meetingDone) {
            setShowApproval(true);
          }
        }
      }
    })();
  }, []);

  // ---- CEO real-time status from events ----
  const ceoIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ceoAgent || ceoStage) return; // Don't interfere during ceremony

    const resetIdleTimer = () => {
      if (ceoIdleTimer.current) clearTimeout(ceoIdleTimer.current);
      ceoIdleTimer.current = setTimeout(() => {
        setCeoAgent(prev => prev ? { ...prev, status: 'idle' as AgentStatus, currentTask: 'Awaiting instructions...' } : prev);
      }, 30000); // 30s of no activity → idle
    };

    const onChatActivity = () => {
      setCeoAgent(prev => prev ? { ...prev, status: 'meeting' as AgentStatus, currentTask: 'Chatting with Founder...' } : prev);
      resetIdleTimer();
    };

    const onTaskActivity = async () => {
      // Check for running tasks
      try {
        const { getSupabase } = await import('../../lib/supabase');
        const { data } = await getSupabase()
          .from('task_executions')
          .select('skill_id, status')
          .eq('agent_id', 'ceo')
          .in('status', ['pending', 'running'])
          .order('created_at', { ascending: false })
          .limit(1);
        if (data && data.length > 0) {
          setCeoAgent(prev => prev ? { ...prev, status: 'working' as AgentStatus, currentTask: `Executing: ${data[0].skill_id}` } : prev);
        }
      } catch { /* ignore */ }
      resetIdleTimer();
    };

    const onMissionsActivity = async () => {
      try {
        const all = await loadMissions();
        const inProgress = all.filter(m => m.status === 'in_progress');
        if (inProgress.length > 0) {
          setCeoAgent(prev => prev ? {
            ...prev,
            status: 'working' as AgentStatus,
            currentTask: inProgress[0].title.length > 35 ? inProgress[0].title.slice(0, 32) + '...' : inProgress[0].title,
          } : prev);
        }
      } catch { /* ignore */ }
      resetIdleTimer();
    };

    window.addEventListener('chat-messages-changed', onChatActivity);
    window.addEventListener('task-executions-changed', onTaskActivity);
    window.addEventListener('missions-changed', onMissionsActivity);
    resetIdleTimer();

    return () => {
      window.removeEventListener('chat-messages-changed', onChatActivity);
      window.removeEventListener('task-executions-changed', onTaskActivity);
      window.removeEventListener('missions-changed', onMissionsActivity);
      if (ceoIdleTimer.current) clearTimeout(ceoIdleTimer.current);
    };
  }, [ceoAgent?.id, ceoStage]);

  // ---- Load missions for priorities board ----
  useEffect(() => {
    const refreshPriorities = async () => {
      const meetingDone = await getSetting('ceo_meeting_done');
      if (!meetingDone) {
        // Before onboarding: show contextual first-time priorities
        setPriorities([
          'Meet the Founder',
          'Set Company Goals',
          'Enable first skill',
        ]);
        return;
      }
      const all = await loadMissions();
      const active = all.filter(m => m.status !== 'done').slice(0, 3);
      setPriorities(active.map(m => {
        // Truncate long titles for the small holographic board
        return m.title.length > 40 ? m.title.slice(0, 37) + '...' : m.title;
      }));
    };
    refreshPriorities();
    const interval = setInterval(refreshPriorities, 10000);
    return () => clearInterval(interval);
  }, []);

  // ---- CEO ceremony stage effects ----
  useEffect(() => {
    if (ceoStage === 'celebrating') {
      playSuccessJingle();
      const timer = setTimeout(() => {
        setCeoStage('walking_to_desk');
        const ceoPos = TIER_CEO_POSITION[roomTier];
        setCeoAgent(prev => prev ? {
          ...prev,
          targetPosition: { ...ceoPos },
          status: 'walking' as AgentStatus,
        } : prev);
      }, 2500);
      return () => clearTimeout(timer);
    }
    if (ceoStage === 'seated') {
      (async () => {
        await setSetting('ceo_walked_in', 'true');
        setCeoStage(null);
        // Show approval notification if meeting hasn't happened yet
        const meetingDone = await getSetting('ceo_meeting_done');
        if (!meetingDone) {
          setTimeout(() => setShowApproval(true), 800);
        }
      })();
    }
  }, [ceoStage]);

  // ---- Hire ceremony stage effects ----
  useEffect(() => {
    if (!hireCeremony) return;

    if (hireCeremony.stage === 'celebrating') {
      playSuccessJingle();
      const timer = setTimeout(() => {
        const deskPos = hireCeremony.deskPos;
        const agentId = hireCeremony.agentId;
        setHireCeremony(prev => prev ? { ...prev, stage: 'walking_to_desk' } : prev);
        setAgents(prev => prev.map(a =>
          a.id === agentId
            ? { ...a, targetPosition: { ...deskPos }, status: 'walking' as AgentStatus }
            : a,
        ));
      }, 1500);
      return () => clearTimeout(timer);
    }
    if (hireCeremony.stage === 'seated') {
      setHireCeremony(null);
    }
  }, [hireCeremony]);

  // ---- Hire a new agent (persists to DB) ----
  const handleHire = useCallback(async (config: AgentConfig) => {
    const id = `agent-${Date.now()}`;

    await saveAgent({
      id,
      name: config.name,
      role: config.role,
      color: config.color,
      skin_tone: config.skinTone,
      model: config.model,
    });

    // Check if vault has an API key for this model's service
    const service = getServiceForModel(config.model);
    const existingKey = await getVaultEntryByService(service);
    if (!existingKey) {
      await saveApproval({
        id: `approval-${Date.now()}`,
        type: 'api_key_request',
        title: `API Key Required: ${service}`,
        description: `Agent ${config.name} needs a ${service} API key to operate with ${config.model}.`,
        status: 'pending',
        metadata: { service, model: config.model, agentId: id },
      });
    }

    // Determine desk position from tier presets or fallback
    const newCount = agents.length + 1;
    const tier = getRoomTier(newCount);
    const tierPresets = TIER_DESK_PRESETS[tier];
    const fallbackDesks = generateDeskPositions(getDeskCountWithSpare(newCount));
    const deskPos = tierPresets[agents.length] ?? fallbackDesks[agents.length] ?? { x: 40, y: 60 };

    // Start hire ceremony — agent walks from entrance to center stage
    setHireCeremony({ agentId: id, stage: 'entering', deskPos });

    const newAgent: Agent = {
      id,
      name: config.name,
      role: config.role,
      color: config.color,
      skinTone: config.skinTone,
      status: 'walking',
      position: { ...ENTRANCE_POSITION },
      targetPosition: { ...CENTER_STAGE },
      currentTask: 'Onboarding...',
      confidence: 50,
      costSoFar: 0,
      model: config.model,
    };

    setAgents(prev => [...prev, newAgent]);
    setHireModalOpen(false);

    // Assign selected skills to the new agent
    if (config.selectedSkills && config.selectedSkills.length > 0) {
      for (const skillId of config.selectedSkills) {
        await assignSkillToAgent(id, skillId, 'founder');
      }
    }

    await logAudit(config.name, 'AGENT_HIRED', `Hired agent "${config.name}" (${config.role}) using ${config.model}`, 'info');
  }, [agents.length]);

  // ---- Edit an existing agent (persists to DB) ----
  const handleEdit = useCallback(async (config: AgentConfig) => {
    if (!editingAgent) return;

    await saveAgent({
      id: editingAgent.id,
      name: config.name,
      role: config.role,
      color: config.color,
      skin_tone: config.skinTone,
      model: config.model,
    });

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
    await logAudit(config.name, 'AGENT_EDITED', `Edited agent "${config.name}" (${config.role})`, 'info');
  }, [editingAgent]);

  // ---- Fire (delete) an agent (persists to DB) ----
  const handleFire = useCallback(async (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    await logAudit(agent?.name ?? agentId, 'AGENT_FIRED', `Fired agent "${agent?.name ?? agentId}"`, 'warning');
    await dbDeleteAgent(agentId);
    setAgents(prev => prev.filter(a => a.id !== agentId));
    setSelectedAgent(null);
  }, [agents]);

  // ---- Floor planner: handle click on office floor ----
  const handleFloorClick = useCallback(async (x: number, y: number) => {
    if (!floorPlannerSelectedId) return;

    // Save position to DB
    console.log(`[FloorPlanner] ${floorPlannerSelectedId} placed at { x: ${Math.round(x * 10) / 10}, y: ${Math.round(y * 10) / 10} }`);
    if (floorPlannerSelectedId === 'ceo') {
      await saveCEODeskPosition(x, y);
      setCeoAgent(prev => prev ? {
        ...prev,
        targetPosition: { x, y },
      } : prev);
    } else {
      await saveAgentDeskPosition(floorPlannerSelectedId, x, y);
      setAgents(prev => prev.map(a =>
        a.id === floorPlannerSelectedId
          ? { ...a, targetPosition: { x, y } }
          : a,
      ));
    }

    setFloorPlannerSelectedId(null);
  }, [floorPlannerSelectedId]);

  // ---- Floor planner: handle agent selection ----
  const handleAgentClickForPlanner = useCallback((agent: Agent) => {
    if (floorPlannerActive) {
      setFloorPlannerSelectedId(prev => prev === agent.id ? null : agent.id);
    } else {
      setSelectedAgent(agent);
    }
  }, [floorPlannerActive]);

  // ---- Position interpolation (constant-speed) loop ----
  useEffect(() => {
    const MOVE_SPEED = 0.6; // % per 50ms tick → uniform speed

    const interval = setInterval(() => {
      // Move regular agents
      setAgents(prev => prev.map(entity => {
        const dx = entity.targetPosition.x - entity.position.x;
        const dy = entity.targetPosition.y - entity.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.5) {
          // Check if this agent is in a hire ceremony
          const hc = hireCeremonyRef.current;
          if (hc && hc.agentId === entity.id) {
            if (hc.stage === 'entering') {
              setTimeout(() => setHireCeremony(prev => prev ? { ...prev, stage: 'celebrating' } : prev), 0);
              return { ...entity, position: { ...entity.targetPosition }, status: 'celebrating' as AgentStatus };
            }
            if (hc.stage === 'walking_to_desk') {
              setTimeout(() => setHireCeremony(prev => prev ? { ...prev, stage: 'seated' } : prev), 0);
              return { ...entity, position: { ...entity.targetPosition }, status: 'working' as AgentStatus };
            }
          }
          if (entity.status === 'celebrating') {
            return { ...entity, position: { ...entity.targetPosition } };
          }
          return { ...entity, position: { ...entity.targetPosition }, status: 'working' as AgentStatus };
        }

        // Normalize direction, apply constant speed (no overshoot)
        const step = Math.min(MOVE_SPEED, dist);
        const nx = dx / dist;
        const ny = dy / dist;

        return {
          ...entity,
          status: (entity.status === 'celebrating' ? 'celebrating' : 'walking') as AgentStatus,
          position: {
            x: entity.position.x + nx * step,
            y: entity.position.y + ny * step,
          },
        };
      }));

      // Move CEO
      setCeoAgent(prev => {
        if (!prev) return prev;
        const dx = prev.targetPosition.x - prev.position.x;
        const dy = prev.targetPosition.y - prev.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.5) {
          const stage = ceoStageRef.current;
          if (stage === 'entering') {
            setTimeout(() => setCeoStage('celebrating'), 0);
            return { ...prev, position: { ...prev.targetPosition }, status: 'celebrating' as AgentStatus };
          }
          if (stage === 'walking_to_desk') {
            setTimeout(() => setCeoStage('seated'), 0);
            return { ...prev, position: { ...prev.targetPosition }, status: 'working' as AgentStatus };
          }
          if (prev.status === 'celebrating') {
            return { ...prev, position: { ...prev.targetPosition } };
          }
          return { ...prev, position: { ...prev.targetPosition }, status: 'working' as AgentStatus };
        }

        const step = Math.min(MOVE_SPEED, dist);
        const nx = dx / dist;
        const ny = dy / dist;

        return {
          ...prev,
          status: (prev.status === 'celebrating' ? 'celebrating' : 'walking') as AgentStatus,
          position: {
            x: prev.position.x + nx * step,
            y: prev.position.y + ny * step,
          },
        };
      });
    }, 50);

    return () => clearInterval(interval);
  }, []);

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

  const TOP_MENU = ['OVERVIEW', 'FLOOR PLAN', 'NETWORK', 'ANALYTICS'] as const;

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col p-4 min-w-0">
        {/* ---- Header: Live indicator + top menu + hire button ---- */}
        <div className="flex items-center justify-between mb-2">
          <div className="font-pixel text-pixel-green text-[9px] flex items-center gap-2 tracking-wider">
            <span className="animate-blink">&#9679;</span> SURVEILLANCE FEED &mdash; LIVE
          </div>
          <button
            onClick={() => setHireModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 font-pixel text-[7px] tracking-wider
              border border-pixel-cyan/40 text-pixel-cyan bg-pixel-cyan/10 hover:bg-pixel-cyan/20 transition-colors"
          >
            <PlusCircle size={10} />
            HIRE AGENT
          </button>
        </div>

        {/* ---- Top Menu Buttons ---- */}
        <div className="flex items-center gap-1 mb-2">
          {TOP_MENU.map((label) => {
            const isFloorPlan = label === 'FLOOR PLAN';
            const isActive = isFloorPlan ? floorPlannerActive : label === 'OVERVIEW';
            return (
              <button
                key={label}
                className={`font-pixel text-[7px] tracking-wider px-3 py-1.5 border transition-colors
                  ${isActive
                    ? 'border-pixel-cyan/50 text-pixel-cyan bg-pixel-cyan/15'
                    : 'border-gray-600/40 text-gray-500 hover:text-gray-300 hover:border-gray-500 bg-transparent'
                  }`}
                onClick={() => {
                  if (isFloorPlan) {
                    setFloorPlannerActive(prev => !prev);
                    setFloorPlannerSelectedId(null);
                  }
                }}
              >
                {label}
              </button>
            );
          })}
          {floorPlannerActive && (
            <span className="font-pixel text-[6px] text-pixel-orange tracking-wider ml-2">
              {floorPlannerSelectedId ? 'CLICK FLOOR TO PLACE' : 'SELECT AN AGENT'}
            </span>
          )}
        </div>

        <CRTFrame>
          <PixelOffice
            agents={agents}
            onAgentClick={handleAgentClickForPlanner}
            sceneMode="working"
            ceo={ceoAgent}
            roomTier={roomTier}
            priorities={priorities}
            floorPlannerActive={floorPlannerActive}
            onFloorClick={handleFloorClick}
            ceoArchetype={ceoArchetype}
            ceoRiskTolerance={ceoRiskTolerance}
          />
        </CRTFrame>
      </div>

      {selectedAgent && (
        <AgentDetailSidebar
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onEdit={(agent) => setEditingAgent(agent)}
          onFire={(agent) => handleFire(agent.id)}
          isCEO={selectedAgent.id === 'ceo'}
        />
      )}

      <HireAgentModal
        open={hireModalOpen || !!editingAgent}
        onClose={() => { setHireModalOpen(false); setEditingAgent(null); }}
        onSubmit={editingAgent ? handleEdit : handleHire}
        editAgent={editingAgent}
      />

      {/* ---- CEO Meeting Approval Notification ---- */}
      {showApproval && (
        <div className="fixed inset-0 z-50 flex items-end justify-center pb-8 pointer-events-none">
          <div
            className="pointer-events-auto retro-window max-w-sm w-full animate-slide-up"
            style={{ animation: 'slide-up 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}
          >
            <div className="retro-window-title !text-[8px] !py-2 !px-3">
              <span className="flex items-center gap-2">
                <Zap size={10} className="text-yellow-300" />
                PENDING APPROVAL
              </span>
            </div>
            <div className="retro-window-body !m-2 flex flex-col items-center gap-4 py-4">
              <div className="w-10 h-10 rounded-full bg-yellow-400/20 border-2 border-yellow-400/40 flex items-center justify-center">
                <span className="font-pixel text-[14px] text-yellow-300">♛</span>
              </div>
              <div className="text-center">
                <div className="font-pixel text-[9px] tracking-wider text-zinc-200 leading-relaxed">
                  <span className="text-yellow-300">{ceoAgent?.name ?? 'Your CEO'}</span>, your CEO,
                </div>
                <div className="font-pixel text-[9px] tracking-wider text-zinc-200 leading-relaxed">
                  would like a meeting with you.
                </div>
              </div>
              <button
                className="retro-button !text-[10px] !py-3 !px-8 tracking-widest hover:!text-emerald-400 !border-emerald-500/30"
                onClick={() => {
                  setShowApproval(false);
                  navigate('/chat');
                }}
              >
                APPROVE
              </button>
            </div>
          </div>
        </div>
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
      <div className="retro-window-title !text-[8px] !py-2 !px-3">
        <span>{isCEO ? 'CEO DETAIL' : 'AGENT DETAIL'}</span>
      </div>

      <div className="retro-window-body !m-2 flex-1 flex flex-col gap-3 overflow-y-auto no-scrollbar">
        <div className="flex items-center gap-3">
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

        <div className="border-t border-pixel-crt-border" />

        <div>
          <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">MODEL</div>
          <span className="inline-block font-pixel text-[7px] tracking-wider px-2 py-1 bg-pixel-floor border border-pixel-crt-border text-pixel-cyan rounded-sm">
            {agent.model}
          </span>
        </div>

        <div>
          <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">{isCEO ? 'PHILOSOPHY' : 'CURRENT TASK'}</div>
          <div className="retro-inset p-2 font-pixel text-[7px] text-pixel-green leading-relaxed tracking-wider">
            {agent.currentTask}
          </div>
        </div>

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

        <div>
          <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">COST SO FAR</div>
          <div className="font-pixel text-[12px] text-pixel-yellow tracking-wider">
            ${agent.costSoFar.toFixed(2)}
          </div>
        </div>

        <div className="flex-1" />

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
