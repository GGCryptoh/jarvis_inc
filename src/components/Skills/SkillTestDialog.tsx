import { useState, useMemo, useCallback } from 'react';
import { X, Play, Eye, Loader2, AlertTriangle, ChevronDown } from 'lucide-react';
import type { FullSkillDefinition, SkillCommand } from '../../lib/skillResolver';
import { executeSkill, buildSkillPrompt } from '../../lib/skillExecutor';

interface SkillTestDialogProps {
  skill: FullSkillDefinition;
  open: boolean;
  onClose: () => void;
}

export default function SkillTestDialog({ skill, open, onClose }: SkillTestDialogProps) {
  const commands = useMemo(() => skill.commands ?? [], [skill.commands]);
  const [selectedCommand, setSelectedCommand] = useState<string>(commands[0]?.name ?? '');
  const [params, setParams] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'dry_run' | 'executed'>('idle');

  const activeCommand: SkillCommand | undefined = useMemo(
    () => commands.find(c => c.name === selectedCommand),
    [commands, selectedCommand],
  );

  const handleCommandChange = useCallback((name: string) => {
    setSelectedCommand(name);
    setParams({});
    setResult(null);
    setError(null);
    setMode('idle');
  }, []);

  const handleParamChange = useCallback((paramName: string, value: string) => {
    setParams(prev => ({ ...prev, [paramName]: value }));
  }, []);

  const buildParams = useCallback((): Record<string, unknown> => {
    const built: Record<string, unknown> = {};
    if (!activeCommand) return built;
    for (const p of activeCommand.parameters) {
      const val = params[p.name];
      if (val !== undefined && val !== '') {
        if (p.type === 'number') {
          built[p.name] = Number(val);
        } else if (p.type === 'object' || p.type === 'array') {
          try { built[p.name] = JSON.parse(val); } catch { built[p.name] = val; }
        } else {
          built[p.name] = val;
        }
      } else if (p.default !== undefined) {
        built[p.name] = p.default;
      }
    }
    return built;
  }, [activeCommand, params]);

  const handleDryRun = useCallback(() => {
    const prompt = buildSkillPrompt(skill, selectedCommand, buildParams());
    setResult(prompt);
    setError(null);
    setMode('dry_run');
  }, [skill, selectedCommand, buildParams]);

  const handleExecute = useCallback(async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    setMode('idle');

    try {
      const execResult = await executeSkill(skill.id, selectedCommand, buildParams());
      if (execResult.success) {
        setResult(
          `${execResult.output}\n\n---\nTokens: ~${execResult.tokens_used} | Cost: $${execResult.cost_usd.toFixed(4)} | Duration: ${execResult.duration_ms}ms`,
        );
        setMode('executed');
      } else {
        setError(execResult.error ?? 'Unknown error');
        setMode('executed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMode('executed');
    } finally {
      setLoading(false);
    }
  }, [skill.id, selectedCommand, buildParams]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        <div className="bg-jarvis-surface border border-jarvis-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-jarvis-border bg-jarvis-bg/50">
            <div>
              <h2 className="font-pixel text-[11px] tracking-wider text-emerald-400">
                TEST SKILL
              </h2>
              <p className="font-pixel text-[8px] tracking-wider text-zinc-400 mt-1">
                {skill.name} — {skill.description}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded border border-zinc-700 hover:border-red-500/50 hover:bg-red-500/10 text-zinc-400 hover:text-red-400 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Command Selector */}
            {commands.length > 0 ? (
              <div>
                <label className="block font-pixel text-[7px] tracking-wider text-zinc-500 mb-1.5">
                  COMMAND
                </label>
                <div className="relative">
                  <select
                    value={selectedCommand}
                    onChange={e => handleCommandChange(e.target.value)}
                    className="appearance-none w-full font-pixel text-[8px] tracking-wider bg-zinc-900 border border-zinc-700 rounded px-3 py-2 pr-6 text-zinc-200 focus:outline-none focus:border-emerald-500/40 cursor-pointer"
                  >
                    {commands.map(cmd => (
                      <option key={cmd.name} value={cmd.name}>
                        {cmd.name} — {cmd.description}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                </div>
              </div>
            ) : (
              <div className="p-3 rounded bg-zinc-800/50 border border-zinc-700/50">
                <p className="font-pixel text-[8px] tracking-wider text-zinc-500">
                  NO COMMANDS DEFINED FOR THIS SKILL. A GENERIC PROMPT WILL BE USED.
                </p>
              </div>
            )}

            {/* Parameters */}
            {activeCommand && activeCommand.parameters.length > 0 && (
              <div>
                <label className="block font-pixel text-[7px] tracking-wider text-zinc-500 mb-2">
                  PARAMETERS
                </label>
                <div className="space-y-3">
                  {activeCommand.parameters.map(p => (
                    <div key={p.name}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-pixel text-[7px] tracking-wider text-zinc-300">
                          {p.name}
                        </span>
                        <span className="font-pixel text-[6px] tracking-wider text-zinc-600">
                          ({p.type})
                        </span>
                        {p.required && (
                          <span className="font-pixel text-[6px] tracking-wider text-red-400">
                            REQUIRED
                          </span>
                        )}
                      </div>
                      <p className="font-pixel text-[6px] tracking-wider text-zinc-600 mb-1">
                        {p.description}
                      </p>
                      {p.type === 'object' || p.type === 'array' ? (
                        <textarea
                          value={params[p.name] ?? ''}
                          onChange={e => handleParamChange(p.name, e.target.value)}
                          placeholder={p.default !== undefined ? JSON.stringify(p.default) : `Enter ${p.type}...`}
                          rows={3}
                          className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 font-mono focus:outline-none focus:border-emerald-500/40 placeholder:text-zinc-700 resize-y"
                        />
                      ) : (
                        <input
                          type={p.type === 'number' ? 'number' : 'text'}
                          value={params[p.name] ?? ''}
                          onChange={e => handleParamChange(p.name, e.target.value)}
                          placeholder={p.default !== undefined ? String(p.default) : `Enter ${p.name}...`}
                          className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 font-mono focus:outline-none focus:border-emerald-500/40 placeholder:text-zinc-700"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Result / Error Display */}
            {(result || error) && (
              <div>
                <label className="block font-pixel text-[7px] tracking-wider text-zinc-500 mb-1.5">
                  {mode === 'dry_run' ? 'GENERATED PROMPT' : 'EXECUTION RESULT'}
                </label>
                {error ? (
                  <div className="rounded border border-red-500/30 bg-red-500/[0.06] p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle size={14} className="text-red-400" />
                      <span className="font-pixel text-[8px] tracking-wider text-red-400">ERROR</span>
                    </div>
                    <pre className="text-sm text-red-300 font-mono whitespace-pre-wrap break-words">
                      {error}
                    </pre>
                  </div>
                ) : (
                  <div className={`rounded border p-4 max-h-[300px] overflow-y-auto ${
                    mode === 'dry_run'
                      ? 'border-blue-500/30 bg-blue-500/[0.06]'
                      : 'border-emerald-500/30 bg-emerald-500/[0.06]'
                  }`}>
                    <pre className={`text-sm font-mono whitespace-pre-wrap break-words ${
                      mode === 'dry_run' ? 'text-blue-200' : 'text-emerald-200'
                    }`}>
                      {result}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-jarvis-border bg-jarvis-bg/50">
            <div className="font-pixel text-[7px] tracking-wider text-zinc-600">
              MODEL: {skill.model ?? skill.defaultModel ?? 'NOT SET'}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDryRun}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-pixel text-[7px] tracking-wider text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Eye size={12} />
                DRY RUN
              </button>
              <button
                onClick={handleExecute}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-pixel text-[7px] tracking-wider text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Play size={12} />
                )}
                {loading ? 'EXECUTING...' : 'EXECUTE'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
