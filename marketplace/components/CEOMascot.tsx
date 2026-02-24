'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Phases:
 * - hidden: not visible
 * - enter-left / enter-right: walking in from left or right edge
 * - dance: doing a move at center (celebrate, wave, moonwalk, spin)
 * - idle: gentle bob at center
 * - exit-left / exit-right: walking off-screen
 */
type Phase =
  | 'hidden'
  | 'enter-left' | 'enter-right'
  | 'dance'
  | 'idle'
  | 'exit-left' | 'exit-right';

type DanceMove = 'celebrate' | 'wave' | 'jump' | 'spin';

const DANCE_MOVES: DanceMove[] = ['celebrate', 'wave', 'jump', 'spin'];

// Random int between min and max (inclusive)
function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function CEOMascot() {
  const [phase, setPhase] = useState<Phase>('hidden');
  const [dance, setDance] = useState<DanceMove>('celebrate');
  const [facingRight, setFacingRight] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cycleCountRef = useRef(0);

  const scheduleExit = useCallback(() => {
    // After idling 20-40s, walk off screen
    const idleTime = rand(20_000, 40_000);
    timerRef.current = setTimeout(() => {
      const exitDir = Math.random() > 0.5 ? 'exit-right' : 'exit-left';
      setFacingRight(exitDir === 'exit-right');
      setPhase(exitDir);

      // After exit animation (2.5s), go hidden, then schedule re-entrance
      timerRef.current = setTimeout(() => {
        setPhase('hidden');
        scheduleEntrance();
      }, 2500);
    }, idleTime);
  }, []);

  const scheduleEntrance = useCallback(() => {
    // Wait 45-120s before coming back
    const waitTime = rand(45_000, 120_000);
    timerRef.current = setTimeout(() => {
      cycleCountRef.current++;
      const enterDir = Math.random() > 0.5 ? 'enter-right' : 'enter-left';
      setFacingRight(enterDir === 'enter-left'); // face toward center
      setPhase(enterDir);

      // After walk-in (3s), do a dance
      timerRef.current = setTimeout(() => {
        const move = pickRandom(DANCE_MOVES);
        setDance(move);
        setPhase('dance');
        if (move === 'celebrate') {
          window.dispatchEvent(new Event('ceo-mascot-celebrate'));
        }

        // After dance (2.5s), settle to idle
        timerRef.current = setTimeout(() => {
          setPhase('idle');
          scheduleExit();
        }, 2500);
      }, 3000);
    }, waitTime);
  }, [scheduleExit]);

  useEffect(() => {
    // First entrance: 5s delay (or instant if returning visitor)
    const played = sessionStorage.getItem('ceo_mascot_played');
    const delay = played ? 2000 : 5000;

    timerRef.current = setTimeout(() => {
      setFacingRight(true);
      setPhase('enter-left');

      // After walk-in (3s), celebrate
      timerRef.current = setTimeout(() => {
        setDance('celebrate');
        setPhase('dance');
        window.dispatchEvent(new Event('ceo-mascot-celebrate'));

        // After celebration (2.5s), settle to idle then start cycle
        timerRef.current = setTimeout(() => {
          setPhase('idle');
          sessionStorage.setItem('ceo_mascot_played', '1');
          scheduleExit();
        }, 2500);
      }, 3000);
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [scheduleExit]);

  if (phase === 'hidden') return null;

  const gold = '#f1fa8c';
  const green = '#50fa7b';
  const skinTone = '#ffdbb4';
  const isMoving = phase.startsWith('enter') || phase.startsWith('exit');

  // Build CSS class for current phase
  let phaseClass = '';
  if (phase === 'enter-left') phaseClass = 'ceo-mascot-enter-left';
  else if (phase === 'enter-right') phaseClass = 'ceo-mascot-enter-right';
  else if (phase === 'exit-left') phaseClass = 'ceo-mascot-exit-left';
  else if (phase === 'exit-right') phaseClass = 'ceo-mascot-exit-right';
  else if (phase === 'dance') phaseClass = `ceo-mascot-dance-${dance}`;
  else phaseClass = 'ceo-mascot-idle';

  return (
    <div className="ceo-mascot-container">
      <div
        className={`ceo-mascot ${phaseClass}`}
        style={{ transform: facingRight ? undefined : 'scaleX(-1)' }}
      >
        {/* Crown */}
        <div className="text-center" style={{ fontSize: '18px', lineHeight: '20px', color: gold, textShadow: `0 0 8px ${gold}66` }}>
          ♛
        </div>

        {/* Hair */}
        <div
          className="mx-auto rounded-t-sm"
          style={{ width: 32, height: 13, backgroundColor: green }}
        />

        {/* Head */}
        <div
          className="mx-auto rounded-sm relative"
          style={{ width: 32, height: 25, backgroundColor: skinTone }}
        >
          {/* Eyes */}
          <div className="absolute rounded-[0.5px] bg-black" style={{ top: 8, left: 7, width: 5, height: 5 }} />
          <div className="absolute rounded-[0.5px] bg-black" style={{ top: 8, right: 7, width: 5, height: 5 }} />
          {/* Mouth */}
          <div className="absolute left-1/2 -translate-x-1/2 bg-black/40 rounded-full" style={{ bottom: 5, width: 8, height: 2 }} />
        </div>

        {/* Body — arms + torso */}
        <div className="flex justify-center">
          {/* Left arm */}
          <div
            className={`rounded-b-sm mt-[2px] ${phase === 'dance' && dance === 'wave' ? 'ceo-arm-wave' : ''}`}
            style={{ width: 7, height: 24, backgroundColor: green, filter: 'brightness(0.85)' }}
          />

          {/* Torso */}
          <div className="relative" style={{ width: 32, height: 32, backgroundColor: green, borderRadius: 2 }}>
            {/* Lapels */}
            <div
              className="absolute rounded-sm"
              style={{ inset: '0 7px 4px 7px', backgroundColor: 'rgba(0,0,0,0.15)' }}
            />
            {/* Tie */}
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{ top: 0, width: 5, height: 24, backgroundColor: gold }}
            />
          </div>

          {/* Right arm */}
          <div
            className={`rounded-b-sm mt-[2px] ${phase === 'dance' && dance === 'wave' ? 'ceo-arm-wave-right' : ''}`}
            style={{ width: 7, height: 24, backgroundColor: green, filter: 'brightness(0.85)' }}
          />
        </div>

        {/* Legs */}
        <div className="flex justify-center gap-[7px]">
          <div
            className={`bg-slate-700 rounded-b-sm ${isMoving ? 'ceo-leg-walk-left' : ''}`}
            style={{ width: 13, height: 18 }}
          />
          <div
            className={`bg-slate-700 rounded-b-sm ${isMoving ? 'ceo-leg-walk-right' : ''}`}
            style={{ width: 13, height: 18 }}
          />
        </div>

        {/* Nametag — flip back so text reads correctly when sprite is mirrored */}
        <div className="text-center mt-1" style={facingRight ? undefined : { transform: 'scaleX(-1)' }}>
          <span
            className="font-pixel text-[8px] tracking-wider whitespace-nowrap"
            style={{ color: gold, textShadow: `1px 1px 0 rgba(0,0,0,0.8), 0 0 4px ${gold}44` }}
          >
            JARVIS CEO
          </span>
        </div>
      </div>
    </div>
  );
}
