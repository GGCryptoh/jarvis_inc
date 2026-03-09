import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Clock, DollarSign, Zap, CheckCircle2, XCircle, RefreshCw, Archive, Trash2, ChevronDown, ChevronRight, FileText, FileDown, Copy, Check } from 'lucide-react';
import { loadMissions, loadTaskExecutions, updateMissionStatus, deleteMission, logAudit, getSetting, setSetting, loadMissionRounds, loadAuditLog, type MissionRow, type MissionRoundRow, type AuditLogRow } from '../../lib/database';
import { rerunMission } from '../../lib/taskDispatcher';
import { getSkillName } from '../../lib/skillsCache';
import RichResultCard, { detectRichContent } from '../Chat/RichResultCard';
import MissionScorecard, { gradeColors } from './MissionScorecard';
import RejectMissionModal from './RejectMissionModal';

/** Renders text with auto-detected rich content (images, links, documents) */
function RichResultDisplay({ text }: { text: string }) {
  const detected = detectRichContent(text);

  if (detected.length === 0) {
    return <div className="text-sm text-zinc-300 whitespace-pre-line leading-relaxed">{text}</div>;
  }

  let remaining = text;
  for (const item of detected) {
    remaining = remaining.replace(item.url, '');
  }
  remaining = remaining
    .replace(/\( *\)/g, '')
    .replace(/\[ *\]/g, '')
    .replace(/  +/g, ' ')
    .trim();

  return (
    <>
      {remaining && <div className="text-sm text-zinc-300 whitespace-pre-line leading-relaxed">{remaining}</div>}
      {detected.map((item, i) => (
        <RichResultCard key={`rich-${i}`} item={item} />
      ))}
    </>
  );
}

const statusBadge: Record<string, string> = {
  backlog: 'bg-zinc-500/20 text-zinc-400 border border-zinc-500/30',
  scheduled: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  in_progress: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  review: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  done: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
  archived: 'bg-zinc-700/40 text-zinc-500 border border-zinc-700/50',
};

const priorityBadge: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  low: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
};

function taskStatusColor(status: string): string {
  switch (status) {
    case 'completed': return 'text-emerald-400';
    case 'failed': return 'text-red-400';
    case 'running': return 'text-cyan-400 animate-pulse';
    case 'pending': return 'text-yellow-400';
    default: return 'text-zinc-400';
  }
}

function RecurringBadge({ cron }: { cron: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-cyan-400">
      <RefreshCw size={11} />
      <span className="text-zinc-400">{cron}</span>
    </span>
  );
}

