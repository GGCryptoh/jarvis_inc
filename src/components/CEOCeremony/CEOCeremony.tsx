import { useState, useEffect, useRef } from 'react';
import { getFounderInfo, saveCEO, saveVaultEntry, updateVaultEntry, getVaultEntryByService, saveMission, logAudit, saveApproval, loadApprovals } from '../../lib/database';
import { MODEL_OPTIONS, getServiceForModel, SERVICE_KEY_HINTS, validateApiKeyFormat } from '../../lib/models';
import { Check, X as XIcon, AlertTriangle } from 'lucide-react';

interface CEOCeremonyProps {
  onComplete: () => void;
}

type Phase = 'intro' | 'reveal' | 'form' | 'archetype' | 'api_key' | 'activating' | 'done';

const PHILOSOPHY_PRESETS = [
  'Move fast, break things',
  'Steady and methodical',
  'Data-driven optimization',
  'Innovation at all costs',
];

const ACTIVATION_MESSAGES = [
  { threshold: 0, text: 'Loading executive neural network...' },
  { threshold: 25, text: 'Calibrating strategic vision...' },
  { threshold: 55, text: 'Establishing chain of command...' },
  { threshold: 85, text: 'CEO ONLINE.' },
];

// ---------------------------------------------------------------------------
// CEO Personality Archetypes
// ---------------------------------------------------------------------------

const CEO_ARCHETYPES = [
  { id: 'wharton_mba', name: 'WHARTON MBA', emoji: '\u{1F4CA}', vibe: 'Polished, strategic, KPI-obsessed' },
  { id: 'wall_street', name: 'WALL ST SHARK', emoji: '\u{1F988}', vibe: 'Aggressive, numbers-first, blunt' },
  { id: 'mit_engineer', name: 'MIT ENGINEER', emoji: '\u{2699}\u{FE0F}', vibe: 'Precise, first-principles, systematic' },
  { id: 'sv_founder', name: 'SV FOUNDER', emoji: '\u{1F680}', vibe: 'Visionary, 10x thinking, ship fast' },
  { id: 'beach_bum', name: 'BEACH BUM', emoji: '\u{1F3D6}\u{FE0F}', vibe: 'Laid-back, zen, surprisingly wise' },
  { id: 'military_cmd', name: 'COMMANDER', emoji: '\u{1F396}\u{FE0F}', vibe: 'Disciplined, mission-first, crisp' },
  { id: 'creative_dir', name: 'CREATIVE DIR', emoji: '\u{1F3A8}', vibe: 'Aesthetic, intuitive, brand-first' },
  { id: 'professor', name: 'PROFESSOR', emoji: '\u{1F4DA}', vibe: 'Thorough, evidence-based, cautious' },
] as const;

