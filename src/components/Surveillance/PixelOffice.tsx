import { useState, useMemo } from 'react';
import type { Agent, SceneMode } from '../../types';
import AgentSprite from './AgentSprite';
import CEOSprite from './CEOSprite';
import type { RoomTier } from '../../lib/positionGenerator';
import { FLOOR_IMAGES, TIER_CEO_POSITION } from '../../lib/positionGenerator';

interface PixelOfficeProps {
  agents: Agent[];
  onAgentClick: (agent: Agent) => void;
  sceneMode: SceneMode;
  ceo: Agent | null;
  roomTier: RoomTier;
  /** Floor planner mode — click on office floor to set desk position */
  floorPlannerActive?: boolean;
  onFloorClick?: (x: number, y: number) => void;
  /** Live mission priorities to display on the holographic board */
  priorities?: string[];
  /** CEO personality archetype (e.g. 'wharton_mba', 'wall_street') */
  ceoArchetype?: string | null;
  /** CEO risk tolerance level */
  ceoRiskTolerance?: string | null;
  /** Active task executions (pending/running) */
  activeTasks?: Array<{ skill: string; status: string; agent: string }>;
}

export default function PixelOffice({
  agents,
  onAgentClick,
  sceneMode,
  ceo,
  roomTier,
  floorPlannerActive = false,
  onFloorClick,
  priorities = [],
  ceoArchetype,
  ceoRiskTolerance,
  activeTasks = [],
}: PixelOfficeProps) {
  const [hoverExtinguisher, setHoverExtinguisher] = useState(false);
  const floorImage = FLOOR_IMAGES[roomTier];
  const ceoPos = TIER_CEO_POSITION[roomTier];

  // Compute meeting zone clusters — group agents in 'meeting' status and
  // render a glow circle at the centroid of each cluster.
  const meetingZones = useMemo(() => {
    const meetingAgents = agents.filter(a => a.status === 'meeting');
    // Include CEO if in meeting
    if (ceo?.status === 'meeting') meetingAgents.push(ceo);
    if (meetingAgents.length < 2) return [];

    // Simple single-cluster: centroid of all meeting agents
    const cx = meetingAgents.reduce((s, a) => s + a.position.x, 0) / meetingAgents.length;
    const cy = meetingAgents.reduce((s, a) => s + a.position.y, 0) / meetingAgents.length;
    // Radius proportional to spread (min 8%, max 18%)
    const maxDist = Math.max(
      ...meetingAgents.map(a => Math.sqrt((a.position.x - cx) ** 2 + (a.position.y - cy) ** 2)),
    );
    const radius = Math.max(8, Math.min(18, maxDist + 4));

    return [{ x: cx, y: cy, radius }];
  }, [agents, ceo]);

  const handleFloorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!floorPlannerActive || !onFloorClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onFloorClick(x, y);
  };

  return (
    <div
      className={`relative w-full h-full overflow-hidden ${floorPlannerActive ? 'cursor-crosshair' : ''}`}
      style={{ minHeight: '400px' }}
      onClick={handleFloorClick}
    >
      {/* ---- Background Image ---- */}
      <img
        src={floorImage}
        alt="Office floor"
        className="absolute inset-0 w-full h-full object-cover pixel-art"
        draggable={false}
      />

      {/* ---- Floor Planner Grid Overlay ---- */}
      {floorPlannerActive && (
        <div
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(rgba(0,255,136,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,136,0.08) 1px, transparent 1px)',
            backgroundSize: '5% 5%',
          }}
        />
      )}

      {/* ---- Holographic Mission Board (top-right) ---- */}
      {ceo && (
        <div
          className="absolute z-[3] pointer-events-none"
          style={{
            right: '3%',
            top: '4%',
          }}
        >
          {/* Priorities */}
          <div
            className="px-5 py-4 rounded-sm"
            style={{
              background: 'linear-gradient(180deg, rgba(0,255,136,0.10) 0%, rgba(0,255,136,0.04) 100%)',
              border: '1px solid rgba(200,220,255,0.35)',
              boxShadow: '0 0 12px rgba(0,255,136,0.08), inset 0 0 8px rgba(0,255,136,0.03)',
            }}
          >
            <div className="font-pixel text-[8px] text-gray-200 tracking-widest mb-1.5">TODAY&apos;S PRIORITIES</div>
            <div className="font-pixel text-[7px] text-pixel-green/80 tracking-wider leading-[12px]">
              {priorities.length > 0 ? (
                priorities.slice(0, 3).map((p, i) => (
                  <div key={i}>{i + 1}. {p}</div>
                ))
              ) : (
                <div className="text-gray-500/60">No active missions</div>
              )}
            </div>
          </div>

          {/* Active Tasks */}
          {activeTasks.length > 0 && (
            <div
              className="px-5 py-3 rounded-sm mt-2"
              style={{
                background: 'linear-gradient(180deg, rgba(0,200,255,0.08) 0%, rgba(0,200,255,0.03) 100%)',
                border: '1px solid rgba(0,200,255,0.25)',
                boxShadow: '0 0 10px rgba(0,200,255,0.06), inset 0 0 6px rgba(0,200,255,0.02)',
              }}
            >
              <div className="font-pixel text-[7px] text-cyan-300/80 tracking-widest mb-1.5">ACTIVE TASKS</div>
              <div className="font-pixel text-[6px] tracking-wider leading-[11px] space-y-1">
                {activeTasks.slice(0, 4).map((t, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className={`w-1 h-1 rounded-full flex-shrink-0 ${
                      t.status === 'running' ? 'bg-cyan-400 animate-pulse' : 'bg-yellow-400/60'
                    }`} />
                    <span className="text-cyan-200/70 truncate" style={{ maxWidth: '140px' }}>
                      {t.skill}
                    </span>
                    <span className="text-gray-500/60 ml-auto flex-shrink-0">
                      {t.agent}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Fire Extinguisher Tooltip Zone ---- */}
      {roomTier <= 3 && (
        <div
          className="absolute z-[4] cursor-pointer"
          style={{ right: '5%', top: '52%', width: '30px', height: '40px' }}
          onMouseEnter={() => setHoverExtinguisher(true)}
          onMouseLeave={() => setHoverExtinguisher(false)}
          onClick={(e) => e.stopPropagation()}
        >
          {hoverExtinguisher && (
            <div className="absolute -top-[28px] left-1/2 -translate-x-1/2 z-30">
              <div className="bg-pixel-bg border border-pixel-crt-border rounded px-2 py-1 font-pixel text-[6px] text-pixel-orange tracking-wider whitespace-nowrap shadow-lg">
                Break Glass (Coming Soon)
              </div>
              <div className="w-0 h-0 mx-auto border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[3px] border-t-pixel-crt-border" />
            </div>
          )}
        </div>
      )}

      {/* ---- Meeting Zone Glow ---- */}
      {meetingZones.map((zone, i) => (
        <div
          key={`meeting-zone-${i}`}
          className="absolute z-[4] pointer-events-none animate-pulse"
          style={{
            left: `${zone.x}%`,
            top: `${zone.y}%`,
            width: `${zone.radius * 2}%`,
            height: `${zone.radius * 2}%`,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(189,147,249,0.12) 0%, rgba(189,147,249,0.04) 50%, transparent 70%)',
            border: '1px solid rgba(189,147,249,0.15)',
            boxShadow: '0 0 20px rgba(189,147,249,0.08)',
          }}
        />
      ))}

      {/* ---- Agent Sprites ---- */}
      {agents.map((agent, idx) => (
        <AgentSprite
          key={agent.id}
          agent={agent}
          onClick={() => onAgentClick(agent)}
          floorPlannerActive={floorPlannerActive}
          facing={idx % 2 === 0 ? 'right' : 'left'}
        />
      ))}

      {/* ---- CEO Sprite ---- */}
      {ceo && (
        <CEOSprite
          agent={ceo}
          onClick={() => onAgentClick(ceo)}
          archetype={ceoArchetype}
          riskTolerance={ceoRiskTolerance}
        />
      )}
    </div>
  );
}
