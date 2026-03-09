import { useState, useEffect } from 'react';
import { Target, Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';
import { getSkillById } from '../../lib/skillsCache';

interface TaskExecution {
  id: string;
  skill_id: string;
  command_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: { output?: string; summary?: string; error?: string };
}

interface TaskPlanBlockProps {
  missionId: string;
  missionTitle: string;
  tasks: TaskExecution[];
}

const STATUS_CONFIG = {
  pending: { icon: Clock, color: 'text-cyan-400', border: 'border-cyan-400/30', bg: 'bg-cyan-400/[0.04]', label: 'QUEUED' },
  running: { icon: Loader2, color: 'text-cyan-400', border: 'border-cyan-400/30', bg: 'bg-cyan-400/[0.04]', label: 'EXECUTING...' },
  completed: { icon: CheckCircle, color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/[0.04]', label: 'COMPLETE' },
  failed: { icon: XCircle, color: 'text-red-400', border: 'border-red-500/30', bg: 'bg-red-500/[0.04]', label: 'FAILED' },
};

export default function TaskPlanBlock({ missionId, missionTitle, tasks: initialTasks }: TaskPlanBlockProps) {
  const [tasks, setTasks] = useState(initialTasks);

  // Listen for task execution updates via Realtime events
  useEffect(() => {
    const handler = () => {
      // Re-fetch task statuses for this mission
      import('../../lib/supabase').then(({ getSupabase }) => {
        getSupabase()
          .from('task_executions')
          .select('id, skill_id, command_name, status, result')
          .eq('mission_id', missionId)
          .then(({ data }) => {
            if (data) setTasks(data as TaskExecution[]);
          });
      });
    };

    window.addEventListener('task-executions-changed', handler);
    // Also poll every 3s as fallback
    const interval = setInterval(handler, 3000);
    return () => {
      window.removeEventListener('task-executions-changed', handler);
      clearInterval(interval);
    };
  }, [missionId]);

  // Overall mission status
  const allComplete = tasks.every(t => t.status === 'completed');
  const anyFailed = tasks.some(t => t.status === 'failed');
  const anyRunning = tasks.some(t => t.status === 'running');
  const overallStatus = allComplete ? 'completed' : anyFailed ? 'failed' : anyRunning ? 'running' : 'pending';
  const config = STATUS_CONFIG[overallStatus];
  const StatusIcon = config.icon;

  return (
    <div className={`my-3 rounded-lg border ${config.border} ${config.bg} overflow-hidden`}>
      {/* Mission header */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${config.border} bg-black/20`}>
        <Target size={12} className={config.color} />
        <span className="font-pixel text-[9px] tracking-widest text-zinc-400">MISSION</span>
        <span className="flex-1" />
        <StatusIcon size={12} className={`${config.color} ${overallStatus === 'running' ? 'animate-spin' : ''}`} />
        <span className={`font-pixel text-[9px] tracking-widest ${config.color}`}>{config.label}</span>
      </div>

      {/* Mission title */}
      <div className="px-3 py-2">
        <div className="font-pixel text-[10px] tracking-wider text-zinc-200">{missionTitle}</div>
      </div>

      {/* Task list */}
      <div className="px-3 pb-2 space-y-1">
        {tasks.map(task => {
          const skill = getSkillById(task.skill_id);
          const SkillIcon = Target; // Icon is a string in cache, use Target as uniform icon
          const taskConfig = STATUS_CONFIG[task.status];
          const TaskStatusIcon = taskConfig.icon;

          return (
            <div key={task.id} className="flex items-center gap-2 py-1">
              <SkillIcon size={12} className="text-zinc-500 flex-shrink-0" />
              <span className="font-pixel text-[9px] tracking-wider text-zinc-400 flex-1 truncate">
                {skill?.name ?? task.skill_id}
              </span>
              <TaskStatusIcon
                size={10}
                className={`${taskConfig.color} flex-shrink-0 ${task.status === 'running' ? 'animate-spin' : ''}`}
              />
            </div>
          );
        })}
      </div>

      {/* Completed: show preview */}
      {allComplete && tasks[0]?.result?.summary && (
        <div className="px-3 py-2 border-t border-emerald-500/20 bg-emerald-500/[0.03]">
          <div className="font-pixel text-[9px] tracking-wider text-zinc-500 line-clamp-2">
            {tasks[0].result.summary}...
          </div>
        </div>
      )}

      {/* Failed: show error */}
      {anyFailed && (
        <div className="px-3 py-2 border-t border-red-500/20 bg-red-500/[0.03]">
          <div className="font-pixel text-[9px] tracking-wider text-red-400">
            {tasks.find(t => t.status === 'failed')?.result?.error ?? 'Execution failed'}
          </div>
        </div>
      )}
    </div>
  );
}
