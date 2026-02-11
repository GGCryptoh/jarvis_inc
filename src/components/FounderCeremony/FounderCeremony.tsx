import { useState, useEffect, useRef } from 'react';
import { setSetting, saveMission } from '../../lib/database';

interface FounderCeremonyProps {
  onComplete: () => void;
}

type Phase =
  | 'boot'
  | 'scan'
  | 'welcome'
  | 'form'
  | 'activating'
  | 'done';

const BOOT_LINES = [
  { text: 'JARVIS SYSTEMS v0.1.0', delay: 0 },
  { text: 'Initializing core modules...', delay: 600 },
  { text: '[OK] Neural engine online', delay: 1200 },
  { text: '[OK] Agent framework loaded', delay: 1700 },
  { text: '[OK] Surveillance grid mapped', delay: 2200 },
  { text: '[OK] Financial ledger zeroed', delay: 2600 },
  { text: '[OK] Audit log initialized', delay: 3000 },
  { text: '[OK] Vault encryption active', delay: 3400 },
  { text: '', delay: 3800 },
  { text: 'Scanning for founder credentials...', delay: 2000 },
  { text: '> No founder detected.', delay: 3200 },
];

const SCAN_BLOCK = [
  '╔══════════════════════════════════════╗',
  '║  FOUNDER REGISTRATION REQUIRED       ║',
  '║  Please identify yourself to proceed ║',
  '╚══════════════════════════════════════╝',
];

