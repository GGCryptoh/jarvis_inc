import { useState, useEffect } from 'react';
import {
  X,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Globe,
  Terminal,
  Cpu,
  Blocks,
  Settings,
  AlertTriangle,
  Zap,
  Loader2,
  Mail, Send, Image, Sparkles, MessageCircle, FileText, Code, BarChart3,
  Calendar, Search, Rss, Monitor, ScanSearch, Video, Eye, BookOpen,
  Languages, CloudRain, Twitter,
} from 'lucide-react';
import type { FullSkillDefinition } from '../../lib/skillResolver';
import { MODEL_OPTIONS, getServiceForModel } from '../../lib/models';
import { getSetting, setSetting } from '../../lib/database';

const ICON_MAP: Record<string, React.ElementType> = {
  Mail, Send, Image, Sparkles, Globe, MessageCircle, FileText, Code, BarChart3,
  Calendar, Search, Rss, Monitor, ScanSearch, Video, Eye, BookOpen,
  Languages, Blocks, CloudRain, Terminal, Twitter,
};

function resolveIcon(iconName: string): React.ElementType {
  return ICON_MAP[iconName] ?? Blocks;
}

const categoryColors: Record<string, string> = {
  communication: '#8be9fd',
  research: '#50fa7b',
  creation: '#ff79c6',
  analysis: '#ffb86c',
};

interface SkillDetailPanelProps {
  skill: FullSkillDefinition;
  onClose: () => void;
  onToggle: (skill: FullSkillDefinition) => void;
  onModelChange: (skill: FullSkillDefinition, model: string) => void;
  onTest: (skill: FullSkillDefinition) => void;
}

