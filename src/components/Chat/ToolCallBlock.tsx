import { Zap } from 'lucide-react';
import { skills as skillDefinitions } from '../../data/skillDefinitions';
import { parseTaskPlan, stripTaskBlocks } from '../../lib/taskDispatcher';

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** Parse tool_call blocks from LLM response text and return segments */
export function parseToolCalls(text: string): Array<{ type: 'text'; content: string } | { type: 'tool_call'; call: ToolCall }> {
  const segments: Array<{ type: 'text'; content: string } | { type: 'tool_call'; call: ToolCall }> = [];
  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before this tool_call
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: 'text', content: before });
    }

    // Parse the tool_call JSON
    try {
      const call = JSON.parse(match[1]) as ToolCall;
      segments.push({ type: 'tool_call', call });
    } catch {
      // Couldn't parse — show raw
      segments.push({ type: 'text', content: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last tool_call
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) segments.push({ type: 'text', content: remaining });
  }

  // If no tool_calls found, return original text
  if (segments.length === 0 && text.trim()) {
    segments.push({ type: 'text', content: text });
  }

  return segments;
}

/** Retro-styled inline tool call block */
export function ToolCallCard({ call }: { call: ToolCall }) {
  const skill = skillDefinitions.find(s => s.id === call.name);
  const SkillIcon = skill?.icon ?? Zap;
  const displayName = skill?.name ?? call.name;

  // Format arguments for display
  const argEntries = Object.entries(call.arguments ?? {}).filter(
    ([, v]) => v !== null && v !== undefined,
  );

  return (
    <div className="my-2 rounded-lg border border-cyan-400/30 bg-cyan-400/[0.04] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-cyan-400/20 bg-cyan-400/[0.06]">
        <Zap size={10} className="text-cyan-400" />
        <span className="font-pixel text-[9px] tracking-widest text-cyan-300">
          EXECUTING SKILL
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
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mt-1 flex-shrink-0" />
      </div>
    </div>
  );
}

/** Render message text with inline tool call or task plan blocks */
export default function RichMessageContent({ text }: { text: string }) {
  // Check for task_plan blocks first
  const missions = parseTaskPlan(text);
  if (missions.length > 0) {
    const cleanText = stripTaskBlocks(text);
    // TaskPlanBlock needs mission IDs — loaded from DB in parent (ChatThread)
    // For now, show the missions as enhanced tool cards grouped by mission
    return (
      <>
        {cleanText && <span>{cleanText}</span>}
        {missions.map((m, i) => (
          <div key={i} className="my-2">
            {m.toolCalls.map((call, j) => (
              <ToolCallCard key={j} call={call} />
            ))}
          </div>
        ))}
      </>
    );
  }

  // Fallback to individual tool_call parsing
  const segments = parseToolCalls(text);

  // If no tool calls, just render plain text
  if (segments.length === 1 && segments[0].type === 'text') {
    return <>{text}</>;
  }

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <span key={i}>{seg.content}</span>
        ) : (
          <ToolCallCard key={i} call={seg.call} />
        ),
      )}
    </>
  );
}
