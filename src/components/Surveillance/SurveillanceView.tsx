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
  TIER_MEETING_ZONE,
  TIER_BREAK_ZONE,
  generateDeskPositions,
  getDeskCountWithSpare,
} from '../../lib/positionGenerator';
import type { RoomTier } from '../../lib/positionGenerator';
import { loadAgents, saveAgent, deleteAgent as dbDeleteAgent, loadCEO, getSetting, setSetting, saveAgentDeskPosition, saveCEODeskPosition, getVaultEntryByService, saveApproval, loadMissions, logAudit, assignSkillToAgent, updateCEOAppearance, getAgentConfidence } from '../../lib/database';
import { getAgentUsage } from '../../lib/llmUsage';
import type { AgentRow } from '../../lib/database';
import { getServiceForModel } from '../../lib/models';
import CRTFrame from './CRTFrame';
import PixelOffice from './PixelOffice';
import HireAgentModal from './HireAgentModal';
import type { AgentConfig } from './HireAgentModal';
import { playSuccessJingle } from '../../lib/sounds';
import { loadPendingActions, markActionSeen, dismissAction, type CEOAction } from '../../lib/ceoActionQueue';
import { handleManagementAction } from '../../lib/managementActions';
import { Pencil, Trash2, Zap, PlusCircle, MessageSquare, Brain, Save, CheckCircle } from 'lucide-react';
import { loadAgentActivity, type AgentActivity } from '../../lib/database';
import QuickChatPanel from './QuickChatPanel';

type CeremonyStage = 'entering' | 'celebrating' | 'walking_to_desk' | 'seated' | null;
type UpgradeStage = 'announce' | 'flash' | 'reveal' | 'settle' | null;

const CENTER_STAGE: Position = { x: 45, y: 50 };

/** Compute a celebration position offset from the CEO's current position.
 *  Falls back to CENTER_STAGE if CEO is not available. */
function getCelebrationPosition(ceoPos: Position | null): Position {
  if (!ceoPos) return { ...CENTER_STAGE };
  return { x: ceoPos.x + 7, y: ceoPos.y + 8 };
}

const DEFAULT_TASKS = [
  'Awaiting assignment...',
  'Running diagnostics...',
  'Scanning environment...',
  'Calibrating sensors...',
  'Indexing knowledge base...',
  'Optimizing parameters...',
];

function rowToAgent(row: AgentRow, pos: Position, index: number, confidence?: number, status?: AgentStatus, currentTask?: string, costSoFar?: number): Agent {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    color: row.color,
    skinTone: row.skin_tone,
    status: status ?? 'idle',
    position: { ...pos },
    targetPosition: { ...pos },
    currentTask: currentTask ?? 'Awaiting assignment...',
    confidence: confidence ?? 70,
    costSoFar: costSoFar ?? 0,
    model: row.model,
    metadata: row.metadata as Record<string, unknown> | undefined,
  };
}