export default function FounderCeremony({ onComplete }: FounderCeremonyProps) {
  const [phase, setPhase] = useState<Phase>('boot');
  const [visibleLines, setVisibleLines] = useState<string[]>([]);
  const [showScanBlock, setShowScanBlock] = useState(false);
  const [founderName, setFounderName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [activationProgress, setActivationProgress] = useState(0);
  const [showCursor, setShowCursor] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Blinking cursor
  useEffect(() => {
    const interval = setInterval(() => setShowCursor((c) => !c), 530);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [visibleLines, showScanBlock]);

  // Phase: boot — reveal lines one by one
  useEffect(() => {
    if (phase !== 'boot') return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    BOOT_LINES.forEach(({ text, delay }) => {
      timers.push(
        setTimeout(() => {
          setVisibleLines((prev) => [...prev, text]);
        }, delay),
      );
    });
    // Transition to scan
    timers.push(setTimeout(() => setPhase('scan'), 5600));
    return () => timers.forEach(clearTimeout);
  }, [phase]);

  // Phase: scan — show registration box as a single block
  useEffect(() => {
    if (phase !== 'scan') return;
    const t1 = setTimeout(() => setShowScanBlock(true), 200);
    const t2 = setTimeout(() => setPhase('welcome'), 3800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [phase]);

  // Phase: welcome → form after delay (extra time to read the text)
  useEffect(() => {
    if (phase !== 'welcome') return;
    const t = setTimeout(() => setPhase('form'), 4500);
    return () => clearTimeout(t);
  }, [phase]);

  // Phase: activating — progress bar
  useEffect(() => {
    if (phase !== 'activating') return;
    const interval = setInterval(() => {
      setActivationProgress((p) => {
        if (p >= 100) {
          clearInterval(interval);
          return 100;
        }
        return p + 2;
      });
    }, 40);
    return () => clearInterval(interval);
  }, [phase]);

  // When activation hits 100, persist and transition
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

  function handleActivate() {
    if (!founderName.trim() || !orgName.trim()) return;
    const name = founderName.trim();
    // Write to SQLite
    setSetting('founder_name', name);
    setSetting('org_name', orgName.trim());
    setSetting('created_at', new Date().toISOString());
    // Seed milestone mission
    saveMission({
      id: 'mission-founder-ceremony',
      title: 'Register Founder & Initialize Systems',
      status: 'done',
      assignee: name,
      priority: 'critical',
      created_by: name,
      created_at: new Date().toISOString(),
      due_date: null,
    });
    setPhase('activating');
  }

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center z-[100] overflow-hidden">
      {/* Scanline overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-10 opacity-[0.04]"
        style={{
          background:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.1) 2px, rgba(0,255,136,0.1) 4px)',
        }}
      />

      {/* Corner vignette */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)',
        }}
      />

      <div className="relative z-20 w-full max-w-2xl px-8">
        {/* Terminal phase */}
        {(phase === 'boot' || phase === 'scan') && (
          <div
            ref={terminalRef}
            className="font-mono text-lg leading-relaxed text-pixel-green max-h-[70vh] overflow-y-auto"
            style={{ textShadow: '0 0 6px rgba(0,255,136,0.4)' }}
          >
            {visibleLines.map((line, i) => (
              <div key={i} className={line === '' ? 'h-3' : ''}>
                {line}
              </div>
            ))}
            {phase === 'scan' && showScanBlock && (
              <pre
                className="mt-4 text-pixel-yellow animate-[fadeIn_0.4s_ease-out] leading-snug"
                style={{ fontFamily: '"Courier New", Courier, monospace', fontSize: 'inherit' }}
              >{SCAN_BLOCK.join('\n')}</pre>
            )}
            <span className={`inline-block w-2 h-4 bg-pixel-green ${showCursor ? 'opacity-100' : 'opacity-0'}`} />
          </div>
        )}

        {/* Welcome text */}
        {phase === 'welcome' && (
          <div className="text-center animate-[fadeIn_1s_ease-out]">
            <h1
              className="font-pixel text-4xl text-pixel-green tracking-wider mb-6"
              style={{ textShadow: '0 0 20px rgba(0,255,136,0.3), 0 0 40px rgba(0,255,136,0.1)' }}
            >
              WELCOME, FOUNDER.
            </h1>
            <p className="font-pixel text-sm text-pixel-green/60 tracking-wider leading-relaxed">
              You are about to activate your autonomous AI workforce.
              <br />
              This system requires a human commander.
              <br />
              That&apos;s you.
            </p>
          </div>
        )}

        {/* Registration form */}
        {phase === 'form' && (
          <div className="animate-[fadeIn_0.6s_ease-out]">
            <h1
              className="font-pixel text-3xl text-pixel-green tracking-wider mb-8 text-center"
              style={{ textShadow: '0 0 20px rgba(0,255,136,0.3)' }}
            >
              FOUNDER REGISTRATION
            </h1>

            <div className="space-y-6 max-w-md mx-auto">
              {/* Founder name */}
              <div>
                <label className="block font-pixel text-xs text-pixel-green/70 tracking-widest mb-2">
                  YOUR CALLSIGN
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-pixel text-sm text-pixel-green/40">{'>'}</span>
                  <input
                    type="text"
                    value={founderName}
                    onChange={(e) => setFounderName(e.target.value)}
                    placeholder="Enter your name"
                    maxLength={30}
                    autoFocus
                    className="w-full bg-black border-2 border-pixel-green/30 text-pixel-green font-pixel text-base tracking-wider px-7 py-3 rounded-sm focus:outline-none focus:border-pixel-green/70 placeholder:text-pixel-green/20 transition-colors"
                    style={{ textShadow: '0 0 4px rgba(0,255,136,0.3)' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const next = document.getElementById('org-input');
                        next?.focus();
                      }
                    }}
                  />
                </div>
              </div>

              {/* Organization name */}
              <div>
                <label className="block font-pixel text-xs text-pixel-green/70 tracking-widest mb-2">
                  ORGANIZATION CODENAME
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-pixel text-sm text-pixel-green/40">{'>'}</span>
                  <input
                    id="org-input"
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Enter org name"
                    maxLength={40}
                    className="w-full bg-black border-2 border-pixel-green/30 text-pixel-green font-pixel text-base tracking-wider px-7 py-3 rounded-sm focus:outline-none focus:border-pixel-green/70 placeholder:text-pixel-green/20 transition-colors"
                    style={{ textShadow: '0 0 4px rgba(0,255,136,0.3)' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleActivate();
                    }}
                  />
                </div>
              </div>

              {/* Activate button */}
              <button
                onClick={handleActivate}
                disabled={!founderName.trim() || !orgName.trim()}
                className={`w-full font-pixel text-sm tracking-[0.3em] py-4 rounded-sm border-2 transition-all duration-300 ${
                  founderName.trim() && orgName.trim()
                    ? 'bg-pixel-green/10 border-pixel-green text-pixel-green hover:bg-pixel-green/20 hover:shadow-[0_0_30px_rgba(0,255,136,0.2)] cursor-pointer'
                    : 'bg-transparent border-pixel-green/20 text-pixel-green/30 cursor-not-allowed'
                }`}
              >
                ▶ ACTIVATE JARVIS
              </button>

              <p className="font-pixel text-[10px] text-pixel-green/30 text-center tracking-wider leading-relaxed">
                By activating, you accept full command responsibility
                <br />
                for all autonomous agent operations.
              </p>
            </div>
          </div>
        )}

        {/* Activation progress */}
        {phase === 'activating' && (
          <div className="text-center animate-[fadeIn_0.3s_ease-out]">
            <h2
              className="font-pixel text-xl text-pixel-green tracking-[0.3em] mb-6"
              style={{ textShadow: '0 0 10px rgba(0,255,136,0.4)' }}
            >
              ACTIVATING SYSTEMS
            </h2>

            {/* Progress bar */}
            <div className="max-w-md mx-auto mb-4">
              <div className="w-full h-3 border border-pixel-green/40 rounded-sm overflow-hidden bg-black">
                <div
                  className="h-full bg-pixel-green transition-all duration-100"
                  style={{
                    width: `${activationProgress}%`,
                    boxShadow: '0 0 10px rgba(0,255,136,0.5)',
                  }}
                />
              </div>
              <div className="font-pixel text-sm text-pixel-green/60 tracking-wider mt-2">
                {activationProgress < 30
                  ? 'Provisioning agent fleet...'
                  : activationProgress < 60
                    ? 'Calibrating surveillance grid...'
                    : activationProgress < 90
                      ? 'Encrypting vault...'
                      : 'Systems online.'}
              </div>
            </div>

            <div className="font-pixel text-base text-pixel-green/80 tracking-wider">
              {activationProgress}%
            </div>
          </div>
        )}

        {/* Done — brief flash */}
        {phase === 'done' && (
          <div className="text-center animate-[fadeIn_0.4s_ease-out]">
            <div
              className="font-pixel text-3xl text-pixel-green tracking-[0.3em] mb-4"
              style={{ textShadow: '0 0 30px rgba(0,255,136,0.5), 0 0 60px rgba(0,255,136,0.2)' }}
            >
              SYSTEMS ONLINE
            </div>
            <div className="font-pixel text-sm text-pixel-green/60 tracking-wider">
              Welcome aboard, {founderName.toUpperCase()}. Entering command center...
            </div>
          </div>
        )}
      </div>

      {/* CSS for fadeIn */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