export default function SkillDetailPanel({
  skill,
  onClose,
  onToggle,
  onModelChange,
  onTest,
}: SkillDetailPanelProps) {
  const [expandedCommand, setExpandedCommand] = useState<string | null>(null);
  const [settingsValues, setSettingsValues] = useState<Record<string, string>>({});
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [showYoloWarning, setShowYoloWarning] = useState<string | null>(null);
  const [checkingForum, setCheckingForum] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Load current values for skill settings
  useEffect(() => {
    if (!skill.settings) return;
    const keys = Object.keys(skill.settings);
    if (keys.length === 0) return;
    setSettingsLoading(true);
    Promise.all(keys.map(async (key) => {
      let val = await getSetting(key);
      const schema = skill.settings![key];
      // Normalize legacy boolean values for options-based settings
      if (schema.options?.length && val != null) {
        if (val === 'true') val = 'all';
        else if (val === 'false') val = 'off';
      }
      return [key, val ?? String(schema.default)] as [string, string];
    })).then(entries => {
      setSettingsValues(Object.fromEntries(entries));
      setSettingsLoading(false);
    });
  }, [skill.id, skill.settings]);

  const Icon = resolveIcon(skill.icon);
  const catColor = categoryColors[skill.category] ?? '#888';
  const riskLevel = skill.riskLevel ?? 'safe';

  const riskColors = {
    safe: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400' },
    moderate: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400' },
    dangerous: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400' },
  };
  const risk = riskColors[riskLevel as keyof typeof riskColors] ?? riskColors.safe;

  const connTypeLabel = {
    llm: 'LLM',
    api_key: 'API Key',
    cli: 'CLI Tool',
    oauth: 'OAuth',
    none: skill.fixedService ? 'Direct' : 'No Connection',
  }[skill.serviceType] ?? skill.serviceType;

  const connTypeIcon = {
    llm: Cpu,
    api_key: Shield,
    cli: Terminal,
    none: Globe,
  }[skill.serviceType] ?? Globe;
  const ConnIcon = connTypeIcon;

  // Checksum display
  const checksumStatus = skill.checksum
    ? 'verified' // We have a checksum stored
    : 'unverified';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        <div className="bg-jarvis-surface border border-zinc-600/40 rounded-lg shadow-lg overflow-hidden flex flex-col max-h-full">
          {/* Header */}
          <div className="flex items-start justify-between px-5 py-4 bg-zinc-500/10 border-b border-zinc-600/20 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-zinc-800">
                <Icon size={20} className="text-zinc-300" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-zinc-100 font-semibold text-sm tracking-wide">{skill.name}</h2>
                  {skill.version && (
                    <span className="font-pixel text-[6px] tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">
                      v{skill.version}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className="font-pixel text-[6px] tracking-widest px-1.5 py-0.5 rounded"
                    style={{ color: catColor, backgroundColor: `${catColor}15`, border: `1px solid ${catColor}30` }}
                  >
                    {skill.category.toUpperCase()}
                  </span>
                  <span className={`font-pixel text-[6px] tracking-wider px-1.5 py-0.5 rounded ${risk.bg} ${risk.border} ${risk.text} border`}>
                    {riskLevel.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors p-1">
              <X size={16} />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="overflow-y-auto flex-1 no-scrollbar">
            <div className="px-5 py-4 space-y-4">
              {/* Description */}
              <p className="text-zinc-400 text-xs leading-relaxed">{skill.description}</p>

              {/* Checksum shield */}
              <div className="flex items-center gap-2">
                {checksumStatus === 'verified' ? (
                  <ShieldCheck size={14} className="text-emerald-400" />
                ) : (
                  <ShieldAlert size={14} className="text-amber-400" />
                )}
                <span className={`font-mono text-[10px] ${checksumStatus === 'verified' ? 'text-emerald-400/70' : 'text-amber-400/70'}`}>
                  {skill.checksum ? `${skill.checksum.slice(0, 16)}...` : 'No checksum'}
                </span>
              </div>

              {/* Connection info */}
              <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30">
                <div className="flex items-center gap-2 mb-2">
                  <ConnIcon size={12} className="text-zinc-400" />
                  <span className="font-pixel text-[7px] tracking-wider text-zinc-300">{connTypeLabel}</span>
                  {skill.fixedService && (
                    <span className="font-pixel text-[6px] tracking-wider text-zinc-500">({skill.fixedService})</span>
                  )}
                </div>
                {skill.apiConfig?.base_url && (
                  <div className="font-mono text-[10px] text-zinc-500 truncate">
                    {skill.apiConfig.base_url}
                  </div>
                )}
                {skill.apiConfig?.vault_service && skill.apiConfig.vault_service !== 'none' && (
                  <div className="font-pixel text-[6px] tracking-wider text-zinc-500 mt-1">
                    VAULT: {skill.apiConfig.vault_service}
                  </div>
                )}
              </div>

              {/* Commands list */}
              {skill.commands && skill.commands.length > 0 && (
                <div>
                  <h3 className="font-pixel text-[8px] tracking-wider text-zinc-300 mb-2">COMMANDS</h3>
                  <div className="space-y-1">
                    {skill.commands.map(cmd => {
                      const isExpanded = expandedCommand === cmd.name;
                      const isDeclarative = !!cmd.request;
                      return (
                        <div key={cmd.name} className="border border-zinc-700/30 rounded-lg overflow-hidden">
                          <button
                            onClick={() => setExpandedCommand(isExpanded ? null : cmd.name)}
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-zinc-800/30 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              {isExpanded ? <ChevronDown size={10} className="text-zinc-500" /> : <ChevronRight size={10} className="text-zinc-500" />}
                              <span className="font-mono text-[11px] text-zinc-200">{cmd.name}</span>
                              {isDeclarative && (
                                <span className="font-pixel text-[5px] tracking-wider px-1 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                                  DECLARATIVE
                                </span>
                              )}
                            </div>
                            <span className="font-pixel text-[6px] tracking-wider text-zinc-600">
                              {cmd.parameters.length} PARAM{cmd.parameters.length !== 1 ? 'S' : ''}
                            </span>
                          </button>
                          {isExpanded && (
                            <div className="px-3 pb-3 border-t border-zinc-700/20">
                              <p className="text-zinc-500 text-[11px] mt-2 mb-2">{cmd.description}</p>
                              {cmd.parameters.length > 0 && (
                                <div className="space-y-1">
                                  {cmd.parameters.map(p => (
                                    <div key={p.name} className="flex items-baseline gap-2">
                                      <span className="font-mono text-[10px] text-emerald-400">{p.name}</span>
                                      <span className="font-pixel text-[5px] tracking-wider text-zinc-600">{p.type}{p.required ? ' *' : ''}</span>
                                      <span className="text-zinc-600 text-[10px]">{p.description}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {cmd.returns && (
                                <div className="mt-2 text-zinc-600 text-[10px]">
                                  Returns: <span className="text-zinc-500">{cmd.returns.type}</span> — {cmd.returns.description}
                                </div>
                              )}
                              {cmd.request && (
                                <div className="mt-2 font-mono text-[9px] text-cyan-400/60">
                                  {cmd.request.method} {cmd.request.path || '(base_url)'}
                                  {cmd.request.query && <span className="text-zinc-600"> ?{Object.keys(cmd.request.query).join('&')}</span>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Skill Settings */}
              {skill.settings && Object.keys(skill.settings).length > 0 && (
                <div>
                  <h3 className="font-pixel text-[8px] tracking-wider text-zinc-300 mb-2 flex items-center gap-1.5">
                    <Settings size={10} /> SETTINGS
                  </h3>
                  {settingsLoading ? (
                    <p className="font-mono text-[10px] text-zinc-500">Loading...</p>
                  ) : (
                    <div className="space-y-3">
                      {Object.entries(skill.settings).map(([key, schema]) => (
                        <div key={key} className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono text-[11px] text-zinc-200">{key}</span>
                            {schema.type === 'boolean' ? (
                              <button
                                onClick={async () => {
                                  const newVal = settingsValues[key] === 'true' ? 'false' : 'true';
                                  setSettingsValues(prev => ({ ...prev, [key]: newVal }));
                                  await setSetting(key, newVal);
                                }}
                                className={`w-10 h-5 rounded-full transition-colors duration-200 flex items-center px-0.5 ${
                                  settingsValues[key] === 'true' ? 'bg-emerald-500' : 'bg-zinc-700'
                                }`}
                              >
                                <div className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                                  settingsValues[key] === 'true' ? 'translate-x-[18px]' : 'translate-x-0'
                                }`} />
                              </button>
                            ) : schema.type === 'number' ? (
                              <input
                                type="number"
                                value={settingsValues[key] ?? ''}
                                onChange={async (e) => {
                                  setSettingsValues(prev => ({ ...prev, [key]: e.target.value }));
                                  await setSetting(key, e.target.value);
                                }}
                                className="w-20 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded font-mono text-[10px] text-zinc-300 focus:outline-none focus:border-emerald-500/40"
                              />
                            ) : schema.options && schema.options.length > 0 ? (
                              <div className="relative">
                                <select
                                  value={settingsValues[key] ?? String(schema.default)}
                                  onChange={async (e) => {
                                    const newVal = e.target.value;
                                    if (newVal === 'all') {
                                      setShowYoloWarning(key);
                                      return;
                                    }
                                    setSettingsValues(prev => ({ ...prev, [key]: newVal }));
                                    await setSetting(key, newVal);
                                  }}
                                  className="appearance-none font-mono text-[10px] bg-zinc-900 border border-zinc-700 rounded px-2 py-1 pr-6 text-zinc-300 cursor-pointer focus:outline-none focus:border-emerald-500/40"
                                >
                                  {schema.options.map(opt => (
                                    <option key={opt} value={opt}>{opt.toUpperCase()}</option>
                                  ))}
                                </select>
                                <ChevronDown size={8} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={settingsValues[key] ?? ''}
                                  onChange={(e) => setSettingsValues(prev => ({ ...prev, [key]: e.target.value }))}
                                  onBlur={async (e) => {
                                    await setSetting(key, e.target.value);
                                  }}
                                  className="w-40 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded font-mono text-[10px] text-zinc-300 focus:outline-none focus:border-emerald-500/40"
                                />
                                {key === 'forum_check_frequency' && (
                                  <button
                                    disabled={checkingForum}
                                    onClick={async () => {
                                      setCheckingForum(true);
                                      try {
                                        const { triggerForumCheckNow } = await import('../../lib/ceoDecisionEngine');
                                        await triggerForumCheckNow();
                                      } catch (e) { console.error('Forum check failed:', e); }
                                      setCheckingForum(false);
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 font-pixel text-[6px] tracking-wider text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded transition-colors disabled:opacity-50"
                                  >
                                    {checkingForum ? <Loader2 size={8} className="animate-spin" /> : <Zap size={8} />}
                                    CHECK NOW
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <p className="font-mono text-[9px] text-zinc-500">{schema.description}</p>
                          {showYoloWarning === key && (
                            <div className="mt-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <AlertTriangle size={12} className="text-amber-400" />
                                <span className="font-pixel text-[7px] tracking-wider text-amber-400">YOLO MODE</span>
                              </div>
                              <p className="font-mono text-[9px] text-amber-300/80 mb-2">
                                All posts will auto-publish without risk assessment. No safety net.
                              </p>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={async () => {
                                    setSettingsValues(prev => ({ ...prev, [key]: 'all' }));
                                    await setSetting(key, 'all');
                                    setShowYoloWarning(null);
                                  }}
                                  className="px-2.5 py-1 font-pixel text-[6px] tracking-wider text-amber-400 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded transition-colors"
                                >
                                  CONFIRM
                                </button>
                                <button
                                  onClick={() => setShowYoloWarning(null)}
                                  className="px-2.5 py-1 font-pixel text-[6px] tracking-wider text-zinc-400 hover:text-zinc-300 border border-zinc-700 rounded transition-colors"
                                >
                                  CANCEL
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer: Toggle + Model + Test */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-jarvis-border bg-jarvis-bg/50 flex-shrink-0">
            <div className="flex items-center gap-3">
              {/* Toggle switch */}
              <button
                onClick={() => onToggle(skill)}
                className={`w-10 h-5 rounded-full transition-colors duration-200 flex items-center px-0.5 ${
                  skill.enabled ? 'bg-emerald-500' : 'bg-zinc-700'
                }`}
              >
                <div className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                  skill.enabled ? 'translate-x-[18px]' : 'translate-x-0'
                }`} />
              </button>
              <span className={`font-pixel text-[7px] tracking-wider ${skill.enabled ? 'text-emerald-400' : 'text-zinc-500'}`}>
                {skill.enabled ? 'ENABLED' : 'DISABLED'}
              </span>

              {/* Model selector for LLM skills */}
              {skill.enabled && skill.serviceType === 'llm' && (
                <div className="relative">
                  <select
                    value={skill.model ?? ''}
                    onChange={e => onModelChange(skill, e.target.value)}
                    className="appearance-none font-pixel text-[7px] tracking-wider bg-zinc-900 border border-zinc-700 rounded px-2 py-1 pr-5 text-zinc-300 focus:outline-none focus:border-emerald-500/40 cursor-pointer"
                  >
                    <option value="" disabled>MODEL</option>
                    {MODEL_OPTIONS.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <ChevronDown size={8} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {skill.enabled && skill.commands && skill.commands.length > 0 && (
                <button
                  onClick={() => onTest(skill)}
                  className="flex items-center gap-1.5 px-3 py-1.5 font-pixel text-[7px] tracking-wider text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded transition-colors"
                >
                  <FlaskConical size={10} />
                  TEST
                </button>
              )}
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-jarvis-muted hover:text-jarvis-text border border-jarvis-border rounded transition-colors"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