export default function SurveillanceView() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [hireModalOpen, setHireModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const [quickChatOpen, setQuickChatOpen] = useState(false);
  const [quickChatAgent, setQuickChatAgent] = useState<Agent | null>(null);

  const [ceoAgent, setCeoAgent] = useState<Agent | null>(null);
  const [ceoArchetype, setCeoArchetype] = useState<string | null>(null);
  const [ceoRiskTolerance, setCeoRiskTolerance] = useState<string | null>(null);

  // Mission priorities for holographic board
  const [priorities, setPriorities] = useState<string[]>([]);

  // Active tasks for holographic board
  const [activeTasks, setActiveTasks] = useState<Array<{ skill: string; status: string; agent: string }>>([]);

  // Floor planner state
  const [floorPlannerActive, setFloorPlannerActive] = useState(false);
  const [floorPlannerSelectedId, setFloorPlannerSelectedId] = useState<string | null>(null);

  // Room tier — computed from agent count, overridable for testing
  const [tierOverride, setTierOverride] = useState<number | null>(null);
  const [lastClickCoords, setLastClickCoords] = useState<{ x: number; y: number } | null>(null);

  // ---- Ceremony state ----
  const [ceoStage, setCeoStage] = useState<CeremonyStage>(null);
  const ceoStageRef = useRef<CeremonyStage>(null);

  // ---- Approval notification state ----
  const [showApproval, setShowApproval] = useState(false);

  // ---- CEO proactive action notifications ----
  const [ceoActions, setCeoActions] = useState<CEOAction[]>([]);
  const dismissedAtRef = useRef<string | null>(localStorage.getItem('jarvis_ceo_dismissed_at'));

  // Hire ceremony: tracks which agent is being ceremonially introduced
  const [hireCeremony, setHireCeremony] = useState<{ agentId: string; stage: CeremonyStage; deskPos: Position } | null>(null);
  const hireCeremonyRef = useRef<typeof hireCeremony>(null);

  // Queue of pending hire ceremonies waiting to play after the current one finishes
  type PendingHire = { agentId: string; deskPos: Position; name: string; color: string; skinTone: string };
  const hireCeremonyQueueRef = useRef<PendingHire[]>([]);

  // Floor upgrade ceremony state
  const [upgradeStage, setUpgradeStage] = useState<UpgradeStage>(null);
  const [upgradeTier, setUpgradeTier] = useState<number | null>(null);
  const [speechBubble, setSpeechBubble] = useState<{ text: string; position: { x: number; y: number }; visible: boolean } | null>(null);
  // Pending hires after upgrade — array supports multiple rapid hires
  const pendingHiresAfterUpgradeRef = useRef<{ agent: Agent; deskPos: Position }[]>([]);

  // Room tier — computed after upgrade state is declared
  const computedTier = getRoomTier(agents.length);
  const roomTier = (tierOverride ?? (upgradeStage === 'flash' || upgradeStage === 'reveal' || upgradeStage === 'settle' ? upgradeTier : null) ?? computedTier) as RoomTier;

  // Ref for agents (used in confidence refresh to avoid dependency loops)
  const agentsRef = useRef(agents);
  useEffect(() => { agentsRef.current = agents; }, [agents]);

  // Ref for ceoAgent (used in event handler closures that capture stale state)
  const ceoAgentRef = useRef(ceoAgent);
  useEffect(() => { ceoAgentRef.current = ceoAgent; }, [ceoAgent]);

  // Ref for upgradeStage (used in event handler closures)
  const upgradeStageRef = useRef(upgradeStage);
  useEffect(() => { upgradeStageRef.current = upgradeStage; }, [upgradeStage]);

  // Keep refs in sync
  useEffect(() => { ceoStageRef.current = ceoStage; }, [ceoStage]);
  useEffect(() => { hireCeremonyRef.current = hireCeremony; }, [hireCeremony]);

  /** Start the next hire ceremony from the queue (if any). */
  const startNextHireCeremony = useCallback(() => {
    const next = hireCeremonyQueueRef.current.shift();
    if (!next) return;
    const celebrationPos = getCelebrationPosition(ceoAgentRef.current?.position ?? null);
    setHireCeremony({ agentId: next.agentId, stage: 'entering', deskPos: next.deskPos });
    setAgents(prev => prev.map(a =>
      a.id === next.agentId
        ? { ...a, position: { ...ENTRANCE_POSITION }, targetPosition: celebrationPos, status: 'walking' as AgentStatus, currentTask: 'Onboarding...' }
        : a,
    ));
  }, []);

  // ---- React to external agent changes (e.g. CEO hiring via chat) ----
  useEffect(() => {
    const reloadAgents = async () => {
      const rows = await loadAgents();
      const tier = getRoomTier(rows.length);
      const tierPresets = TIER_DESK_PRESETS[tier];
      const fallbackDesks = generateDeskPositions(getDeskCountWithSpare(rows.length));

      const { getSupabase: getSb } = await import('../../lib/supabase');
      const { data: runningTasks } = await getSb()
        .from('task_executions')
        .select('agent_id, skill_id')
        .in('status', ['pending', 'running']);
      const agentRunningTask = new Map<string, string>();
      for (const t of runningTasks ?? []) {
        if (t.agent_id && !agentRunningTask.has(t.agent_id)) {
          agentRunningTask.set(t.agent_id, t.skill_id);
        }
      }

      const loaded = await Promise.all(rows.map(async (row, i) => {
        const pos: Position = (row.desk_x != null && row.desk_y != null)
          ? { x: row.desk_x, y: row.desk_y }
          : tierPresets[i] ?? fallbackDesks[i] ?? { x: 30 + (i % 3) * 20, y: 40 + Math.floor(i / 3) * 20 };
        const [confidence, usage] = await Promise.all([
          getAgentConfidence(row.id),
          getAgentUsage(row.id),
        ]);
        let agentStatus: AgentStatus = 'idle';
        let agentTask = 'Awaiting assignment...';
        const running = agentRunningTask.get(row.id);
        if (running) {
          agentStatus = 'working';
          agentTask = `Executing: ${running}`;
        }
        return rowToAgent(row, pos, i, confidence, agentStatus, agentTask, usage.totalCost);
      }));
      setAgents(loaded);
      return loaded;
    };

    const handleAgentHired = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.agentId) return;

      // Capture old count BEFORE reload (agentsRef is still current here)
      const oldCount = agentsRef.current.length;
      // Reload agents from DB, then check for tier upgrade before starting ceremony
      reloadAgents().then((loaded) => {
        const newCount = loaded.length;
        const deskPos: Position = { x: detail.deskX ?? 50, y: detail.deskY ?? 50 };
        const hireInfo: PendingHire = {
          agentId: detail.agentId,
          deskPos,
          name: detail.name ?? 'AGENT',
          color: detail.color ?? '#50fa7b',
          skinTone: detail.skinTone ?? '#ffcc99',
        };

        const oldTier = getRoomTier(oldCount);
        const newTier = getRoomTier(newCount);

        if (newTier > oldTier && !upgradeStageRef.current) {
          // Tier upgrade! Run upgrade ceremony first, then hire ceremonies
          setUpgradeTier(newTier);
          setTierOverride(null);
          // Build a temporary Agent object for the pending hire
          const newAgent: Agent = {
            id: detail.agentId,
            name: hireInfo.name,
            role: '',
            color: hireInfo.color,
            skinTone: hireInfo.skinTone,
            status: 'idle',
            position: { x: -10, y: -10 },
            targetPosition: { x: -10, y: -10 },
            currentTask: 'Onboarding...',
            confidence: 50,
            costSoFar: 0,
            model: '',
          };
          // Hide the agent offscreen during upgrade ceremony
          setAgents(prev => prev.map(a =>
            a.id === detail.agentId
              ? { ...a, status: 'idle' as AgentStatus, position: { x: -10, y: -10 }, targetPosition: { x: -10, y: -10 } }
              : a,
          ));
          pendingHiresAfterUpgradeRef.current.push({ agent: newAgent, deskPos });
          setUpgradeStage('announce');
        } else if (upgradeStageRef.current) {
          // Upgrade already in progress — queue this hire for after upgrade
          const newAgent: Agent = {
            id: detail.agentId,
            name: hireInfo.name,
            role: '',
            color: hireInfo.color,
            skinTone: hireInfo.skinTone,
            status: 'idle',
            position: { x: -10, y: -10 },
            targetPosition: { x: -10, y: -10 },
            currentTask: 'Onboarding...',
            confidence: 50,
            costSoFar: 0,
            model: '',
          };
          setAgents(prev => prev.map(a =>
            a.id === detail.agentId
              ? { ...a, status: 'idle' as AgentStatus, position: { x: -10, y: -10 }, targetPosition: { x: -10, y: -10 } }
              : a,
          ));
          pendingHiresAfterUpgradeRef.current.push({ agent: newAgent, deskPos });
        } else if (hireCeremonyRef.current) {
          // A ceremony is already playing — queue this one
          setAgents(prev => prev.map(a =>
            a.id === detail.agentId
              ? { ...a, status: 'idle' as AgentStatus, position: { x: -10, y: -10 }, targetPosition: { x: -10, y: -10 } }
              : a,
          ));
          hireCeremonyQueueRef.current.push(hireInfo);
        } else {
          // No ceremony active — start immediately
          const celebrationPos = getCelebrationPosition(ceoAgentRef.current?.position ?? null);
          setHireCeremony({ agentId: detail.agentId, stage: 'entering', deskPos });
          setAgents(prev => prev.map(a =>
            a.id === detail.agentId
              ? { ...a, position: { ...ENTRANCE_POSITION }, targetPosition: celebrationPos, status: 'walking' as AgentStatus, currentTask: 'Onboarding...' }
              : a,
          ));
        }
      });
    };

    window.addEventListener('agents-changed', reloadAgents);
    window.addEventListener('agent-hired', handleAgentHired);
    return () => {
      window.removeEventListener('agents-changed', reloadAgents);
      window.removeEventListener('agent-hired', handleAgentHired);
    };
  }, []);

  // ---- Load agents from DB + CEO walk-in logic ----
  useEffect(() => {
    (async () => {
      const rows = await loadAgents();
      const tier = getRoomTier(rows.length);
      const tierPresets = TIER_DESK_PRESETS[tier];
      // Fallback desks for agents beyond the tier presets
      const fallbackDesks = generateDeskPositions(getDeskCountWithSpare(rows.length));

      // Check for running tasks per agent
      const { getSupabase: getSb } = await import('../../lib/supabase');
      const { data: runningTasks } = await getSb()
        .from('task_executions')
        .select('agent_id, skill_id')
        .in('status', ['pending', 'running']);
      const agentRunningTask = new Map<string, string>();
      for (const t of runningTasks ?? []) {
        if (t.agent_id && !agentRunningTask.has(t.agent_id)) {
          agentRunningTask.set(t.agent_id, t.skill_id);
        }
      }

      const loaded = await Promise.all(rows.map(async (row, i) => {
        // Use DB position if set, otherwise tier preset, otherwise generated fallback
        const pos: Position = (row.desk_x != null && row.desk_y != null)
          ? { x: row.desk_x, y: row.desk_y }
          : tierPresets[i] ?? fallbackDesks[i] ?? { x: 30 + (i % 3) * 20, y: 40 + Math.floor(i / 3) * 20 };
        const [confidence, usage] = await Promise.all([
          getAgentConfidence(row.id),
          getAgentUsage(row.id),
        ]);
        // Only running task_executions count as actually working
        let agentStatus: AgentStatus = 'idle';
        let agentTask = 'Awaiting assignment...';
        const running = agentRunningTask.get(row.id);
        if (running) {
          agentStatus = 'working';
          agentTask = `Executing: ${running}`;
        }
        return rowToAgent(row, pos, i, confidence, agentStatus, agentTask, usage.totalCost);
      }));
      setAgents(loaded);

      // CEO walk-in on first visit
      const ceoRow = await loadCEO();
      if (ceoRow) {
        setCeoArchetype(ceoRow.archetype ?? null);
        setCeoRiskTolerance(ceoRow.risk_tolerance ?? null);

        const ceoPos = (ceoRow.desk_x != null && ceoRow.desk_y != null)
          ? { x: ceoRow.desk_x, y: ceoRow.desk_y }
          : TIER_CEO_POSITION[tier];

        const ceoColor = ceoRow.color ?? '#f1fa8c';
        const ceoSkin = ceoRow.skin_tone ?? '#ffcc99';

        const [ceoConfidence, ceoUsage] = await Promise.all([
          getAgentConfidence('ceo'),
          getAgentUsage('ceo'),
        ]);

        const walkedIn = await getSetting('ceo_walked_in');
        if (!walkedIn) {
          setCeoStage('entering');
          setCeoAgent({
            id: 'ceo',
            name: ceoRow.name,
            role: 'Chief Executive Officer',
            color: ceoColor,
            skinTone: ceoSkin,
            status: 'walking',
            position: { ...ENTRANCE_POSITION },
            targetPosition: { ...CENTER_STAGE },
            currentTask: `Philosophy: ${ceoRow.philosophy}`,
            confidence: ceoConfidence,
            costSoFar: ceoUsage.totalCost,
            model: ceoRow.model,
          });
        } else {
          // Check if CEO actually has running tasks before setting status
          let initialStatus: AgentStatus = 'idle';
          let initialTask = 'Awaiting instructions...';
          try {
            const { getSupabase: getSb } = await import('../../lib/supabase');
            const { data: runningTasks } = await getSb()
              .from('task_executions')
              .select('skill_id')
              .eq('agent_id', 'ceo')
              .in('status', ['pending', 'running'])
              .limit(1);
            if (runningTasks && runningTasks.length > 0) {
              initialStatus = 'working';
              initialTask = `Executing: ${runningTasks[0].skill_id}`;
            }
            // Missions in_progress alone don't mean CEO is actively working —
            // only running task_executions count as real activity
          } catch { /* fall through to idle */ }
          setCeoAgent({
            id: 'ceo',
            name: ceoRow.name,
            role: 'Chief Executive Officer',
            color: ceoColor,
            skinTone: ceoSkin,
            status: initialStatus,
            position: { ...ceoPos },
            targetPosition: { ...ceoPos },
            currentTask: initialTask,
            confidence: ceoConfidence,
            costSoFar: ceoUsage.totalCost,
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

    const onMissionsActivity = () => {
      // Missions changing doesn't mean CEO is working —
      // only running task_executions trigger working status.
      // Just reset the idle timer so active mission management extends activity window.
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

  // ---- Refresh confidence scores + costs when tasks complete ----
  useEffect(() => {
    const refreshConfidenceAndCost = async () => {
      const currentAgents = agentsRef.current;
      const updatedAgents = await Promise.all(
        currentAgents.map(async a => {
          const [conf, usage] = await Promise.all([
            getAgentConfidence(a.id),
            getAgentUsage(a.id),
          ]);
          const cost = usage.totalCost;
          if (conf !== a.confidence || cost !== a.costSoFar) {
            return { ...a, confidence: conf, costSoFar: cost };
          }
          return a;
        })
      );
      // Only update if any value actually changed
      if (updatedAgents.some((a, i) => a !== currentAgents[i])) {
        setAgents(updatedAgents);
      }
      // CEO
      const [ceoConf, ceoUsage] = await Promise.all([
        getAgentConfidence('ceo'),
        getAgentUsage('ceo'),
      ]);
      setCeoAgent(prev => {
        if (!prev) return prev;
        if (prev.confidence !== ceoConf || prev.costSoFar !== ceoUsage.totalCost) {
          return { ...prev, confidence: ceoConf, costSoFar: ceoUsage.totalCost };
        }
        return prev;
      });
    };

    window.addEventListener('task-executions-changed', refreshConfidenceAndCost);
    return () => window.removeEventListener('task-executions-changed', refreshConfidenceAndCost);
  }, []);

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

  // ---- Load active task executions for holographic board ----
  useEffect(() => {
    const refreshTasks = async () => {
      try {
        const { getSupabase } = await import('../../lib/supabase');
        const { data } = await getSupabase()
          .from('task_executions')
          .select('skill_id, status, agent_id')
          .in('status', ['pending', 'running'])
          .order('created_at', { ascending: false })
          .limit(5);
        setActiveTasks((data ?? []).map(t => ({
          skill: t.skill_id,
          status: t.status,
          agent: t.agent_id === 'ceo' ? (ceoAgent?.name ?? 'CEO') : (agents.find(a => a.id === t.agent_id)?.name ?? t.agent_id),
        })));
      } catch { setActiveTasks([]); }
    };
    refreshTasks();
    window.addEventListener('task-executions-changed', refreshTasks);
    window.addEventListener('missions-changed', refreshTasks);
    const interval = setInterval(refreshTasks, 5000);
    return () => {
      window.removeEventListener('task-executions-changed', refreshTasks);
      window.removeEventListener('missions-changed', refreshTasks);
      clearInterval(interval);
    };
  }, [ceoAgent?.name, agents]);

  // ---- Load pending CEO proactive actions (only recent + not dismissed) ----
  useEffect(() => {
    const refresh = async () => {
      try {
        const actions = await loadPendingActions();
        // Only show actions created after the last dismiss (if any)
        const cutoff = dismissedAtRef.current;
        const filtered = cutoff
          ? actions.filter(a => a.created_at > cutoff)
          : actions;
        // Only show actions from the last 30 minutes
        const recency = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        setCeoActions(filtered.filter(a => a.created_at > recency));
      } catch {
        setCeoActions([]);
      }
    };
    refresh();
    window.addEventListener('ceo-actions-changed', refresh);
    window.addEventListener('task-executions-changed', refresh);
    const interval = setInterval(refresh, 8000);
    return () => {
      window.removeEventListener('ceo-actions-changed', refresh);
      window.removeEventListener('task-executions-changed', refresh);
      clearInterval(interval);
    };
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
      // Start next queued ceremony after a short pause
      if (hireCeremonyQueueRef.current.length > 0) {
        setTimeout(startNextHireCeremony, 300);
      }
    }
  }, [hireCeremony, startNextHireCeremony]);

  // ---- Floor upgrade ceremony stage effects ----
  useEffect(() => {
    if (!upgradeStage) return;

    if (upgradeStage === 'announce') {
      // CEO walks to center stage
      const centerPos = { ...CENTER_STAGE };
      setCeoAgent(prev => prev ? {
        ...prev,
        targetPosition: centerPos,
        status: 'walking' as AgentStatus,
      } : prev);
      // Show speech bubble after CEO arrives (give 2s for walking)
      const timer = setTimeout(() => {
        setSpeechBubble({
          text: "We're upgrading the office!",
          position: centerPos,
          visible: true,
        });
        // Move to flash after showing bubble for 2s
        setTimeout(() => {
          setSpeechBubble(null);
          setUpgradeStage('flash');
        }, 2000);
      }, 2000);
      return () => clearTimeout(timer);
    }

    if (upgradeStage === 'flash') {
      // Flash lasts 0.5s, then reveal
      const timer = setTimeout(() => {
        setUpgradeStage('reveal');
      }, 500);
      return () => clearTimeout(timer);
    }

    if (upgradeStage === 'reveal') {
      // Jingle + confetti play, banner shows
      playSuccessJingle();
      // After confetti completes (2.8s), settle
      const timer = setTimeout(() => {
        setUpgradeStage('settle');
      }, 2800);
      return () => clearTimeout(timer);
    }

    if (upgradeStage === 'settle') {
      // CEO walks to new tier desk
      const newTier = (upgradeTier ?? roomTier) as RoomTier;
      const newCeoPos = TIER_CEO_POSITION[newTier];
      setCeoAgent(prev => prev ? {
        ...prev,
        targetPosition: { ...newCeoPos },
        status: 'walking' as AgentStatus,
      } : prev);
      // After CEO settles (2.5s), drain all pending hires into ceremony queue
      const timer = setTimeout(() => {
        setUpgradeStage(null);
        setUpgradeTier(null);
        // Move all pending hires to the ceremony queue
        const pendingHires = pendingHiresAfterUpgradeRef.current.splice(0);
        for (const { agent: newAgent, deskPos } of pendingHires) {
          hireCeremonyQueueRef.current.push({
            agentId: newAgent.id,
            deskPos,
            name: newAgent.name,
            color: newAgent.color,
            skinTone: newAgent.skinTone ?? '#ffcc99',
          });
        }
        // Start the first one
        startNextHireCeremony();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [upgradeStage, upgradeTier, roomTier, startNextHireCeremony]);

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

    const celebrationPos = getCelebrationPosition(ceoAgent?.position ?? null);
    const newAgent: Agent = {
      id,
      name: config.name,
      role: config.role,
      color: config.color,
      skinTone: config.skinTone,
      status: 'walking',
      position: { ...ENTRANCE_POSITION },
      targetPosition: celebrationPos,
      currentTask: 'Onboarding...',
      confidence: 50,
      costSoFar: 0,
      model: config.model,
    };

    // Check for floor tier upgrade
    const oldTier = getRoomTier(agents.length);
    const newTier = getRoomTier(newCount);

    if (newTier > oldTier && ceoAgent) {
      // Tier upgrade! Run upgrade ceremony first, then hire ceremony
      setUpgradeTier(newTier);
      setTierOverride(null); // Clear any dev override
      // Add the agent to the list (hidden offscreen) but don't start hire ceremony yet
      setAgents(prev => [...prev, { ...newAgent, status: 'idle' as AgentStatus, position: { x: -10, y: -10 }, targetPosition: { x: -10, y: -10 } }]);
      pendingHiresAfterUpgradeRef.current.push({ agent: newAgent, deskPos });
      setUpgradeStage('announce');
    } else {
      // No tier change — standard hire ceremony
      setHireCeremony({ agentId: id, stage: 'entering', deskPos });
      setAgents(prev => [...prev, newAgent]);
    }

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

    if (editingAgent.id === 'ceo') {
      // CEO: update appearance in ceo table
      await updateCEOAppearance(config.color, config.skinTone, config.name);
      setCeoAgent(prev => prev ? {
        ...prev,
        name: config.name,
        color: config.color,
        skinTone: config.skinTone,
      } : prev);
      setSelectedAgent(prev =>
        prev && prev.id === 'ceo'
          ? { ...prev, name: config.name, color: config.color, skinTone: config.skinTone }
          : prev,
      );
    } else {
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
    }

    setEditingAgent(null);
    await logAudit(config.name, 'AGENT_EDITED', `Edited ${editingAgent.id === 'ceo' ? 'CEO' : 'agent'} "${config.name}"`, 'info');
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
    // Always show coordinates on click
    setLastClickCoords({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });

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
          // Already at desk, not in ceremony — preserve current status
          return { ...entity, position: { ...entity.targetPosition } };
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
          // Already at desk, not in ceremony — preserve current status (don't force 'working')
          return { ...prev, position: { ...prev.targetPosition } };
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
      <div className="flex-1 flex flex-col p-4 min-w-0 relative">
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
          {/* Dev test controls */}
          <div className="flex items-center gap-2 ml-auto">
            {/* Coordinate display */}
            {lastClickCoords && (
              <span className="font-pixel text-[6px] text-pixel-yellow tracking-wider font-bold">
                x:{lastClickCoords.x.toFixed(1)} y:{lastClickCoords.y.toFixed(1)}
              </span>
            )}
            <span className="text-gray-700">|</span>
            {/* Floor tier buttons */}
            <span className="font-pixel text-[5px] text-gray-600 tracking-wider">FLOOR:</span>
            {([1, 2, 3, 4] as const).map(t => (
              <button
                key={t}
                onClick={() => setTierOverride(prev => prev === t ? null : t)}
                className={`font-pixel text-[6px] tracking-wider px-1.5 py-0.5 border transition-colors
                  ${tierOverride === t
                    ? 'border-pixel-orange/60 text-pixel-orange bg-pixel-orange/15'
                    : 'border-gray-700/50 text-gray-500 hover:text-pixel-orange hover:border-pixel-orange/40 bg-transparent'
                  }`}
              >
                T{t}
              </button>
            ))}
            <span className="text-gray-700">|</span>
            {/* Animation test buttons */}
            <span className="font-pixel text-[5px] text-gray-600 tracking-wider">ANIM:</span>
            {(['idle', 'working', 'walking', 'celebrating', 'meeting', 'break'] as const).map(status => (
              <button
                key={status}
                onClick={() => {
                  const s = status as AgentStatus;
                  // For meeting/break, move sprites to zone positions; for idle/working, return to desk
                  let targetPos: Position | null = null;
                  if (s === 'meeting') targetPos = TIER_MEETING_ZONE[roomTier];
                  else if (s === 'break') targetPos = TIER_BREAK_ZONE[roomTier];

                  setCeoAgent(prev => {
                    if (!prev) return prev;
                    if (targetPos) {
                      return { ...prev, status: 'walking' as AgentStatus, targetPosition: { ...targetPos } };
                    }
                    // Return to desk
                    const desk = TIER_CEO_POSITION[roomTier];
                    return { ...prev, status: s, targetPosition: { ...desk } };
                  });
                  setAgents(prev => prev.map((a, i) => {
                    if (targetPos) {
                      // Spread agents in a semicircle around the zone center
                      const angle = ((i / Math.max(prev.length - 1, 1)) - 0.5) * Math.PI * 0.8;
                      const radius = 8 + (i % 2) * 3;
                      const offset = {
                        x: targetPos.x + Math.cos(angle) * radius,
                        y: targetPos.y + Math.sin(angle) * radius * 0.5,
                      };
                      return { ...a, status: 'walking' as AgentStatus, targetPosition: offset };
                    }
                    // Return to desk
                    return { ...a, status: s };
                  }));

                  // After walking to zone, switch to the target status
                  if (targetPos) {
                    setTimeout(() => {
                      setCeoAgent(prev => prev ? { ...prev, status: s } : prev);
                      setAgents(prev => prev.map(a => ({ ...a, status: s })));
                    }, 3000);
                  }
                }}
                className="font-pixel text-[5px] tracking-wider px-1.5 py-0.5 border border-gray-700/50 text-gray-500 hover:text-pixel-green hover:border-pixel-green/40 bg-transparent transition-colors"
              >
                {status.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <CRTFrame>
          <PixelOffice
            agents={agents}
            onAgentClick={handleAgentClickForPlanner}
            sceneMode="working"
            ceo={ceoAgent}
            roomTier={roomTier}
            priorities={priorities}
            activeTasks={activeTasks}
            floorPlannerActive={floorPlannerActive}
            onFloorClick={handleFloorClick}
            ceoArchetype={ceoArchetype}
            ceoRiskTolerance={ceoRiskTolerance}
            speechBubble={speechBubble}
            upgradeFlash={upgradeStage === 'flash'}
            upgradeConfetti={upgradeStage === 'reveal'}
            upgradeLevel={upgradeStage === 'reveal' ? (upgradeTier ?? roomTier) : null}
          />
        </CRTFrame>

        {/* Quick Chat Panel */}
        {quickChatOpen && (
          <QuickChatPanel
            onClose={() => { setQuickChatOpen(false); setQuickChatAgent(null); }}
            agent={quickChatAgent ? { id: quickChatAgent.id, name: quickChatAgent.name, role: quickChatAgent.role, model: quickChatAgent.model, color: quickChatAgent.color } : undefined}
          />
        )}
      </div>

      {selectedAgent && (
        <AgentDetailSidebar
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onEdit={(agent) => setEditingAgent(agent)}
          onFire={(agent) => handleFire(agent.id)}
          onQuickChat={() => { setQuickChatAgent(selectedAgent); setQuickChatOpen(true); }}
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

      {/* ---- CEO Proactive Actions ---- */}
      {ceoActions.length > 0 && !showApproval && !quickChatOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center pb-8 pointer-events-none">
          <div
            className="pointer-events-auto retro-window max-w-sm w-full animate-slide-up"
            style={{ animation: 'slide-up 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}
          >
            {ceoActions[0].topic === 'smart_hire_recommendation' ? (
              <>
                <div className="retro-window-title !text-[8px] !py-2 !px-3">
                  <span className="flex items-center gap-2">
                    <CheckCircle size={10} className="text-emerald-400" />
                    HIRE RECOMMENDATION
                  </span>
                </div>
                <div className="retro-window-body !m-2 flex flex-col items-center gap-3 py-3">
                  <div className="text-center">
                    <div className="font-pixel text-[9px] tracking-wider text-zinc-200 leading-relaxed">
                      <span className="text-yellow-300">{ceoAgent?.name ?? 'CEO'}</span> recommends:
                    </div>
                    <div className="font-pixel text-[8px] tracking-wider text-zinc-400 leading-relaxed mt-1">
                      {ceoActions[0].message}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="retro-button !text-[9px] !py-2 !px-6 tracking-widest hover:!text-emerald-400 !border-emerald-500/30"
                      onClick={async () => {
                        const action = ceoActions[0];
                        const hirePayload = action.payload?.hire_payload as Record<string, unknown>;
                        if (hirePayload) {
                          await handleManagementAction('hire_agent', hirePayload);
                        }
                        setCeoActions([]);
                        await markActionSeen(action.id);
                      }}
                    >
                      APPROVE HIRE
                    </button>
                    <button
                      className="retro-button !text-[8px] !py-2 !px-3 tracking-widest hover:!text-zinc-500"
                      onClick={async () => {
                        const action = ceoActions[0];
                        const now = new Date().toISOString();
                        dismissedAtRef.current = now;
                        localStorage.setItem('jarvis_ceo_dismissed_at', now);
                        setCeoActions([]);
                        await dismissAction(action.id);
                      }}
                    >
                      DISMISS
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="retro-window-title !text-[8px] !py-2 !px-3">
                  <span className="flex items-center gap-2">
                    <MessageSquare size={10} className="text-yellow-300" />
                    CEO WANTS TO CHAT
                  </span>
                </div>
                <div className="retro-window-body !m-2 flex flex-col items-center gap-3 py-3">
                  <div className="text-center">
                    <div className="font-pixel text-[9px] tracking-wider text-zinc-200 leading-relaxed">
                      <span className="text-yellow-300">{ceoAgent?.name ?? 'CEO'}</span> says:
                    </div>
                    <div className="font-pixel text-[8px] tracking-wider text-zinc-400 leading-relaxed mt-1">
                      {ceoActions[0].message}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="retro-button !text-[9px] !py-2 !px-6 tracking-widest hover:!text-emerald-400 !border-emerald-500/30"
                      onClick={async () => {
                        const action = ceoActions[0];
                        setCeoActions([]);
                        await markActionSeen(action.id);
                        navigate(action.navigateTo ?? '/chat');
                      }}
                    >
                      {ceoActions[0].navigateTo ? 'GO' : 'OPEN CHAT'}
                    </button>
                    <button
                      className="retro-button !text-[8px] !py-2 !px-4 tracking-widest hover:!text-zinc-300"
                      onClick={async () => {
                        const action = ceoActions[0];
                        setCeoActions(prev => prev.slice(1));
                        await dismissAction(action.id);
                      }}
                    >
                      REMIND LATER
                    </button>
                    <button
                      className="retro-button !text-[8px] !py-2 !px-3 tracking-widest hover:!text-zinc-500"
                      onClick={async () => {
                        const action = ceoActions[0];
                        const now = new Date().toISOString();
                        dismissedAtRef.current = now;
                        localStorage.setItem('jarvis_ceo_dismissed_at', now);
                        setCeoActions([]);
                        await dismissAction(action.id);
                      }}
                    >
                      DISMISS
                    </button>
                  </div>
                </div>
              </>
            )}
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
  onQuickChat: () => void;
  isCEO?: boolean;
}

function AgentDetailSidebar({ agent, onClose, onEdit, onFire, onQuickChat, isCEO }: AgentDetailSidebarProps) {
  const [confirmFire, setConfirmFire] = useState(false);
  const [activity, setActivity] = useState<AgentActivity | null>(null);
  const [realCost, setRealCost] = useState<{ totalCost: number; taskCount: number } | null>(null);
  const [ceoPhilosophy, setCeoPhilosophy] = useState<string | null>(null);

  // Show Brain state
  const [showBrain, setShowBrain] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editSystemPrompt, setEditSystemPrompt] = useState('');
  const [editUserPrompt, setEditUserPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  // Load live activity + real cost for this agent — refresh on events
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      loadAgentActivity(agent.id).then(a => {
        if (!cancelled) setActivity(a);
      }).catch(() => {});
      import('../../lib/llmUsage').then(({ getAgentUsage }) => {
        getAgentUsage(agent.id).then(u => {
          if (!cancelled) setRealCost(u);
        });
      }).catch(() => {});
    };
    refresh();
    // Load CEO philosophy from DB
    if (isCEO) {
      loadCEO().then(ceo => {
        if (!cancelled && ceo) setCeoPhilosophy(ceo.philosophy);
      }).catch(() => {});
    }
    // Refresh activity when events fire
    window.addEventListener('chat-messages-changed', refresh);
    window.addEventListener('task-executions-changed', refresh);
    window.addEventListener('missions-changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('chat-messages-changed', refresh);
      window.removeEventListener('task-executions-changed', refresh);
      window.removeEventListener('missions-changed', refresh);
    };
  }, [agent.id, isCEO]);

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

        {isCEO && ceoPhilosophy && (
          <div>
            <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">PHILOSOPHY</div>
            <div className="retro-inset p-2 font-pixel text-[7px] text-pixel-green leading-relaxed tracking-wider">
              {ceoPhilosophy}
            </div>
          </div>
        )}
        <div>
          <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">CURRENT TASK</div>
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
            ${(realCost?.totalCost ?? agent.costSoFar).toFixed(2)}
          </div>
          {realCost && realCost.taskCount > 0 && (
            <div className="font-pixel text-[6px] text-gray-500 tracking-wider mt-0.5">
              {realCost.taskCount} TASK{realCost.taskCount !== 1 ? 'S' : ''} EXECUTED
            </div>
          )}
        </div>

        {/* Live Activity */}
        {activity && (
          <>
            <div className="border-t border-pixel-crt-border" />
            <div>
              <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">ACTIVE MISSION</div>
              {activity.mission ? (
                <div className="retro-inset p-2">
                  <div className="font-pixel text-[7px] text-pixel-green tracking-wider leading-relaxed">
                    {activity.mission.title}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`font-pixel text-[6px] tracking-wider px-1 py-0.5 rounded-sm ${
                      activity.mission.status === 'in_progress' ? 'bg-pixel-green/20 text-pixel-green'
                        : activity.mission.status === 'review' ? 'bg-pixel-orange/20 text-pixel-orange'
                        : 'bg-gray-600/20 text-gray-400'
                    }`}>
                      {activity.mission.status.toUpperCase().replace('_', ' ')}
                    </span>
                    <span className={`font-pixel text-[6px] tracking-wider ${
                      activity.mission.priority === 'critical' ? 'text-red-400'
                        : activity.mission.priority === 'high' ? 'text-pixel-orange'
                        : 'text-gray-500'
                    }`}>
                      {activity.mission.priority.toUpperCase()}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="font-pixel text-[7px] text-gray-500 tracking-wider">
                  No active mission
                </div>
              )}
            </div>

            {activity.taskExecution && (
              <div>
                <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">EXECUTING</div>
                <div className="retro-inset p-2 flex items-center gap-2">
                  <Zap size={8} className="text-pixel-cyan flex-shrink-0" />
                  <div>
                    <div className="font-pixel text-[7px] text-pixel-cyan tracking-wider">
                      {activity.taskExecution.skill_id}
                    </div>
                    <div className="font-pixel text-[6px] text-gray-500 tracking-wider">
                      {activity.taskExecution.command_name} — {activity.taskExecution.status}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!activity.taskExecution && !activity.mission && (
              <div>
                <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">ACTIVITY</div>
                <div className="font-pixel text-[7px] text-gray-500 tracking-wider italic">
                  Idle — waiting for assignment
                </div>
              </div>
            )}

            {activity.assignedSkills.length > 0 && (
              <div>
                <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">SKILLS ({activity.assignedSkills.length})</div>
                <div className="flex flex-wrap gap-1">
                  {activity.assignedSkills.map(s => (
                    <span key={s} className="font-pixel text-[6px] tracking-wider px-1.5 py-0.5 rounded-sm bg-pixel-cyan/10 text-pixel-cyan border border-pixel-cyan/20">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Show Brain — non-CEO agents only */}
        {!isCEO && (
          <div>
            <button
              className="retro-button w-full !text-[8px] !py-2 text-center tracking-widest hover:!text-pixel-cyan flex items-center justify-center gap-2"
              onClick={() => {
                setShowBrain(prev => !prev);
                setEditMode(false);
              }}
            >
              <Brain size={10} />
              {showBrain ? 'HIDE BRAIN' : 'SHOW BRAIN'}
            </button>

            {showBrain && (
              <div className="mt-2 flex flex-col gap-2">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-pixel text-[6px] text-gray-500 tracking-wider">SYSTEM PROMPT</span>
                    {!editMode && (
                      <button
                        className="text-gray-500 hover:text-pixel-cyan transition-colors"
                        onClick={() => {
                          setEditSystemPrompt((agent.metadata?.system_prompt as string) ?? '');
                          setEditUserPrompt((agent.metadata?.user_prompt as string) ?? '');
                          setEditMode(true);
                        }}
                      >
                        <Pencil size={8} />
                      </button>
                    )}
                  </div>
                  {editMode ? (
                    <textarea
                      className="w-full retro-inset p-2 font-pixel text-[7px] text-pixel-green leading-relaxed tracking-wider bg-transparent resize-y min-h-[60px] outline-none"
                      rows={4}
                      value={editSystemPrompt}
                      onChange={e => setEditSystemPrompt(e.target.value)}
                    />
                  ) : (
                    <div className="retro-inset p-2 font-pixel text-[7px] text-pixel-green leading-relaxed tracking-wider max-h-[100px] overflow-y-auto no-scrollbar">
                      {(agent.metadata?.system_prompt as string) || '(no system prompt)'}
                    </div>
                  )}
                </div>

                <div>
                  <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">USER PROMPT</div>
                  {editMode ? (
                    <textarea
                      className="w-full retro-inset p-2 font-pixel text-[7px] text-pixel-green leading-relaxed tracking-wider bg-transparent resize-y min-h-[60px] outline-none"
                      rows={4}
                      value={editUserPrompt}
                      onChange={e => setEditUserPrompt(e.target.value)}
                    />
                  ) : (
                    <div className="retro-inset p-2 font-pixel text-[7px] text-pixel-green leading-relaxed tracking-wider max-h-[100px] overflow-y-auto no-scrollbar">
                      {(agent.metadata?.user_prompt as string) || '(no user prompt)'}
                    </div>
                  )}
                </div>

                <div>
                  <div className="font-pixel text-[6px] text-gray-500 tracking-wider mb-1">BRAIN MODEL</div>
                  <span className="inline-block font-pixel text-[7px] tracking-wider px-2 py-1 bg-pixel-floor border border-pixel-crt-border text-pixel-cyan rounded-sm">
                    {agent.model}
                  </span>
                </div>

                {editMode && (
                  <div className="flex gap-1">
                    <button
                      className="retro-button flex-1 !text-[7px] !py-2 text-center tracking-widest hover:!text-pixel-green flex items-center justify-center gap-1"
                      disabled={saving}
                      onClick={async () => {
                        setSaving(true);
                        try {
                          const updatedMetadata = {
                            ...(agent.metadata ?? {}),
                            system_prompt: editSystemPrompt,
                            user_prompt: editUserPrompt,
                          };
                          const { getSupabase } = await import('../../lib/supabase');
                          await getSupabase().from('agents').update({ metadata: updatedMetadata }).eq('id', agent.id);
                          agent.metadata = updatedMetadata;
                          setEditMode(false);
                          window.dispatchEvent(new Event('agents-changed'));
                        } catch (err) {
                          console.error('[ShowBrain] Save failed:', err);
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      <Save size={8} />
                      {saving ? 'SAVING...' : 'SAVE'}
                    </button>
                    <button
                      className="retro-button flex-1 !text-[7px] !py-2 text-center tracking-widest"
                      onClick={() => setEditMode(false)}
                    >
                      CANCEL
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex-1" />

        <div className="flex flex-col gap-1">
          <button
            className="retro-button w-full !text-[8px] !py-2 text-center tracking-widest hover:!text-pixel-cyan flex items-center justify-center gap-2"
            onClick={() => onEdit(agent)}
          >
            <Pencil size={10} />
            EDIT LOOK
          </button>

          {!isCEO && (
            <>
              {!confirmFire ? (
                <button
                  className="retro-button w-full !text-[8px] !py-2 text-center tracking-widest !text-red-400 hover:!text-red-300 flex items-center justify-center gap-2"
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
            className="retro-button w-full !text-[8px] !py-2 text-center tracking-widest !text-emerald-400 hover:!text-emerald-300 flex items-center justify-center gap-2"
            onClick={onQuickChat}
          >
            <MessageSquare size={10} />
            QUICK CHAT
          </button>

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
