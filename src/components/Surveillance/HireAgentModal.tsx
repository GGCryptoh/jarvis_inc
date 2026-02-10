import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Agent } from '../../types';

export interface AgentConfig {
  name: string;
  role: string;
  model: string;
  color: string;
  skinTone: string;
}

interface HireAgentModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (config: AgentConfig) => void;
  editAgent?: Agent | null;
}

const COLOR_PALETTE = [
  { value: '#ff6b9d', label: 'Pink' },
  { value: '#50fa7b', label: 'Green' },
  { value: '#bd93f9', label: 'Purple' },
  { value: '#ffb86c', label: 'Orange' },
  { value: '#8be9fd', label: 'Cyan' },
  { value: '#f1fa8c', label: 'Yellow' },
  { value: '#ff5555', label: 'Red' },
  { value: '#6272a4', label: 'Steel' },
  { value: '#ff79c6', label: 'Magenta' },
  { value: '#f8f8f2', label: 'White' },
];

const SKIN_TONES = [
  { value: '#ffcc99', label: 'Light' },
  { value: '#f0b88a', label: 'Fair' },
  { value: '#e8a872', label: 'Medium' },
  { value: '#c8956c', label: 'Tan' },
  { value: '#a0704e', label: 'Brown' },
  { value: '#6b4226', label: 'Dark' },
];

const ROLE_PRESETS = [
  'Research Analyst',
  'Code Generator',
  'Security Auditor',
  'Data Analyst',
  'Content Writer',
  'DevOps Engineer',
  'QA Tester',
  'Product Manager',
  'Designer',
  'Sales Agent',
];

const MODEL_OPTIONS = [
  'Claude 3.5',
  'Claude 4',
  'GPT-4o',
  'GPT-4o mini',
  'Gemini Pro',
  'Llama 3',
  'Mistral Large',
];