export default function CEOCeremony({ onComplete }: CEOCeremonyProps) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [visibleLines, setVisibleLines] = useState<string[]>([]);
  const [showCursor, setShowCursor] = useState(true);

  // Form state
  const [ceoName, setCeoName] = useState('');
  const [model, setModel] = useState('Claude Opus 4.6');
  const [philosophy, setPhilosophy] = useState('');
  const [customPhilosophy, setCustomPhilosophy] = useState('');
  const [showCustomPhilosophy, setShowCustomPhilosophy] = useState(false);
  const [riskTolerance, setRiskTolerance] = useState<'conservative' | 'moderate' | 'aggressive'>('moderate');

  // Archetype state
  const [archetype, setArchetype] = useState<string | null>(null);

  // API key state
  const [apiKey, setApiKey] = useState('');
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  const [activationProgress, setActivationProgress] = useState(0);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Founder info loaded asynchronously
  const [founderName, setFounderName] = useState('FOUNDER');

  useEffect(() => {
    getFounderInfo().then(info => {
      setFounderName(info?.founderName ?? 'FOUNDER');
    });
  }, []);

  // Blinking cursor
  useEffect(() => {
    const interval = setInterval(() => setShowCursor(c => !c), 530);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [visibleLines]);

  // Phase: intro — terminal lines
  useEffect(() => {
    if (phase !== 'intro') return;
    const lines = [
      { text: `FOUNDER ${founderName.toUpperCase()} VERIFIED`, delay: 0 },
      { text: '', delay: 400 },
      { text: 'Initializing executive layer...', delay: 800 },
      { text: '[OK] Strategic planning module', delay: 1400 },
      { text: '[OK] Decision engine primed', delay: 2000 },
      { text: '[OK] Risk assessment calibrated', delay: 2100 },
      { text: '[OK] Command chain framework loaded', delay: 2700 },
      { text: '', delay: 3600 },
      { text: '> CEO position: VACANT', delay: 2100 },
    ];
    const timers: ReturnType<typeof setTimeout>[] = [];
    lines.forEach(({ text, delay }) => {
      timers.push(setTimeout(() => setVisibleLines(prev => [...prev, text]), delay));
    });
    timers.push(setTimeout(() => setPhase('reveal'), 4100));
    return () => timers.forEach(clearTimeout);
  }, [phase, founderName]);

  // Phase: reveal -> form
  useEffect(() => {
    if (phase !== 'reveal') return;
    const t = setTimeout(() => setPhase('form'), 8000);
    return () => clearTimeout(t);
  }, [phase]);

  // Phase: activating — progress bar
  useEffect(() => {
    if (phase !== 'activating') return;
    const interval = setInterval(() => {
      setActivationProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          return 100;
        }
        return p + 2;
      });
    }, 40);
    return () => clearInterval(interval);
  }, [phase]);

  // When activation hits 100 -> done
  useEffect(() => {
    if (phase === 'activating' && activationProgress >= 100) {
      const t = setTimeout(() => setPhase('done'), 600);
      return () => clearTimeout(t);
    }
  }, [phase, activationProgress]);

  // Phase: done — brief pause then complete
  useEffect(() => {
    if (phase !== 'done') return;
    const t = setTimeout(() => onComplete(), 1800);
    return () => clearTimeout(t);
  }, [phase, onComplete]);

  const effectivePhilosophy = showCustomPhilosophy ? customPhilosophy : philosophy;

  function handleDesignate() {
    if (!ceoName.trim() || !effectivePhilosophy.trim()) return;
    setPhase('archetype');
  }

  function handleArchetypeConfirm() {
    setPhase('api_key');
  }

  const service = getServiceForModel(model);
  const hints = SERVICE_KEY_HINTS[service];

  function maskKey(key: string): string {
    if (key.length <= 10) return key;
    return key.slice(0, 10) + '\u2022'.repeat(Math.min(key.length - 10, 8));
  }

  // API key format validation
  const keyValidation = validateApiKeyFormat(service, apiKey);
  const keyLongEnough = apiKey.trim().length >= 10;

  async function persistCEO() {
    const ceoCallsign = ceoName.trim().toUpperCase();
    await saveCEO({
      name: ceoCallsign,
      model,
      philosophy: effectivePhilosophy.trim(),
      risk_tolerance: riskTolerance,
      status: 'nominal',
      archetype: archetype,
      color: '#f1fa8c',
      skin_tone: '#ffcc99',
    });
    // Seed milestone mission
    const fInfo = await getFounderInfo();
    const fName = fInfo?.founderName ?? 'Founder';
    await saveMission({
      id: 'mission-ceo-designation',
      title: `Designate CEO ${ceoCallsign}`,
      status: 'done',
      assignee: fName,
      priority: 'critical',
      created_by: fName,
      created_at: new Date().toISOString(),
      due_date: null,
    });
    await logAudit(ceoCallsign, 'CEO_HIRED', `CEO "${ceoCallsign}" designated with ${model}, archetype: ${archetype ?? 'none'}`, 'info');
  }

  async function handleHireCEO() {
    if (!keyValidation.valid && keyLongEnough) return;
    if (!keyLongEnough) return;
    await persistCEO();
    // Check if a vault entry already exists for this service — update instead of duplicating
    const existing = await getVaultEntryByService(service);
    if (existing) {
      await updateVaultEntry(existing.id, { key_value: apiKey.trim() });
      await logAudit(null, 'KEY_UPDATED', `Updated ${service} API key during CEO ceremony`, 'info');
    } else {
      await saveVaultEntry({
        id: `vault-${Date.now()}`,
        name: `${service} API Key`,
        type: 'api_key',
        service,
        key_value: apiKey.trim(),
      });
      await logAudit(null, 'KEY_ADDED', `Added ${service} API key during CEO ceremony`, 'info');
    }
    setPhase('activating');
  }

  async function handleSkipApiKey() {
    await persistCEO();
    // Check if key already exists in vault — no need for approval if so
    const existingKey = await getVaultEntryByService(service);
    if (!existingKey) {
      // Only create approval if one doesn't already exist for this service
      const pendingApprovals = await loadApprovals();
      const hasExisting = pendingApprovals.some(a => {
        if (a.type !== 'api_key_request') return false;
        try {
          const meta = typeof a.metadata === 'string' ? JSON.parse(a.metadata) : (a.metadata ?? {});
          return meta.service === service;
        } catch { return false; }
      });
      if (!hasExisting) {
        await saveApproval({
          id: `approval-ceo-key-${Date.now()}`,
          type: 'api_key_request',
          title: `API Key Required: ${service}`,
          description: `CEO ${ceoName.trim().toUpperCase()} needs a ${service} API key to operate with ${model}. Skipped during ceremony.`,
          status: 'pending',
          metadata: { service, model, source: 'ceo_ceremony_skip' },
        });
        window.dispatchEvent(new Event('approvals-changed'));
        await logAudit(null, 'KEY_SKIPPED', `Skipped API key for ${service} during CEO ceremony — approval created`, 'warning');
      }
    }
    setPhase('activating');
  }

  const isValid = ceoName.trim().length > 0 && effectivePhilosophy.trim().length > 0;

  // Gold accent color used throughout
  const gold = '#f1fa8c';

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center z-[100] overflow-y-auto">
      {/* Scanline overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-10 opacity-[0.04]"
        style={{
          background: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${gold}15 2px, ${gold}15 4px)`,
        }}
      />
      {/* Corner vignette */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)' }}
      />

      <div className="relative z-20 w-full max-w-4xl px-8 py-8 my-auto">
        {/* Terminal phase: intro */}
        {phase === 'intro' && (
          <div
            ref={terminalRef}
            className="font-mono text-lg leading-relaxed max-h-[70vh] overflow-y-auto"
            style={{ color: gold, textShadow: `0 0 6px ${gold}66` }}
          >
            {visibleLines.map((line, i) => (
              <div key={i} className={line === '' ? 'h-3' : ''}>
                {line}
              </div>
            ))}
            <span className={`inline-block w-2 h-4 ${showCursor ? 'opacity-100' : 'opacity-0'}`} style={{ backgroundColor: gold }} />
          </div>
        )}

        {/* Reveal */}
        {phase === 'reveal' && (
          <div className="text-center animate-[fadeIn_1s_ease-out]">
            <h1
              className="font-pixel text-4xl tracking-wider mb-6 whitespace-nowrap"
              style={{ color: gold, textShadow: `0 0 20px ${gold}4d, 0 0 40px ${gold}1a` }}
            >
              DESIGNATE YOUR AI CEO
            </h1>
            <p className="font-pixel text-sm tracking-wider leading-relaxed" style={{ color: `${gold}99` }}>
              Every organization needs a chief executive.
              <br />
              Your CEO will oversee all agent operations.
              <br />
              Choose wisely.
            </p>
          </div>
        )}

        {/* Form */}
        {phase === 'form' && (
          <div className="animate-[fadeIn_0.6s_ease-out]">
            <h1
              className="font-pixel text-3xl tracking-wider mb-5 text-center"
              style={{ color: gold, textShadow: `0 0 20px ${gold}4d` }}
            >
              CEO DESIGNATION
            </h1>

            <div className="space-y-4 max-w-lg mx-auto">
              {/* CEO Name */}
              <div>
                <label className="block font-pixel text-xs tracking-widest mb-2" style={{ color: `${gold}b3` }}>
                  CEO CALLSIGN
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-pixel text-sm" style={{ color: `${gold}66` }}>{'>'}</span>
                  <input
                    type="text"
                    value={ceoName}
                    onChange={e => setCeoName(e.target.value)}
                    placeholder="Enter CEO name"
                    maxLength={20}
                    autoFocus
                    className="w-full bg-black border-2 font-pixel text-base tracking-wider px-7 py-3 rounded-sm focus:outline-none transition-colors placeholder:opacity-30"
                    style={{
                      borderColor: `${gold}4d`,
                      color: gold,
                      textShadow: `0 0 4px ${gold}4d`,
                    }}
                    onFocus={e => (e.target.style.borderColor = `${gold}b3`)}
                    onBlur={e => (e.target.style.borderColor = `${gold}4d`)}
                  />
                </div>
              </div>

              {/* AI Model */}
              <div>
                <label className="block font-pixel text-xs tracking-widest mb-2" style={{ color: `${gold}b3` }}>
                  AI MODEL
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                  {MODEL_OPTIONS.map(m => (
                    <button
                      key={m}
                      onClick={() => setModel(m)}
                      className="font-pixel text-[10px] tracking-wider px-2 py-1 border transition-colors truncate"
                      style={{
                        borderColor: model === m ? gold : '#3a3a5a',
                        backgroundColor: model === m ? `${gold}1a` : 'transparent',
                        color: model === m ? gold : '#9ca3af',
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Operating Philosophy */}
              <div>
                <label className="block font-pixel text-xs tracking-widest mb-2" style={{ color: `${gold}b3` }}>
                  OPERATING PHILOSOPHY
                </label>
                {!showCustomPhilosophy ? (
                  <div className="space-y-1">
                    <div className="grid grid-cols-1 gap-1">
                      {PHILOSOPHY_PRESETS.map(p => (
                        <button
                          key={p}
                          onClick={() => setPhilosophy(p)}
                          className="font-pixel text-[10px] tracking-wider px-3 py-2 border transition-colors text-left"
                          style={{
                            borderColor: philosophy === p ? gold : '#3a3a5a',
                            backgroundColor: philosophy === p ? `${gold}1a` : 'transparent',
                            color: philosophy === p ? gold : '#9ca3af',
                          }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => { setShowCustomPhilosophy(true); setPhilosophy(''); }}
                      className="font-pixel text-[9px] tracking-wider transition-colors"
                      style={{ color: '#8be9fd' }}
                    >
                      + CUSTOM PHILOSOPHY
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <input
                      type="text"
                      value={customPhilosophy}
                      onChange={e => setCustomPhilosophy(e.target.value)}
                      placeholder="Enter your CEO's operating philosophy"
                      maxLength={60}
                      className="w-full bg-black border-2 font-pixel text-sm tracking-wider px-3 py-2 rounded-sm focus:outline-none transition-colors placeholder:opacity-30"
                      style={{
                        borderColor: `${gold}4d`,
                        color: gold,
                      }}
                      onFocus={e => (e.target.style.borderColor = `${gold}b3`)}
                      onBlur={e => (e.target.style.borderColor = `${gold}4d`)}
                    />
                    <button
                      onClick={() => { setShowCustomPhilosophy(false); setCustomPhilosophy(''); }}
                      className="font-pixel text-[9px] tracking-wider"
                      style={{ color: '#ffb86c' }}
                    >
                      {'\u2190'} PICK FROM PRESETS
                    </button>
                  </div>
                )}
              </div>

              {/* Risk Tolerance */}
              <div>
                <label className="block font-pixel text-xs tracking-widest mb-2" style={{ color: `${gold}b3` }}>
                  RISK TOLERANCE
                </label>
                <div className="flex gap-2">
                  {(['conservative', 'moderate', 'aggressive'] as const).map(r => (
                    <button
                      key={r}
                      onClick={() => setRiskTolerance(r)}
                      className="flex-1 font-pixel text-[10px] tracking-wider py-2 border transition-colors uppercase"
                      style={{
                        borderColor: riskTolerance === r ? gold : '#3a3a5a',
                        backgroundColor: riskTolerance === r ? `${gold}1a` : 'transparent',
                        color: riskTolerance === r ? gold : '#9ca3af',
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Designate button */}
              <button
                onClick={handleDesignate}
                disabled={!isValid}
                className="w-full font-pixel text-sm tracking-[0.3em] py-3 rounded-sm border-2 transition-all duration-300"
                style={{
                  borderColor: isValid ? gold : `${gold}33`,
                  backgroundColor: isValid ? `${gold}1a` : 'transparent',
                  color: isValid ? gold : `${gold}4d`,
                  cursor: isValid ? 'pointer' : 'not-allowed',
                  boxShadow: isValid ? `0 0 30px ${gold}33` : 'none',
                }}
              >
                {'\u25B6'} NEXT: CHOOSE PERSONALITY
              </button>
            </div>
          </div>
        )}

        {/* Archetype selection phase */}
        {phase === 'archetype' && (
          <div className="animate-[fadeIn_0.6s_ease-out]">
            <h1
              className="font-pixel text-2xl tracking-wider mb-2 text-center"
              style={{ color: gold, textShadow: `0 0 20px ${gold}4d` }}
            >
              CEO PERSONALITY
            </h1>
            <p className="font-pixel text-[10px] tracking-wider text-center mb-6" style={{ color: `${gold}80` }}>
              Choose a personality archetype for {ceoName.toUpperCase()}. This shapes how your CEO communicates.
            </p>

            <div className="max-w-2xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-2 mb-6">
              {CEO_ARCHETYPES.map(a => {
                const selected = archetype === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => setArchetype(selected ? null : a.id)}
                    className="text-left p-3 border-2 rounded-sm transition-all duration-200"
                    style={{
                      borderColor: selected ? gold : '#3a3a5a',
                      backgroundColor: selected ? `${gold}15` : 'transparent',
                      boxShadow: selected ? `0 0 15px ${gold}20` : 'none',
                    }}
                  >
                    <div className="text-xl mb-1">{a.emoji}</div>
                    <div
                      className="font-pixel text-[8px] tracking-wider mb-1"
                      style={{ color: selected ? gold : '#d4d4d8' }}
                    >
                      {a.name}
                    </div>
                    <div
                      className="font-pixel text-[6px] tracking-wider leading-relaxed"
                      style={{ color: selected ? `${gold}b3` : '#71717a' }}
                    >
                      {a.vibe}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="max-w-lg mx-auto space-y-3">
              <button
                onClick={handleArchetypeConfirm}
                className="w-full font-pixel text-sm tracking-[0.3em] py-4 rounded-sm border-2 transition-all duration-300"
                style={{
                  borderColor: gold,
                  backgroundColor: `${gold}1a`,
                  color: gold,
                  cursor: 'pointer',
                  boxShadow: `0 0 30px ${gold}33`,
                }}
              >
                {'\u25B6'} {archetype ? 'CONTINUE' : 'SKIP ARCHETYPE'}
              </button>
              {!archetype && (
                <p className="font-pixel text-[8px] tracking-wider text-center" style={{ color: '#71717a' }}>
                  No archetype selected — your CEO will use a neutral personality
                </p>
              )}
            </div>
          </div>
        )}

        {/* API Key phase */}
        {phase === 'api_key' && (
          <div className="animate-[fadeIn_0.6s_ease-out]">
            <h1
              className="font-pixel text-2xl tracking-wider mb-2 text-center"
              style={{ color: gold, textShadow: `0 0 20px ${gold}4d` }}
            >
              CONNECT {service.toUpperCase()} API
            </h1>
            <p className="font-pixel text-[10px] tracking-wider text-center mb-5" style={{ color: `${gold}80` }}>
              {ceoName.toUpperCase()} needs an API key to operate with {model}
            </p>

            <div className="max-w-lg mx-auto space-y-4">
              {/* Steps */}
              {hints && (
                <div className="space-y-2">
                  <div className="font-pixel text-[9px] tracking-widest mb-3" style={{ color: `${gold}b3` }}>
                    HOW TO GET YOUR KEY
                  </div>
                  {hints.steps.map((step, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span
                        className="font-pixel text-[10px] w-5 h-5 flex items-center justify-center border rounded-sm flex-shrink-0"
                        style={{ borderColor: `${gold}4d`, color: gold }}
                      >
                        {i + 1}
                      </span>
                      <span className="font-pixel text-[9px] tracking-wider pt-0.5" style={{ color: `${gold}cc` }}>
                        {step.includes(hints.url) ? (
                          <>
                            {step.split(hints.url)[0]}
                            <a
                              href={`https://${hints.url}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                              style={{ color: '#8be9fd' }}
                            >
                              {hints.url}
                            </a>
                            {step.split(hints.url)[1]}
                          </>
                        ) : step}
                      </span>
                    </div>
                  ))}
                  <a
                    href={`https://${hints.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block font-pixel text-[8px] tracking-wider mt-2 hover:underline"
                    style={{ color: '#8be9fd' }}
                  >
                    {hints.url} {'\u2197'}
                  </a>
                </div>
              )}

              {/* Key Input */}
              <div>
                <label className="block font-pixel text-xs tracking-widest mb-2" style={{ color: `${gold}b3` }}>
                  API KEY
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  onPaste={e => {
                    e.preventDefault();
                    const pasted = e.clipboardData.getData('text');
                    setApiKey(pasted);
                  }}
                  placeholder="Paste your API key here"
                  className="w-full bg-black border-2 font-mono text-sm tracking-wider px-4 py-3 rounded-sm focus:outline-none transition-colors placeholder:opacity-30"
                  style={{
                    borderColor: keyValidation.valid ? '#50fa7b80' : apiKey.length > 0 ? '#ff5555aa' : `${gold}4d`,
                    color: keyValidation.valid ? '#50fa7b' : gold,
                  }}
                  onFocus={e => (e.target.style.borderColor = keyValidation.valid ? '#50fa7b' : `${gold}b3`)}
                  onBlur={e => (e.target.style.borderColor = keyValidation.valid ? '#50fa7b80' : apiKey.length > 0 ? '#ff5555aa' : `${gold}4d`)}
                />

                {/* Validation feedback */}
                {apiKey.length > 0 && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="font-mono text-sm tracking-wider" style={{ color: '#50fa7b' }}>
                      {maskKey(apiKey)}
                    </div>
                    <div className="flex-1" />
                    {keyValidation.valid ? (
                      <div className="flex items-center gap-1.5">
                        <Check size={12} className="text-green-400" />
                        <span className="font-pixel text-[8px] tracking-wider text-green-400">{keyValidation.message}</span>
                      </div>
                    ) : keyValidation.message ? (
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={12} className="text-red-400" />
                        <span className="font-pixel text-[8px] tracking-wider text-red-400">{keyValidation.message}</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Hire CEO button */}
              <button
                onClick={handleHireCEO}
                disabled={!keyValidation.valid}
                className="w-full font-pixel text-sm tracking-[0.3em] py-4 rounded-sm border-2 transition-all duration-300"
                style={{
                  borderColor: keyValidation.valid ? gold : `${gold}33`,
                  backgroundColor: keyValidation.valid ? `${gold}1a` : 'transparent',
                  color: keyValidation.valid ? gold : `${gold}4d`,
                  cursor: keyValidation.valid ? 'pointer' : 'not-allowed',
                  boxShadow: keyValidation.valid ? `0 0 30px ${gold}33` : 'none',
                }}
              >
                {'\u25B6'} HIRE CEO
              </button>

              {/* Skip for now */}
              {!showSkipConfirm ? (
                <button
                  onClick={() => setShowSkipConfirm(true)}
                  className="w-full font-pixel text-[9px] tracking-wider py-2 transition-colors"
                  style={{ color: '#71717a' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#a1a1aa')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#71717a')}
                >
                  SKIP FOR NOW {'\u2192'}
                </button>
              ) : (
                <div className="border-2 rounded-sm p-4" style={{ borderColor: '#ffb86c40', backgroundColor: '#ffb86c08' }}>
                  <div className="flex items-start gap-3 mb-3">
                    <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-pixel text-[9px] tracking-wider text-amber-300 mb-1">
                        SKIP API KEY?
                      </div>
                      <div className="font-pixel text-[7px] tracking-wider leading-relaxed" style={{ color: '#a1a1aa' }}>
                        Your CEO will be created but won't be able to make API calls until you add a key in The Vault.
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSkipApiKey}
                      className="flex-1 font-pixel text-[9px] tracking-wider py-2 border rounded-sm transition-colors"
                      style={{ borderColor: '#ffb86c60', color: '#ffb86c', backgroundColor: '#ffb86c10' }}
                    >
                      YES, SKIP
                    </button>
                    <button
                      onClick={() => setShowSkipConfirm(false)}
                      className="flex-1 font-pixel text-[9px] tracking-wider py-2 border rounded-sm transition-colors"
                      style={{ borderColor: '#3a3a5a', color: '#9ca3af' }}
                    >
                      CANCEL
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Activation progress */}
        {phase === 'activating' && (
          <div className="text-center animate-[fadeIn_0.3s_ease-out]">
            <h2
              className="font-pixel text-xl tracking-[0.3em] mb-6"
              style={{ color: gold, textShadow: `0 0 10px ${gold}66` }}
            >
              ACTIVATING CEO
            </h2>

            <div className="max-w-md mx-auto mb-4">
              <div className="w-full h-3 border rounded-sm overflow-hidden bg-black" style={{ borderColor: `${gold}66` }}>
                <div
                  className="h-full transition-all duration-100"
                  style={{
                    width: `${activationProgress}%`,
                    backgroundColor: gold,
                    boxShadow: `0 0 10px ${gold}80`,
                  }}
                />
              </div>
              <div className="font-pixel text-sm tracking-wider mt-2" style={{ color: `${gold}99` }}>
                {ACTIVATION_MESSAGES.slice().reverse().find(m => activationProgress >= m.threshold)?.text}
              </div>
            </div>

            <div className="font-pixel text-base tracking-wider" style={{ color: `${gold}cc` }}>
              {activationProgress}%
            </div>
          </div>
        )}

        {/* Done */}
        {phase === 'done' && (
          <div className="text-center animate-[fadeIn_0.4s_ease-out]">
            <div
              className="font-pixel text-3xl tracking-[0.3em] mb-4"
              style={{ color: gold, textShadow: `0 0 30px ${gold}80, 0 0 60px ${gold}33` }}
            >
              CEO {ceoName.toUpperCase()} IS ONLINE
            </div>
            <div className="font-pixel text-sm tracking-wider" style={{ color: `${gold}99` }}>
              Entering command center...
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
