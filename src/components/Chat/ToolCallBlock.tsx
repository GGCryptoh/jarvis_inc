import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Check, AlertTriangle, ShieldAlert } from 'lucide-react';
import { getSkillById, getSkillName } from '../../lib/skillsCache';
import { parseTaskPlan, stripTaskBlocks } from '../../lib/taskDispatcher';
import RichResultCard, { detectRichContent } from './RichResultCard';

// ---------------------------------------------------------------------------
// Lightweight markdown renderer (bold, italic, code, bullets, ordered lists)
// ---------------------------------------------------------------------------

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Match: **bold**, *italic*, `code`, [link](url)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\))/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    if (match[2]) {
      parts.push(<strong key={key++} className="font-bold text-zinc-100">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={key++} className="italic text-zinc-200">{match[3]}</em>);
    } else if (match[4]) {
      parts.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-zinc-700/60 text-emerald-300 text-[9px]">
          {match[4]}
        </code>
      );
    } else if (match[5] && match[6]) {
      parts.push(
        <a key={key++} href={match[6]} target="_blank" rel="noopener noreferrer" className="text-emerald-400 underline hover:text-emerald-300">
          {match[5]}
        </a>
      );
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length > 0 ? parts : [text];
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={`hr-${i}`} className="border-zinc-700 my-2" />);
      i++;
      continue;
    }

    // Table: detect header row + separator row (|---|---|)
    if (line.includes('|') && i + 1 < lines.length && /^\|[\s-:|]+\|$/.test(lines[i + 1].trim())) {
      const headerCells = line.split('|').filter(c => c.trim()).map(c => c.trim());
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].split('|').filter(c => c.trim()).map(c => c.trim()));
        i++;
      }
      elements.push(
        <div key={`tbl-${i}`} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-[inherit]">
            <thead>
              <tr>
                {headerCells.map((h, ci) => (
                  <th key={ci} className="text-left px-2 py-1 text-zinc-200 font-semibold border-b border-zinc-600">
                    {renderInlineMarkdown(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2 py-1 border-b border-zinc-800/50">
                      {renderInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ''));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="list-decimal list-inside space-y-0.5 my-1 ml-1">
          {items.map((item, j) => <li key={j}>{renderInlineMarkdown(item)}</li>)}
        </ol>
      );
      continue;
    }

    // Unordered list
    if (/^[-•*]\s/.test(line) && !/^\*\*/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-•*]\s/.test(lines[i]) && !/^\*\*/.test(lines[i])) {
        items.push(lines[i].replace(/^[-•*]\s/, ''));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="list-disc list-inside space-y-0.5 my-1 ml-1">
          {items.map((item, j) => <li key={j}>{renderInlineMarkdown(item)}</li>)}
        </ul>
      );
      continue;
    }

    // Heading
    if (/^#{1,3}\s/.test(line)) {
      const content = line.replace(/^#{1,3}\s/, '');
      elements.push(
        <div key={`h-${i}`} className="font-bold text-zinc-100 mt-1.5 mb-0.5">
          {renderInlineMarkdown(content)}
        </div>
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={`br-${i}`} className="h-1" />);
      i++;
      continue;
    }

    // Normal text
    elements.push(<div key={`p-${i}`}>{renderInlineMarkdown(line)}</div>);
    i++;
  }

  return <>{elements}</>;
}

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** Parse tool_call and work_request blocks from LLM response text and return segments */
export function parseToolCalls(text: string): Array<{ type: 'text'; content: string } | { type: 'tool_call'; call: ToolCall }> {
  const segments: Array<{ type: 'text'; content: string } | { type: 'tool_call'; call: ToolCall }> = [];
  // Match both <tool_call> and <work_request> blocks
  const regex = /<(?:tool_call|work_request)>\s*([\s\S]*?)\s*<\/(?:tool_call|work_request)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before this block
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: 'text', content: before });
    }

    // Parse the JSON — work_request uses skill_id/command/arguments format, normalize to tool_call shape
    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown>;
      const call: ToolCall = {
        name: (parsed.name ?? parsed.skill_id) as string,
        arguments: (parsed.arguments ?? {}) as Record<string, unknown>,
      };
      // If work_request has a top-level command, include it in arguments
      if (parsed.command && !call.arguments.command) {
        call.arguments = { command: parsed.command, ...call.arguments };
      }
      segments.push({ type: 'tool_call', call });
    } catch {
      // Couldn't parse — show raw
      segments.push({ type: 'text', content: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last block
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) segments.push({ type: 'text', content: remaining });
  }

  // If no blocks found, return original text
  if (segments.length === 0 && text.trim()) {
    segments.push({ type: 'text', content: text });
  }

  return segments;
}

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Look up latest task_execution matching this skill_id (optionally scoped to a mission) */
async function fetchTaskStatus(skillId: string, missionId?: string): Promise<TaskStatus | null> {
  try {
    const { getSupabase } = await import('../../lib/supabase');
    let query = getSupabase()
      .from('task_executions')
      .select('status')
      .eq('skill_id', skillId);
    if (missionId) query = query.eq('mission_id', missionId);
    const { data } = await query
      .order('created_at', { ascending: false })
      .limit(1);
    if (data && data.length > 0) return data[0].status as TaskStatus;
  } catch { /* ignore */ }
  return null;
}