export default function HireAgentModal({ open, onClose, onSubmit, editAgent }: HireAgentModalProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [customRole, setCustomRole] = useState('');
  const [model, setModel] = useState('Claude 3.5');
  const [color, setColor] = useState('#ff6b9d');
  const [skinTone, setSkinTone] = useState('#ffcc99');
  const [showCustomRole, setShowCustomRole] = useState(false);

  const isEditing = !!editAgent;

  // Populate form when editing
  useEffect(() => {
    if (editAgent) {
      setName(editAgent.name);
      const matchesPreset = ROLE_PRESETS.includes(editAgent.role);
      if (matchesPreset) {
        setRole(editAgent.role);
        setShowCustomRole(false);
      } else {
        setRole('custom');
        setCustomRole(editAgent.role);
        setShowCustomRole(true);
      }
      setModel(editAgent.model);
      setColor(editAgent.color);
      setSkinTone(editAgent.skinTone);
    } else {
      setName('');
      setRole('');
      setCustomRole('');
      setModel('Claude 3.5');
      setColor('#ff6b9d');
      setSkinTone('#ffcc99');
      setShowCustomRole(false);
    }
  }, [editAgent, open]);

  if (!open) return null;

  const effectiveRole = showCustomRole ? customRole : role;
  const isValid = name.trim().length > 0 && effectiveRole.trim().length > 0;

  function handleSubmit() {
    if (!isValid) return;
    onSubmit({
      name: name.trim().toUpperCase(),
      role: effectiveRole.trim(),
      model,
      color,
      skinTone,
    });
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-2xl mx-4">
        <div className="retro-window">
          {/* Title bar */}
          <div className="retro-window-title !text-[9px] !py-2">
            <span>{isEditing ? 'EDIT AGENT' : 'HIRE NEW AGENT'}</span>
            <button
              onClick={onClose}
              className="w-[14px] h-[14px] flex items-center justify-center bg-pixel-bg border border-gray-600 hover:bg-red-500/30 transition-colors"
            >
              <X size={8} />
            </button>
          </div>

          {/* Body */}
          <div className="retro-window-body !m-2">
            <div className="flex gap-4">
              {/* Left: Form */}
              <div className="flex-1 space-y-3">
                {/* Name */}
                <div>
                  <label className="block font-pixel text-[7px] text-gray-400 tracking-wider mb-1">
                    CALLSIGN
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="AGENT NAME"
                    maxLength={12}
                    autoFocus
                    className="w-full bg-pixel-bg border-2 border-pixel-crt-border text-pixel-green font-pixel text-[9px] tracking-wider px-3 py-2 rounded-sm focus:outline-none focus:border-pixel-green/50 placeholder:text-gray-600 uppercase"
                  />
                </div>

                {/* Role */}
                <div>
                  <label className="block font-pixel text-[7px] text-gray-400 tracking-wider mb-1">
                    ROLE
                  </label>
                  {!showCustomRole ? (
                    <div className="space-y-1">
                      <div className="grid grid-cols-2 gap-1">
                        {ROLE_PRESETS.map((r) => (
                          <button
                            key={r}
                            onClick={() => setRole(r)}
                            className={`font-pixel text-[6px] tracking-wider px-2 py-1.5 border transition-colors text-left truncate ${
                              role === r
                                ? 'border-pixel-green bg-pixel-green/10 text-pixel-green'
                                : 'border-pixel-crt-border bg-pixel-bg text-gray-400 hover:text-gray-200'
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => { setShowCustomRole(true); setRole('custom'); }}
                        className="font-pixel text-[6px] tracking-wider text-pixel-cyan hover:text-pixel-cyan/80 transition-colors"
                      >
                        + CUSTOM ROLE
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <input
                        type="text"
                        value={customRole}
                        onChange={(e) => setCustomRole(e.target.value)}
                        placeholder="Enter custom role"
                        maxLength={30}
                        className="w-full bg-pixel-bg border-2 border-pixel-crt-border text-pixel-green font-pixel text-[9px] tracking-wider px-3 py-2 rounded-sm focus:outline-none focus:border-pixel-green/50 placeholder:text-gray-600"
                      />
                      <button
                        onClick={() => { setShowCustomRole(false); setRole(''); setCustomRole(''); }}
                        className="font-pixel text-[6px] tracking-wider text-pixel-orange hover:text-pixel-orange/80 transition-colors"
                      >
                        ← PICK FROM PRESETS
                      </button>
                    </div>
                  )}
                </div>

                {/* Model */}
                <div>
                  <label className="block font-pixel text-[7px] text-gray-400 tracking-wider mb-1">
                    AI MODEL
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {MODEL_OPTIONS.map((m) => (
                      <button
                        key={m}
                        onClick={() => setModel(m)}
                        className={`font-pixel text-[6px] tracking-wider px-2 py-1 border transition-colors ${
                          model === m
                            ? 'border-pixel-cyan bg-pixel-cyan/10 text-pixel-cyan'
                            : 'border-pixel-crt-border bg-pixel-bg text-gray-400 hover:text-gray-200'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Color */}
                <div>
                  <label className="block font-pixel text-[7px] text-gray-400 tracking-wider mb-1">
                    SUIT COLOR
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {COLOR_PALETTE.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => setColor(c.value)}
                        title={c.label}
                        className={`w-[20px] h-[20px] rounded-sm border-2 transition-all ${
                          color === c.value
                            ? 'border-white scale-110 shadow-[0_0_8px_rgba(255,255,255,0.3)]'
                            : 'border-transparent hover:border-gray-500'
                        }`}
                        style={{ backgroundColor: c.value }}
                      />
                    ))}
                  </div>
                </div>

                {/* Skin Tone */}
                <div>
                  <label className="block font-pixel text-[7px] text-gray-400 tracking-wider mb-1">
                    SKIN TONE
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {SKIN_TONES.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => setSkinTone(s.value)}
                        title={s.label}
                        className={`w-[24px] h-[20px] rounded-sm border-2 transition-all ${
                          skinTone === s.value
                            ? 'border-white scale-110 shadow-[0_0_8px_rgba(255,255,255,0.3)]'
                            : 'border-transparent hover:border-gray-500'
                        }`}
                        style={{ backgroundColor: s.value }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Right: Live Sprite Preview */}
              <div className="w-[180px] flex-shrink-0 flex flex-col items-center">
                <label className="block font-pixel text-[7px] text-gray-400 tracking-wider mb-2 text-center">
                  PREVIEW
                </label>

                {/* Stage */}
                <div className="w-[160px] h-[180px] retro-inset flex items-center justify-center pixel-grid relative">
                  {/* Shadow on floor */}
                  <div className="absolute bottom-[28px] left-1/2 -translate-x-1/2 w-[40px] h-[8px] bg-black/20 rounded-full blur-[2px]" />

                  {/* Sprite - 3x scale */}
                  <div className="relative agent-idle">
                    {/* Hair/hat */}
                    <div
                      className="mx-auto w-[30px] h-[12px] rounded-t-sm"
                      style={{ backgroundColor: color }}
                    />
                    {/* Head */}
                    <div
                      className="mx-auto w-[30px] h-[24px] rounded-sm relative"
                      style={{ backgroundColor: skinTone }}
                    >
                      {/* Eyes */}
                      <div className="absolute top-[8px] left-[6px] w-[5px] h-[5px] bg-black rounded-sm" />
                      <div className="absolute top-[8px] right-[6px] w-[5px] h-[5px] bg-black rounded-sm" />
                      {/* Mouth */}
                      <div className="absolute bottom-[4px] left-1/2 -translate-x-1/2 w-[8px] h-[2px] bg-black/40 rounded-full" />
                    </div>
                    {/* Body */}
                    <div
                      className="mx-auto w-[36px] h-[30px] rounded-sm"
                      style={{ backgroundColor: color }}
                    />
                    {/* Legs */}
                    <div className="flex justify-center gap-[4px]">
                      <div className="w-[12px] h-[18px] rounded-b-sm bg-slate-700" />
                      <div className="w-[12px] h-[18px] rounded-b-sm bg-slate-700" />
                    </div>
                  </div>
                </div>

                {/* Name preview */}
                <div className="mt-3 text-center">
                  <div
                    className="font-pixel text-[10px] tracking-wider min-h-[14px]"
                    style={{ color: color }}
                  >
                    {name.toUpperCase() || '???'}
                  </div>
                  <div className="font-pixel text-[7px] text-gray-500 tracking-wider mt-1 min-h-[10px]">
                    {effectiveRole || 'No role'}
                  </div>
                  <div className="font-pixel text-[6px] text-pixel-cyan tracking-wider mt-1">
                    {model}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-pixel-crt-border">
              <button
                onClick={onClose}
                className="retro-button !text-[8px] tracking-wider hover:!text-pixel-orange"
              >
                CANCEL
              </button>
              <button
                onClick={handleSubmit}
                disabled={!isValid}
                className={`retro-button !text-[8px] tracking-wider !px-6 ${
                  isValid
                    ? 'hover:!text-pixel-green !border-t-pixel-green/50 !border-l-pixel-green/50'
                    : 'opacity-40 cursor-not-allowed'
                }`}
              >
                {isEditing ? '▶ SAVE CHANGES' : '▶ HIRE AGENT'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