export default function MissionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [mission, setMission] = useState<MissionRow | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [autoCloseOnApprove, setAutoCloseOnApprove] = useState<boolean | null>(null);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [dialogAutoClose, setDialogAutoClose] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [evalExpanded, setEvalExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'results' | 'rounds' | 'activity'>('results');
  const [rounds, setRounds] = useState<MissionRoundRow[]>([]);
  const [activityLog, setActivityLog] = useState<AuditLogRow[]>([]);
  const [showRejectModal, setShowRejectModal] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const all = await loadMissions();
      const found = all.find(m => m.id === id);
      setMission(found ?? null);
      const taskData = await loadTaskExecutions(id);
      setTasks(taskData);

      // Load mission rounds
      const roundData = await loadMissionRounds(id);
      setRounds(roundData);

      // Load activity log entries mentioning this mission
      const allLogs = await loadAuditLog(500);
      const missionLogs = allLogs.filter(l =>
        l.details?.includes(id) || l.details?.includes(found?.title ?? '')
      );
      setActivityLog(missionLogs);

      const autoCloseSetting = await getSetting('auto_close_on_approve');
      setAutoCloseOnApprove(autoCloseSetting === 'true');

      setLoading(false);
    })();

    const refresh = async () => {
      const all = await loadMissions();
      setMission(all.find(m => m.id === id) ?? null);
      const taskData = await loadTaskExecutions(id);
      setTasks(taskData);
      // Reload rounds
      const roundData = await loadMissionRounds(id);
      setRounds(roundData);
    };
    window.addEventListener('missions-changed', refresh);
    window.addEventListener('task-executions-changed', refresh);
    return () => {
      window.removeEventListener('missions-changed', refresh);
      window.removeEventListener('task-executions-changed', refresh);
    };
  }, [id]);

  // ESC key navigates back (closes modals first)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (showApproveDialog) { setShowApproveDialog(false); }
        else if (showRejectModal) { setShowRejectModal(false); }
        else if (deleteConfirm) { setDeleteConfirm(false); }
        else { navigate(-1); }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigate, showApproveDialog, showRejectModal, deleteConfirm]);

  // Derived metrics
  const totalCost = tasks.reduce((sum: number, t: any) => sum + (t.cost_usd ?? 0), 0);
  const totalTokens = tasks.reduce((sum: number, t: any) => sum + (t.tokens_used ?? 0), 0);
  const completedTasks = tasks.filter((t: any) => t.status === 'completed').length;
  const failedTasks = tasks.filter((t: any) => t.status === 'failed').length;
  const runningTasks = tasks.filter((t: any) => t.status === 'running' || t.status === 'pending').length;

  // Latest round with scores
  const latestScoredRound = rounds.find(r => r.overall_score !== null);

  // Separate mission-summary from regular tasks
  const summaryTask = tasks.find((t: any) => t.skill_id === 'mission-summary');
  const regularTasks = tasks.filter((t: any) => t.skill_id !== 'mission-summary');
  const summaryOutput = summaryTask?.result?.output as string | undefined;

  // Duration calculation
  const startTime = tasks.length > 0 ? new Date(tasks[0].created_at).getTime() : null;
  const completedTimes = tasks.filter((t: any) => t.completed_at).map((t: any) => new Date(t.completed_at).getTime());
  const endTime = completedTimes.length > 0 ? Math.max(...completedTimes) : null;
  const durationMs = startTime && endTime && endTime > startTime ? endTime - startTime : null;
  const durationStr = durationMs
    ? (durationMs < 60000 ? `${Math.round(durationMs / 1000)}s` : `${Math.round(durationMs / 60000)}m`)
    : null;

  // Action handlers
  const handleApprove = async () => {
    if (!mission) return;
    if (autoCloseOnApprove) {
      await performApprove();
      navigate('/missions');
    } else {
      setDialogAutoClose(false);
      setShowApproveDialog(true);
    }
  };

  const performApprove = async () => {
    if (!mission) return;
    await updateMissionStatus(mission.id, 'done');
    await logAudit('Founder', 'MISSION_APPROVED', `Approved: ${mission.title} ($${totalCost.toFixed(4)})`, 'info');
    window.dispatchEvent(new Event('missions-changed'));
  };

  const confirmApprove = async (withAutoClose: boolean) => {
    await performApprove();
    if (withAutoClose) {
      await setSetting('auto_close_on_approve', 'true');
      setAutoCloseOnApprove(true);
    }
    setShowApproveDialog(false);
    navigate('/missions');
  };

  const handleDiscard = async () => {
    if (!mission) return;
    await updateMissionStatus(mission.id, 'done');
    await logAudit('Founder', 'MISSION_DISCARDED', `Discarded: ${mission.title}`, 'warning');
    window.dispatchEvent(new Event('missions-changed'));
    const all = await loadMissions();
    setMission(all.find(m => m.id === mission.id) ?? null);
  };

  const handleCancel = async () => {
    if (!mission) return;
    await updateMissionStatus(mission.id, 'backlog');
    await logAudit('Founder', 'MISSION_CANCELLED', `Cancelled: ${mission.title}`, 'warning');
    window.dispatchEvent(new Event('missions-changed'));
    const all = await loadMissions();
    setMission(all.find(m => m.id === mission.id) ?? null);
  };

  const handleArchive = async () => {
    if (!mission) return;
    await updateMissionStatus(mission.id, 'archived');
    await logAudit('Founder', 'MISSION_ARCHIVED', `Archived: ${mission.title}`, 'info');
    window.dispatchEvent(new Event('missions-changed'));
    navigate('/missions');
  };

  const handleRerun = async () => {
    if (!mission) return;
    await logAudit('Founder', 'MISSION_RERUN', `Re-run: ${mission.title}`, 'info');
    await rerunMission(mission.id);
    const all = await loadMissions();
    setMission(all.find(m => m.id === mission.id) ?? null);
  };

  const handleDelete = async () => {
    if (!mission) return;
    await logAudit('Founder', 'MISSION_DEL', `Deleted mission "${mission.title}"`, 'warning');
    await deleteMission(mission.id);
    window.dispatchEvent(new Event('missions-changed'));
    navigate('/missions');
  };

  function formatDate(iso: string | null): string {
    if (!iso) return '\u2014';
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '\u2014';
    }
  }

  // Loading / not found states
  if (loading) {
    return <div className="p-6 text-zinc-500 text-sm">Loading mission...</div>;
  }

  if (!mission) {
    return (
      <div className="p-6 text-zinc-500 text-sm">
        Mission not found.{' '}
        <Link to="/missions" className="text-emerald-400 hover:text-emerald-300 transition-colors">
          Back to Mission Control
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 h-full overflow-y-auto max-w-4xl mx-auto">
      {/* Approve confirmation dialog */}
      {showApproveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowApproveDialog(false)}
          />
          <div className="relative bg-jarvis-surface border border-jarvis-border rounded-lg p-6 w-full max-w-sm shadow-2xl">
            <h3 className="font-pixel text-[9px] tracking-wider text-emerald-400 uppercase mb-3">
              APPROVE MISSION
            </h3>
            <p className="text-sm text-zinc-300 mb-5">
              Mark this mission as done?
            </p>
            <label className="flex items-center gap-2.5 mb-6 cursor-pointer group">
              <input
                type="checkbox"
                checked={dialogAutoClose}
                onChange={(e) => setDialogAutoClose(e.target.checked)}
                className="w-3.5 h-3.5 rounded border border-jarvis-border bg-jarvis-bg text-emerald-500 focus:ring-emerald-500/30 focus:ring-offset-0 cursor-pointer"
              />
              <span className="font-pixel text-[8px] tracking-wider text-zinc-400 group-hover:text-zinc-300 transition-colors">
                Auto-close mission log on Approve
              </span>
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => confirmApprove(dialogAutoClose)}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-black bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors"
              >
                <CheckCircle2 size={13} />
                APPROVE & CLOSE
              </button>
              <button
                onClick={() => setShowApproveDialog(false)}
                className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-jarvis-border rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back navigation + breadcrumb */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/missions')}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-jarvis-border text-zinc-400 hover:text-zinc-200 hover:border-white/[0.15] transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <div className="text-xs text-jarvis-muted">
            <Link to="/missions" className="hover:text-zinc-300 transition-colors">MISSION CONTROL</Link>
            <span className="mx-2">/</span>
            <span className="text-zinc-300">{mission.title}</span>
          </div>
        </div>
      </div>

      {/* Mission header card */}
      <div className="bg-jarvis-surface border border-jarvis-border rounded-lg p-5 mb-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-center">
            <h1 className="text-lg font-bold text-white leading-snug">{mission.title}</h1>
            {mission.current_round > 1 && (
              <span className="text-[10px] font-bold tracking-wider text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded px-2 py-0.5 ml-2 shrink-0">
                ROUND {mission.current_round}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${statusBadge[mission.status] ?? 'bg-zinc-500/20 text-zinc-400'}`}>
              {mission.status.replace('_', ' ')}
            </span>
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full ${priorityBadge[mission.priority] ?? 'bg-zinc-500/20 text-zinc-400'}`}>
              {mission.priority}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-jarvis-muted flex-wrap">
          {mission.assignee && (
            <span>
              <span className="text-zinc-500">Assignee:</span>{' '}
              <span className="text-zinc-300">{mission.assignee}</span>
            </span>
          )}
          <span>
            <span className="text-zinc-500">Created:</span>{' '}
            <span className="text-zinc-300">{formatDate(mission.created_at)}</span>
          </span>
          {mission.due_date && (
            <span>
              <span className="text-zinc-500">Due:</span>{' '}
              <span className="text-zinc-300">{formatDate(mission.due_date)}</span>
            </span>
          )}
          {mission.recurring && <RecurringBadge cron={mission.recurring} />}
          {mission.recurring && mission.max_runs != null && (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span className="text-violet-400 font-semibold">{mission.run_count ?? 0}/{mission.max_runs} runs</span>
              {(mission.run_count ?? 0) >= mission.max_runs && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-0.5">
                  COMPLETE
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="bg-jarvis-surface border border-jarvis-border rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={12} className="text-zinc-500" />
            <span className="text-[10px] font-medium text-jarvis-muted uppercase tracking-wider">Total Cost</span>
          </div>
          <div className="text-sm font-semibold text-zinc-200 tabular-nums">${totalCost.toFixed(2)}</div>
        </div>
        <div className="bg-jarvis-surface border border-jarvis-border rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={12} className="text-zinc-500" />
            <span className="text-[10px] font-medium text-jarvis-muted uppercase tracking-wider">Tokens</span>
          </div>
          <div className="text-sm font-semibold text-zinc-200 tabular-nums">{totalTokens.toLocaleString()}</div>
        </div>
        <div className="bg-jarvis-surface border border-jarvis-border rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={12} className="text-zinc-500" />
            <span className="text-[10px] font-medium text-jarvis-muted uppercase tracking-wider">Tasks</span>
          </div>
          <div className="text-sm font-semibold text-zinc-200 tabular-nums">
            {completedTasks}/{tasks.length} completed
            {failedTasks > 0 && <span className="text-red-400 ml-1">({failedTasks} failed)</span>}
            {runningTasks > 0 && <span className="text-cyan-400 ml-1">({runningTasks} running)</span>}
          </div>
        </div>
        <div className="bg-jarvis-surface border border-jarvis-border rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={12} className="text-zinc-500" />
            <span className="text-[10px] font-medium text-jarvis-muted uppercase tracking-wider">Duration</span>
          </div>
          <div className="text-sm font-semibold text-zinc-200 tabular-nums">{durationStr ?? '\u2014'}</div>
        </div>
      </div>

      {/* Action buttons row */}
      <div className="flex items-center gap-2 mb-6">
        {mission.status === 'review' && (
          <>
            <button
              onClick={handleApprove}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-black bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors"
            >
              <CheckCircle2 size={13} />
              APPROVE
            </button>
            <button
              onClick={handleDiscard}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 rounded-lg transition-colors"
            >
              <XCircle size={13} />
              DISCARD
            </button>
            <button
              onClick={() => setShowRejectModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 border border-orange-500/20 rounded-lg transition-colors"
            >
              <RefreshCw size={13} />
              REJECT &amp; REDO
            </button>
          </>
        )}
        {mission.status === 'in_progress' && !failedTasks && (
          <button
            onClick={handleCancel}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 rounded-lg transition-colors"
          >
            <XCircle size={13} />
            CANCEL
          </button>
        )}
        {mission.status === 'done' && (
          <button
            onClick={handleArchive}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-jarvis-border rounded-lg transition-colors"
          >
            <Archive size={13} />
            ARCHIVE
          </button>
        )}
        {/* RE-RUN available whenever there are failed tasks — fix and retry now, or come back later */}
        {failedTasks > 0 && (
          <button
            onClick={handleRerun}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 border border-cyan-500/20 rounded-lg transition-colors"
          >
            <RefreshCw size={13} />
            RE-RUN
          </button>
        )}
        <div className="flex-1" />
        {!deleteConfirm ? (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
          >
            <Trash2 size={12} />
            DELETE
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={handleDelete}
              className="px-3 py-2 text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors"
            >
              Confirm Delete
            </button>
            <button
              onClick={() => setDeleteConfirm(false)}
              className="px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* CEO Summary — only show if auto_summary exists (plain text from CEO) */}
      {!summaryOutput && regularTasks.length > 0 && regularTasks[0]?.result?.auto_summary && (
        <div className="mb-5 bg-jarvis-surface border border-jarvis-border rounded-lg p-4">
          <div className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider mb-2">CEO SUMMARY</div>
          <div className="text-sm text-zinc-300 leading-relaxed">
            <RichResultDisplay text={regularTasks[0].result.auto_summary} />
          </div>
        </div>
      )}

      {/* CEO Evaluation — collapsible accordion (default collapsed) */}
      {latestScoredRound && (
        <div className="mb-5 bg-jarvis-surface border border-white/[0.06] rounded-xl overflow-hidden">
          <button
            onClick={() => setEvalExpanded(!evalExpanded)}
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-2">
              {evalExpanded ? <ChevronDown size={14} className="text-zinc-400" /> : <ChevronRight size={14} className="text-zinc-400" />}
              <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">CEO EVALUATION</span>
            </div>
            <span className={`text-lg font-bold px-3 py-1 rounded-lg border ${gradeColors[latestScoredRound.grade!] ?? 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'}`}>
              {latestScoredRound.grade}
            </span>
          </button>
          {evalExpanded && (
            <div className="border-t border-white/[0.06] px-1 pb-1">
              <MissionScorecard
                quality={latestScoredRound.quality_score!}
                completeness={latestScoredRound.completeness_score!}
                efficiency={latestScoredRound.efficiency_score!}
                overall={latestScoredRound.overall_score!}
                grade={latestScoredRound.grade!}
                review={latestScoredRound.ceo_review ?? ''}
                recommendation={latestScoredRound.ceo_recommendation ?? 'approve'}
              />
            </div>
          )}
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex items-center gap-0 mb-5 border-b border-jarvis-border">
        {(['results', 'rounds', 'activity'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 -mb-[1px] ${
              activeTab === tab
                ? 'text-emerald-400 border-emerald-500'
                : 'text-zinc-500 border-transparent hover:text-zinc-300'
            }`}
          >
            {tab === 'results' ? `RESULTS (${regularTasks.length})` : tab === 'rounds' ? `ROUNDS (${rounds.length})` : `ACTIVITY (${activityLog.length})`}
          </button>
        ))}
      </div>

      {/* RESULTS tab */}
      {activeTab === 'results' && (
        <>
          {/* Executive Summary (from mission-summary synthesis) */}
          {summaryOutput && (
            <div className="mb-6 border border-emerald-500/20 rounded-lg overflow-hidden bg-jarvis-surface">
              <button
                onClick={() => setSummaryExpanded(!summaryExpanded)}
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/[0.02] transition-colors"
              >
                {summaryExpanded ? <ChevronDown size={14} className="text-emerald-400" /> : <ChevronRight size={14} className="text-emerald-400" />}
                <FileText size={14} className="text-emerald-400" />
                <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">EXECUTIVE SUMMARY</span>
              </button>
              {summaryExpanded && (
                <div className="px-4 pb-4 border-t border-emerald-500/10">
                  <div className="mt-3 max-h-[500px] overflow-y-auto">
                    <RichResultDisplay text={summaryOutput} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Task executions list */}
          {regularTasks.length === 0 ? (
            <div className="text-sm text-zinc-600 text-center py-12 border border-dashed border-jarvis-border rounded-lg">
              No task executions yet
            </div>
          ) : (
            <div className="space-y-2 mb-8">
              {regularTasks.map((task: any) => {
                const skillName = getSkillName(task.skill_id);
                const SkillIcon = Zap;
                const isExpanded = expandedTask === task.id;

                return (
                  <div key={task.id} className="border border-jarvis-border rounded-lg overflow-hidden">
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                      onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                    >
                      <SkillIcon size={14} className="text-zinc-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-zinc-200">{skillName}</span>
                        <span className="text-xs text-zinc-500 ml-2">/ {task.command_name}</span>
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${taskStatusColor(task.status)}`}>
                        {task.status}
                      </span>
                      {task.cost_usd != null && (
                        <span className="text-xs text-zinc-500 tabular-nums">${task.cost_usd.toFixed(4)}</span>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="px-4 py-3 border-t border-jarvis-border bg-jarvis-bg">
                        {/* Parameters */}
                        {task.params && typeof task.params === 'object' && Object.keys(task.params).length > 0 && (
                          <div className="mb-3">
                            <div className="text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1">PARAMETERS</div>
                            <div className="text-sm text-zinc-400 space-y-0.5">
                              {Object.entries(task.params).map(([k, v]) => (
                                <div key={k}>
                                  <span className="text-zinc-500">{k}:</span> {String(v)}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Result */}
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-xs font-medium text-jarvis-muted uppercase tracking-wider">RESULT</div>
                          {task.result?.output && (
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(task.result.output);
                                setCopiedTaskId(task.id);
                                setTimeout(() => setCopiedTaskId(null), 2000);
                              }}
                              className="flex items-center gap-1 px-2 py-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors"
                              title="Copy result to clipboard"
                            >
                              {copiedTaskId === task.id ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                              <span className="text-[10px] font-medium tracking-wider">{copiedTaskId === task.id ? 'COPIED' : 'COPY'}</span>
                            </button>
                          )}
                        </div>
                        {task.result?.document_url && (
                          <a
                            href={task.result.document_url}
                            download
                            className="inline-flex items-center gap-1.5 mb-2 px-3 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 hover:border-emerald-500/50 transition-colors text-xs font-medium"
                          >
                            <FileDown size={14} />
                            Download .md
                          </a>
                        )}
                        <div className="max-h-96 overflow-y-auto">
                          <RichResultDisplay text={task.result?.output ?? task.result?.error ?? 'No output'} />
                        </div>
                        {/* Timing */}
                        {task.started_at && (
                          <div className="mt-2 text-[10px] text-zinc-600">
                            Started: {new Date(task.started_at).toLocaleString()}
                            {task.completed_at && ` | Completed: ${new Date(task.completed_at).toLocaleString()}`}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ROUNDS tab */}
      {activeTab === 'rounds' && (
        <div className="space-y-3">
          {rounds.length === 0 ? (
            <div className="text-sm text-zinc-600 text-center py-12 border border-dashed border-jarvis-border rounded-lg">
              No rounds recorded yet
            </div>
          ) : (
            rounds.map(round => (
              <div key={round.id} className="bg-jarvis-surface border border-jarvis-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded px-2 py-0.5">
                      R{round.round_number}
                    </span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${
                      round.status === 'completed' ? 'text-emerald-400' :
                      round.status === 'rejected' ? 'text-red-400' :
                      'text-yellow-400'
                    }`}>
                      {round.status}
                    </span>
                  </div>
                  {round.grade && (
                    <span className="text-sm font-bold text-zinc-200">{round.grade}</span>
                  )}
                </div>
                {round.overall_score !== null && (
                  <div className="grid grid-cols-4 gap-3 mb-2 text-center">
                    <div><span className="text-[10px] text-zinc-500">Quality</span><br/><span className="text-sm font-semibold text-zinc-300">{round.quality_score}</span></div>
                    <div><span className="text-[10px] text-zinc-500">Completeness</span><br/><span className="text-sm font-semibold text-zinc-300">{round.completeness_score}</span></div>
                    <div><span className="text-[10px] text-zinc-500">Efficiency</span><br/><span className="text-sm font-semibold text-zinc-300">{round.efficiency_score}</span></div>
                    <div><span className="text-[10px] text-zinc-500">Overall</span><br/><span className="text-sm font-semibold text-zinc-300">{round.overall_score}</span></div>
                  </div>
                )}
                {round.ceo_review && (
                  <p className="text-xs text-zinc-400 italic border-l-2 border-white/[0.08] pl-2 mb-2">&ldquo;{round.ceo_review}&rdquo;</p>
                )}
                {round.rejection_feedback && (
                  <p className="text-xs text-red-400/80 border-l-2 border-red-500/30 pl-2">Feedback: {round.rejection_feedback}</p>
                )}
                <div className="text-[10px] text-zinc-600 mt-2 flex gap-3">
                  <span>{round.task_count} tasks</span>
                  <span>{round.tokens_used.toLocaleString()} tokens</span>
                  <span>${round.cost_usd.toFixed(4)}</span>
                  {round.started_at && <span>{new Date(round.started_at).toLocaleString()}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ACTIVITY tab */}
      {activeTab === 'activity' && (
        <div className="space-y-1">
          {activityLog.length === 0 ? (
            <div className="text-sm text-zinc-600 text-center py-12 border border-dashed border-jarvis-border rounded-lg">
              No activity recorded
            </div>
          ) : (
            activityLog.map(log => (
              <div key={log.id} className="flex items-start gap-3 px-3 py-2 hover:bg-white/[0.01] rounded transition-colors">
                <span className={`text-[9px] font-bold uppercase tracking-wider w-14 shrink-0 mt-0.5 ${
                  log.severity === 'error' ? 'text-red-400' :
                  log.severity === 'warning' ? 'text-yellow-400' :
                  'text-zinc-500'
                }`}>
                  {log.severity}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-zinc-300">{log.action}</span>
                  {log.details && <p className="text-xs text-zinc-500 truncate">{log.details}</p>}
                </div>
                <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">
                  {new Date(log.timestamp).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Reject & Redo modal */}
      {showRejectModal && mission && (
        <RejectMissionModal
          missionId={mission.id}
          missionTitle={mission.title}
          currentRound={mission.current_round}
          onReject={async (feedback, strategy) => {
            const { rejectAndRedoMission } = await import('../../lib/taskDispatcher');
            await rejectAndRedoMission(mission.id, { feedback, strategy });
            setShowRejectModal(false);
          }}
          onClose={() => setShowRejectModal(false)}
        />
      )}
    </div>
  );
}