const STATUS_CONFIG = {
  pending: { label: 'EXECUTING SKILL', borderColor: 'border-cyan-400/30', bgColor: 'bg-cyan-400/[0.04]', headerBg: 'bg-cyan-400/[0.06]', headerBorder: 'border-cyan-400/20', textColor: 'text-cyan-300', iconColor: 'text-cyan-400' },
  running: { label: 'EXECUTING SKILL', borderColor: 'border-cyan-400/30', bgColor: 'bg-cyan-400/[0.04]', headerBg: 'bg-cyan-400/[0.06]', headerBorder: 'border-cyan-400/20', textColor: 'text-cyan-300', iconColor: 'text-cyan-400' },
  completed: { label: 'SKILL COMPLETE', borderColor: 'border-emerald-400/30', bgColor: 'bg-emerald-400/[0.04]', headerBg: 'bg-emerald-400/[0.06]', headerBorder: 'border-emerald-400/20', textColor: 'text-emerald-300', iconColor: 'text-emerald-400' },
  failed: { label: 'SKILL FAILED', borderColor: 'border-red-400/30', bgColor: 'bg-red-400/[0.04]', headerBg: 'bg-red-400/[0.06]', headerBorder: 'border-red-400/20', textColor: 'text-red-300', iconColor: 'text-red-400' },
} as const;

/** Retro-styled inline tool call block with live status */
export function ToolCallCard({ call, missionId }: { call: ToolCall; missionId?: string }) {
  const skill = getSkillById(call.name);
  const SkillIcon = Zap;
  const displayName = skill?.name ?? call.name;
  const [status, setStatus] = useState<TaskStatus>('pending');

  // Poll for status on mount + listen for changes
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const s = await fetchTaskStatus(call.name, missionId);
      if (!cancelled && s) setStatus(s);
    };
    check();
    window.addEventListener('task-executions-changed', check);
    // Also poll every 3s as fallback (stop when terminal)
    const interval = setInterval(() => {
      if (status === 'completed' || status === 'failed') return;
      check();
    }, 3000);
    return () => {
      cancelled = true;
      window.removeEventListener('task-executions-changed', check);
      clearInterval(interval);
    };
  }, [call.name, missionId]);

  // Stop polling once terminal
  const isTerminal = status === 'completed' || status === 'failed';
  const cfg = STATUS_CONFIG[status];

  // Format arguments for display
  const argEntries = Object.entries(call.arguments ?? {}).filter(
    ([, v]) => v !== null && v !== undefined,
  );

  return (
    <div className={`my-2 rounded-lg border ${cfg.borderColor} ${cfg.bgColor} overflow-hidden transition-colors duration-500`}>
      <div className={`flex items-center gap-2 px-3 py-1.5 border-b ${cfg.headerBorder} ${cfg.headerBg} transition-colors duration-500`}>
        {status === 'completed' ? (
          <Check size={10} className={cfg.iconColor} />
        ) : status === 'failed' ? (
          <AlertTriangle size={10} className={cfg.iconColor} />
        ) : (
          <Zap size={10} className={cfg.iconColor} />
        )}
        <span className={`font-pixel text-[9px] tracking-widest ${cfg.textColor} transition-colors duration-500`}>
          {cfg.label}
        </span>
      </div>
      <div className="px-3 py-2 flex items-start gap-2">
        <SkillIcon size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="font-pixel text-[10px] tracking-wider text-zinc-200">
            {displayName}
          </div>
          {argEntries.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {argEntries.map(([key, val]) => (
                <div key={key} className="font-pixel text-[9px] tracking-wider text-zinc-500">
                  <span className="text-zinc-400">{key}:</span>{' '}
                  <span className="text-zinc-300">
                    {typeof val === 'string' ? val : JSON.stringify(val)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {!isTerminal ? (
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mt-1 flex-shrink-0" />
        ) : status === 'completed' ? (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 flex-shrink-0" />
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1 flex-shrink-0" />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rich text rendering: strips detected URLs from text, renders them as cards
// ---------------------------------------------------------------------------

/**
 * Render a text segment: scan for rich content (images, links, documents,
 * collateral) and render them as RichResultCard components alongside the
 * remaining plain text.
 */
function TextWithRichContent({ content }: { content: string }) {
  const detected = detectRichContent(content);

  // No rich content — render as markdown
  if (detected.length === 0) {
    return <MarkdownText text={content} />;
  }

  // Build output: strip detected URLs from text, then append rich cards
  let remaining = content;
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
      {remaining && <MarkdownText text={remaining} />}
      {detected.map((item, i) => (
        <RichResultCard key={`rich-${i}`} item={item} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Action buttons for mission_complete / skill_result messages
// ---------------------------------------------------------------------------

interface ActionDef {
  id: string;
  label: string;
  action: string;
  target?: string;
  text?: string;
}

function ActionButtons({ actions, missionId, messageId, persistedActed }: { actions: ActionDef[]; missionId?: string; messageId?: string; persistedActed?: string }) {
  const navigate = useNavigate();
  // Initialize from DB metadata or localStorage
  const [acted, setActed] = useState<string | null>(() => {
    if (persistedActed) return persistedActed;
    if (messageId) {
      const saved = localStorage.getItem(`jarvis_msg_acted_${messageId}`);
      if (saved) return saved;
    }
    return null;
  });
  // Track the action type of the acted button so auto_submit doesn't disable others
  const [actedType, setActedType] = useState<string | null>(() => {
    if (persistedActed) {
      const found = actions.find(a => a.id === persistedActed);
      return found?.action ?? null;
    }
    if (messageId) {
      const saved = localStorage.getItem(`jarvis_msg_acted_${messageId}`);
      if (saved) {
        const found = actions.find(a => a.id === saved);
        return found?.action ?? null;
      }
    }
    return null;
  });

  const handleAction = async (action: ActionDef) => {
    // For auto_submit, only block if this specific button was already clicked
    // For other actions, block if any non-auto_submit action was taken
    if (acted && actedType !== 'auto_submit') return;
    if (acted && actedType === 'auto_submit' && action.action === 'auto_submit') return;

    setActed(action.id);
    setActedType(action.action);

    // Persist to localStorage so it survives navigation
    if (messageId) {
      localStorage.setItem(`jarvis_msg_acted_${messageId}`, action.id);
    }

    if (action.action === 'auto_submit' && action.text) {
      // Dispatch event for ChatThread to auto-submit this text as a user message
      window.dispatchEvent(new CustomEvent('chat-auto-submit', { detail: { text: action.text } }));
      // Persist acted state
      if (messageId) {
        try {
          const { getSupabase } = await import('../../lib/supabase');
          const { data: msg } = await getSupabase().from('chat_messages').select('metadata').eq('id', messageId).single();
          const meta = (msg?.metadata as Record<string, unknown>) ?? {};
          await getSupabase().from('chat_messages').update({
            metadata: { ...meta, acted_on: action.id },
          }).eq('id', messageId);
        } catch { /* ignore */ }
      }
      return;
    }

    if (action.action === 'approve_mission' && missionId) {
      try {
        const { getSupabase } = await import('../../lib/supabase');
        await getSupabase().from('missions').update({ status: 'done' }).eq('id', missionId);
        // Also update the chat message metadata to persist acted state
        if (messageId) {
          const { data: msg } = await getSupabase().from('chat_messages').select('metadata').eq('id', messageId).single();
          const meta = (msg?.metadata as Record<string, unknown>) ?? {};
          await getSupabase().from('chat_messages').update({
            metadata: { ...meta, acted_on: action.id },
          }).eq('id', messageId);
        }
        const { logAudit } = await import('../../lib/database');
        await logAudit('Founder', 'MISSION_APPROVED', 'Quick-approved mission from chat', 'info');
        window.dispatchEvent(new Event('missions-changed'));
        // Dismiss any related CEO action queue entries for this mission
        try {
          const sb = (await import('../../lib/supabase')).getSupabase();
          await sb.from('ceo_action_queue')
            .update({ status: 'dismissed' })
            .eq('status', 'pending')
            .contains('payload', { mission_id: missionId });
          window.dispatchEvent(new Event('ceo-actions-changed'));
        } catch { /* ignore */ }
      } catch (e) {
        console.error('Failed to approve mission:', e);
      }
    } else if (action.action === 'navigate' && action.target) {
      navigate(action.target);
    }
  };

  // Determine if a button should be disabled:
  // - auto_submit acted: only disable the auto_submit button itself, leave others clickable
  // - other action acted: disable all other buttons (original behavior)
  const isDisabled = (action: ActionDef): boolean => {
    if (!acted) return false;
    if (acted === action.id) return true; // already clicked this one
    if (actedType === 'auto_submit') return action.action === 'auto_submit'; // only disable other auto_submits
    return true; // non-auto_submit acted: disable everything else
  };

  return (
    <div className="flex items-center gap-2 mt-3">
      {actions.map(action => (
        <button
          key={action.id}
          onClick={() => handleAction(action)}
          disabled={isDisabled(action)}
          className={[
            'font-pixel text-[9px] tracking-wider px-3 py-2 rounded-md border transition-colors flex items-center gap-1.5',
            acted === action.id
              ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-400'
              : isDisabled(action)
                ? 'border-zinc-700 bg-zinc-800/50 text-zinc-600 cursor-not-allowed'
                : action.action === 'auto_submit'
                  ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20'
                  : action.action === 'approve_mission'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                    : 'border-zinc-600 bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200',
          ].join(' ')}
        >
          {acted === action.id && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
          {action.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill approval card for live chat (CEO requested enabling a skill)
// ---------------------------------------------------------------------------

function ChatSkillApproval({ approvalId, skillId, skillName, connectionType, riskLevel = 'safe' }: {
  approvalId: string; skillId: string; skillName: string; connectionType?: string; riskLevel?: string;
}) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'skipped'>('pending');
  const [confirmText, setConfirmText] = useState('');
  const skillDef = getSkillById(skillId);
  const SkillIcon = Zap;
  const isDangerous = riskLevel === 'dangerous';
  const isModerate = riskLevel === 'moderate';
  const dangerConfirmed = confirmText.toUpperCase() === 'ENABLE';

  // Check if already approved on mount
  useEffect(() => {
    (async () => {
      try {
        const { getSupabase } = await import('../../lib/supabase');
        const { data } = await getSupabase().from('approvals').select('status').eq('id', approvalId).single();
        if (data?.status === 'approved') setStatus('approved');
        else if (data?.status === 'rejected') setStatus('skipped');
      } catch { /* ignore */ }
    })();
  }, [approvalId]);

  const handleApprove = async () => {
    try {
      const { getSupabase } = await import('../../lib/supabase');
      // Update approval
      await getSupabase().from('approvals').update({ status: 'approved' }).eq('id', approvalId);
      // Enable the skill
      await getSupabase().from('skills').update({ enabled: true }).eq('id', skillId);
      window.dispatchEvent(new Event('approvals-changed'));
      window.dispatchEvent(new Event('skills-changed'));
      window.dispatchEvent(new CustomEvent('skill-approved-in-chat', {
        detail: { skillId, skillName },
      }));
      setStatus('approved');
    } catch (e) {
      console.error('Failed to approve skill:', e);
    }
  };

  const handleSkip = async () => {
    try {
      const { getSupabase } = await import('../../lib/supabase');
      await getSupabase().from('approvals').update({ status: 'rejected' }).eq('id', approvalId);
      window.dispatchEvent(new Event('approvals-changed'));
      setStatus('skipped');
    } catch { /* ignore */ }
  };

  const borderColor = isDangerous ? 'border-red-400/30' : isModerate ? 'border-amber-400/30' : 'border-yellow-400/30';
  const bgColor = isDangerous ? 'bg-red-400/[0.04]' : isModerate ? 'bg-amber-400/[0.04]' : 'bg-yellow-400/[0.04]';
  const headerBg = isDangerous ? 'bg-red-400/[0.06]' : isModerate ? 'bg-amber-400/[0.06]' : 'bg-yellow-400/[0.06]';
  const headerBorder = isDangerous ? 'border-red-400/20' : isModerate ? 'border-amber-400/20' : 'border-yellow-400/20';
  const headerText = isDangerous ? 'text-red-300' : isModerate ? 'text-amber-300' : 'text-yellow-300';

  return (
    <div className={`mt-3 rounded-lg border ${borderColor} ${bgColor} overflow-hidden`}>
      <div className={`px-3 py-2 border-b ${headerBorder} ${headerBg}`}>
        <div className={`font-pixel text-[10px] tracking-widest ${headerText}`}>
          {isDangerous ? '\u26A0' : '\u265B'} ENABLE SKILL
        </div>
      </div>

      <div className="px-3 py-3 flex items-start gap-2.5">
        <SkillIcon size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-pixel text-[10px] tracking-wider text-zinc-200">
            {skillName}
          </div>
          {skillDef && (
            <div className="font-pixel text-[9px] tracking-wider text-zinc-500 mt-0.5">
              {connectionType === 'cli' ? 'CLI tool — no API key needed' : 'API skill'}
            </div>
          )}
        </div>
      </div>

      {/* Risk warning banners */}
      {status === 'pending' && isModerate && (
        <div className="mx-3 mb-2 px-2.5 py-2 rounded bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
          <AlertTriangle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <span className="font-pixel text-[9px] tracking-wider text-amber-300/90 leading-relaxed">
            This skill accesses external CLI tools on the host system.
          </span>
        </div>
      )}
      {status === 'pending' && isDangerous && (
        <div className="mx-3 mb-2 space-y-2">
          <div className="px-2.5 py-2 rounded bg-red-500/10 border border-red-500/25 flex items-start gap-2">
            <ShieldAlert size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
            <span className="font-pixel text-[9px] tracking-wider text-red-300/90 leading-relaxed">
              This skill grants system-level access (bash, shell, sudo). Only enable if you trust the execution environment.
            </span>
          </div>
          <input
            type="text"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder='Type ENABLE to confirm'
            className="w-full bg-zinc-900/60 border border-red-500/30 rounded px-2.5 py-1.5 font-pixel text-[9px] tracking-wider text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-red-400/50"
          />
        </div>
      )}

      {status === 'pending' && (
        <div className={`flex items-center justify-between px-3 py-2.5 border-t ${headerBorder} ${isDangerous ? 'bg-red-400/[0.03]' : isModerate ? 'bg-amber-400/[0.03]' : 'bg-yellow-400/[0.03]'}`}>
          <button
            onClick={handleSkip}
            className="font-pixel text-[9px] tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            LATER
          </button>
          <button
            onClick={handleApprove}
            disabled={isDangerous && !dangerConfirmed}
            className="font-pixel text-[9px] tracking-widest px-4 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            APPROVE
          </button>
        </div>
      )}

      {status === 'approved' && (
        <div className="flex items-center justify-center px-3 py-2 border-t border-emerald-500/20 bg-emerald-500/[0.04]">
          <span className="font-pixel text-[10px] tracking-wider text-emerald-400">
            {'\u2713'} ENABLED
          </span>
        </div>
      )}

      {status === 'skipped' && (
        <div className="flex items-center justify-center px-3 py-2 border-t border-zinc-700 bg-zinc-800/30">
          <span className="font-pixel text-[9px] tracking-wider text-zinc-500">
            SKIPPED
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline cards for CEO management action metadata types
// ---------------------------------------------------------------------------

/** Inline card for agent hire events */
function AgentHiredCard({ metadata }: { metadata: Record<string, unknown> }) {
  // Support both naming conventions (agent_color vs color)
  const agentColor = (metadata.agent_color ?? metadata.color ?? '#50fa7b') as string;
  const agentSkin = (metadata.agent_skin_tone ?? metadata.skinTone ?? '#ffcc99') as string;
  const agentName = (metadata.agent_name ?? metadata.name ?? 'AGENT') as string;
  const agentRole = (metadata.agent_role ?? metadata.role ?? '') as string;
  const agentModel = (metadata.agent_model ?? metadata.model ?? '') as string;
  const skills = (metadata.skills as string[]) ?? [];

  return (
    <div className="retro-inset p-2 my-2">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          {/* Mini sprite preview */}
          <div className="w-[28px]">
            <div className="mx-auto w-[18px] h-[7px] rounded-t-sm" style={{ backgroundColor: agentColor }} />
            <div className="mx-auto w-[18px] h-[14px] rounded-sm" style={{ backgroundColor: agentSkin }} />
            <div className="mx-auto w-[18px] h-[16px] rounded-sm" style={{ backgroundColor: agentColor }} />
          </div>
        </div>
        <div className="flex-1">
          <div className="font-pixel text-[7px] text-pixel-green tracking-wider mb-0.5">AGENT HIRED</div>
          <div className="font-pixel text-[10px] tracking-wider" style={{ color: agentColor }}>
            {agentName}
          </div>
          {(agentRole || agentModel) && (
            <div className="font-pixel text-[6px] text-gray-400 tracking-wider">
              {[agentRole, agentModel].filter(Boolean).join(' — ')}
            </div>
          )}
          {skills.length > 0 && (
            <div className="font-pixel text-[5px] text-pixel-cyan tracking-wider mt-0.5">
              SKILLS: {skills.join(', ')}
            </div>
          )}
        </div>
      </div>
      <a
        href="/surveillance"
        className="block mt-2 text-center font-pixel text-[8px] tracking-widest py-1.5 border border-pixel-cyan/30 text-pixel-cyan hover:bg-pixel-cyan/10 transition-colors rounded-sm"
        onClick={(e) => {
          e.preventDefault();
          window.location.href = '/surveillance';
        }}
      >
        GO MEET THEM →
      </a>
    </div>
  );
}

/** Inline card for agent fired events */
function AgentFiredCard({ metadata }: { metadata: Record<string, unknown> }) {
  return (
    <div className="retro-inset p-2 my-2 border-l-2 border-red-500/50">
      <div className="font-pixel text-[7px] text-red-400 tracking-wider mb-0.5">AGENT DISMISSED</div>
      <div className="font-pixel text-[9px] text-gray-300 tracking-wider">{metadata.agent_name as string}</div>
      <div className="font-pixel text-[6px] text-gray-500 tracking-wider">{metadata.reason as string}</div>
    </div>
  );
}

/** Inline card for mission creation/schedule/recurring events */
function MissionCard({ metadata }: { metadata: Record<string, unknown> }) {
  const typeLabels: Record<string, { label: string; color: string }> = {
    mission_created: { label: 'MISSION CREATED', color: 'text-pixel-green' },
    mission_scheduled: { label: 'MISSION SCHEDULED', color: 'text-pixel-cyan' },
    mission_recurring: { label: 'RECURRING MISSION', color: 'text-pixel-cyan' },
    mission_cancelled: { label: 'MISSION CANCELLED', color: 'text-red-400' },
    mission_updated: { label: 'MISSION UPDATED', color: 'text-pixel-orange' },
    mission_activated: { label: 'MISSION ACTIVATED', color: 'text-pixel-green' },
  };
  const info = typeLabels[metadata.type as string] ?? { label: 'MISSION', color: 'text-gray-400' };

  return (
    <div className="retro-inset p-2 my-2">
      <div className={`font-pixel text-[7px] ${info.color} tracking-wider mb-0.5`}>{info.label}</div>
      {!!metadata.title && (
        <div className="font-pixel text-[9px] text-gray-200 tracking-wider">{String(metadata.title)}</div>
      )}
      {!!metadata.scheduled_for && (
        <div className="font-pixel text-[6px] text-pixel-cyan tracking-wider mt-0.5">
          SCHEDULED: {new Date(metadata.scheduled_for as string).toLocaleString()}
        </div>
      )}
      {!!metadata.cron && (
        <div className="font-pixel text-[6px] text-pixel-cyan tracking-wider mt-0.5">
          CRON: {String(metadata.cron)} ({(metadata.recurring_mode as string) ?? 'auto'})
        </div>
      )}
      {!!metadata.reason && (
        <div className="font-pixel text-[6px] text-gray-500 tracking-wider mt-0.5">{String(metadata.reason)}</div>
      )}
    </div>
  );
}

/** Inline card for budget extension requests */
function BudgetRequestCard({ metadata }: { metadata: Record<string, unknown> }) {
  return (
    <div className="retro-inset p-2 my-2 border-l-2 border-pixel-yellow/50">
      <div className="font-pixel text-[7px] text-pixel-yellow tracking-wider mb-0.5">BUDGET EXTENSION REQUEST</div>
      <div className="font-pixel text-[10px] text-pixel-green tracking-wider">
        +${metadata.amount as number}
      </div>
      <div className="font-pixel text-[6px] text-gray-400 tracking-wider mt-0.5">{metadata.reason as string}</div>
    </div>
  );
}

/** Inline card for skill creation events */
function SkillCreatedCard({ metadata }: { metadata: Record<string, unknown> }) {
  const skillType = (metadata.skill_type as string) ?? 'llm';
  const typeBadge = {
    code: { label: 'CODE', color: 'text-cyan-400 bg-cyan-500/15' },
    llm: { label: 'LLM', color: 'text-purple-400 bg-purple-500/15' },
    api: { label: 'API', color: 'text-amber-400 bg-amber-500/15' },
  };
  const badge = typeBadge[skillType as keyof typeof typeBadge] ?? typeBadge.llm;

  return (
    <div className="retro-inset p-2 my-2">
      <div className="flex items-center gap-2 mb-1">
        <div className="font-pixel text-[7px] text-pixel-green tracking-wider">SKILL CREATED</div>
        <span className={`font-pixel text-[6px] tracking-widest px-1.5 py-0.5 rounded ${badge.color}`}>{badge.label}</span>
        <span className="font-pixel text-[6px] tracking-widest px-1.5 py-0.5 rounded text-emerald-400 bg-emerald-500/15">PERSONAL</span>
      </div>
      <div className="font-pixel text-[10px] tracking-wider text-zinc-200">{metadata.skill_name as string}</div>
      {!!metadata.skill_category && (
        <div className="font-pixel text-[6px] text-zinc-500 tracking-wider mt-0.5">{String(metadata.skill_category).toUpperCase()}</div>
      )}
      <a
        href="/skills"
        className="block mt-2 text-center font-pixel text-[8px] tracking-widest py-1.5 border border-pixel-cyan/30 text-pixel-cyan hover:bg-pixel-cyan/10 transition-colors rounded-sm"
        onClick={(e) => { e.preventDefault(); window.location.href = '/skills'; }}
      >
        VIEW IN SKILLS →
      </a>
    </div>
  );
}

/** Render message text with inline tool call or task plan blocks + rich content + action buttons */
export default function RichMessageContent({ text, metadata, messageId }: { text: string; metadata?: Record<string, unknown> | null; messageId?: string }) {
  const actions = (metadata?.actions as ActionDef[] | undefined) ?? [];
  const missionId = metadata?.mission_id as string | undefined;
  // Check if already acted (from DB metadata)
  const persistedActed = metadata?.acted_on as string | undefined;

  let content: React.ReactNode;

  // Check for task_plan blocks first
  const missions = parseTaskPlan(text);
  if (missions.length > 0) {
    const cleanText = stripTaskBlocks(text);
    // Filter out enable_skill calls (handled by ChatSkillApproval)
    const visibleMissions = missions.map(m => ({
      ...m,
      toolCalls: m.toolCalls.filter(tc => tc.name !== 'enable_skill'),
    })).filter(m => m.toolCalls.length > 0);

    content = (
      <>
        {cleanText && <TextWithRichContent content={cleanText} />}
        {visibleMissions.map((m, i) => (
          <div key={i} className="my-2">
            {m.toolCalls.map((call, j) => (
              <ToolCallCard key={j} call={call} missionId={missionId} />
            ))}
          </div>
        ))}
      </>
    );
  } else {
    // Fallback to individual tool_call parsing
    const segments = parseToolCalls(text);
    // Filter out enable_skill calls (handled by ChatSkillApproval)
    const visibleSegments = segments.filter(seg => seg.type === 'text' || seg.call.name !== 'enable_skill');

    if (visibleSegments.length === 1 && visibleSegments[0].type === 'text') {
      content = <TextWithRichContent content={text} />;
    } else {
      content = (
        <>
          {visibleSegments.map((seg, i) =>
            seg.type === 'text' ? (
              <TextWithRichContent key={i} content={seg.content} />
            ) : (
              <ToolCallCard key={i} call={seg.call} missionId={missionId} />
            ),
          )}
        </>
      );
    }
  }

  // Skill approval card
  const isSkillApproval = metadata?.type === 'skill_approval';
  const approvalId = metadata?.approval_id as string | undefined;
  const approvalSkillId = metadata?.skill_id as string | undefined;
  const approvalSkillName = metadata?.skill_name as string | undefined;
  const approvalConnType = metadata?.connection_type as string | undefined;
  const approvalRiskLevel = metadata?.risk_level as string | undefined;

  return (
    <>
      {content}
      {isSkillApproval && approvalId && approvalSkillId && (
        <ChatSkillApproval
          approvalId={approvalId}
          skillId={approvalSkillId}
          skillName={approvalSkillName ?? approvalSkillId}
          connectionType={approvalConnType}
          riskLevel={approvalRiskLevel}
        />
      )}
      {metadata?.type === 'agent_hired' && <AgentHiredCard metadata={metadata} />}
      {metadata?.type === 'agent_fired' && <AgentFiredCard metadata={metadata} />}
      {metadata?.type === 'budget_request' && <BudgetRequestCard metadata={metadata} />}
      {metadata?.type === 'skill_created' && metadata && <SkillCreatedCard metadata={metadata} />}
      {(['mission_created', 'mission_scheduled', 'mission_recurring', 'mission_cancelled', 'mission_updated', 'mission_activated'] as string[]).includes(metadata?.type as string) && metadata && <MissionCard metadata={metadata} />}
      {actions.length > 0 && <ActionButtons actions={actions} missionId={missionId} messageId={messageId} persistedActed={persistedActed} />}
    </>
  );
}
