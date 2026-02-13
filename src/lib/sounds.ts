/**
 * Retro success jingle using Web Audio API oscillators.
 * Police Quest / Sierra victory feel — ascending arpeggio with square + triangle waves.
 */
export function playSuccessJingle(): void {
  try {
    const ctx = new AudioContext();
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.18;
    masterGain.connect(ctx.destination);

    // Ascending arpeggio notes (C5 → E5 → G5 → C6) with a final chord
    const notes: Array<{ freq: number; start: number; dur: number; type: OscillatorType }> = [
      // Lead — square wave arpeggio
      { freq: 523.25, start: 0.0,  dur: 0.15, type: 'square' },   // C5
      { freq: 659.25, start: 0.12, dur: 0.15, type: 'square' },   // E5
      { freq: 783.99, start: 0.24, dur: 0.15, type: 'square' },   // G5
      { freq: 1046.5, start: 0.36, dur: 0.35, type: 'square' },   // C6 (held)

      // Harmony — triangle wave, softer
      { freq: 261.63, start: 0.0,  dur: 0.12, type: 'triangle' }, // C4
      { freq: 329.63, start: 0.12, dur: 0.12, type: 'triangle' }, // E4
      { freq: 392.0,  start: 0.24, dur: 0.12, type: 'triangle' }, // G4
      { freq: 523.25, start: 0.36, dur: 0.30, type: 'triangle' }, // C5

      // Final sparkle — high staccato
      { freq: 2093.0, start: 0.50, dur: 0.08, type: 'square' },   // C7
      { freq: 2637.0, start: 0.56, dur: 0.12, type: 'square' },   // E7
    ];

    const now = ctx.currentTime;

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();

      osc.type = note.type;
      osc.frequency.value = note.freq;

      // Envelope: quick attack, sustain, quick release
      env.gain.setValueAtTime(0, now + note.start);
      env.gain.linearRampToValueAtTime(note.type === 'square' ? 0.6 : 0.35, now + note.start + 0.02);
      env.gain.setValueAtTime(note.type === 'square' ? 0.6 : 0.35, now + note.start + note.dur - 0.03);
      env.gain.linearRampToValueAtTime(0, now + note.start + note.dur);

      osc.connect(env);
      env.connect(masterGain);

      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.01);
    }

    // Clean up context after jingle completes
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // Silently fail if Web Audio API isn't available
  }
}

/**
 * Cheeky military march jingle — Cannon Fodder / Amiga inspired.
 * Bouncy square-wave melody over a marching bass with noise snare hits.
 * ~3 seconds, pure Web Audio API synthesis.
 */
export function playWarMarch(): void {
  try {
    const ctx = new AudioContext();
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.16;
    masterGain.connect(ctx.destination);
    const now = ctx.currentTime;

    const BPM = 140;
    const beat = 60 / BPM; // ~0.428s per beat
    const eighth = beat / 2;

    // ── Helper: play a tone ──
    function tone(
      freq: number, start: number, dur: number,
      type: OscillatorType, vol = 0.5
    ) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0, now + start);
      env.gain.linearRampToValueAtTime(vol, now + start + 0.01);
      env.gain.setValueAtTime(vol, now + start + dur - 0.02);
      env.gain.linearRampToValueAtTime(0, now + start + dur);
      osc.connect(env);
      env.connect(masterGain);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.01);
    }

    // ── Helper: noise hit (snare) ──
    function snare(start: number, dur = 0.06) {
      const bufSize = ctx.sampleRate * dur;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      }
      const src = ctx.createBufferSource();
      const env = ctx.createGain();
      src.buffer = buf;
      env.gain.setValueAtTime(0.4, now + start);
      env.gain.linearRampToValueAtTime(0, now + start + dur);
      src.connect(env);
      env.connect(masterGain);
      src.start(now + start);
    }

    // ── Marching bass (triangle wave, root + fifth) ──
    const bassNotes = [
      // Bar 1: C-G-C-G
      { freq: 130.81, start: 0 },            // C3
      { freq: 196.00, start: beat },          // G3
      { freq: 130.81, start: beat * 2 },      // C3
      { freq: 196.00, start: beat * 3 },      // G3
      // Bar 2: F-C-G-G
      { freq: 174.61, start: beat * 4 },      // F3
      { freq: 130.81, start: beat * 5 },      // C3
      { freq: 196.00, start: beat * 6 },      // G3
      { freq: 196.00, start: beat * 7 },      // G3
    ];
    for (const n of bassNotes) {
      tone(n.freq, n.start, beat * 0.8, 'triangle', 0.45);
    }

    // ── Snare on beats 2 & 4 (march feel) ──
    for (let bar = 0; bar < 2; bar++) {
      const offset = bar * beat * 4;
      snare(offset + beat);
      snare(offset + beat * 3);
    }

    // ── Melody: cheeky bouncy lead (square wave) ──
    //    Inspired by that cocky Sensible Software energy
    const melody = [
      // Bar 1: "da-da da-da DA da-da-da"
      { freq: 523.25, start: 0,                    dur: eighth * 0.8 },  // C5
      { freq: 523.25, start: eighth,               dur: eighth * 0.8 },  // C5
      { freq: 659.25, start: eighth * 2,           dur: eighth * 0.8 },  // E5
      { freq: 659.25, start: eighth * 3,           dur: eighth * 0.8 },  // E5
      { freq: 783.99, start: beat * 2,             dur: beat * 0.8 },    // G5 (accent)
      { freq: 659.25, start: beat * 3,             dur: eighth * 0.8 },  // E5
      { freq: 587.33, start: beat * 3 + eighth,    dur: eighth * 0.8 },  // D5
      // Bar 2: "da da-DA da — da-da-DA-DA!"
      { freq: 523.25, start: beat * 4,             dur: eighth * 0.8 },  // C5
      { freq: 587.33, start: beat * 4 + eighth,    dur: eighth * 0.8 },  // D5
      { freq: 659.25, start: beat * 5,             dur: beat * 0.8 },    // E5 (accent)
      { freq: 523.25, start: beat * 6,             dur: eighth * 0.8 },  // C5
      { freq: 783.99, start: beat * 6 + eighth,    dur: eighth * 0.8 },  // G5
      { freq: 880.00, start: beat * 7,             dur: eighth * 0.8 },  // A5
      { freq: 1046.5, start: beat * 7 + eighth,    dur: beat * 0.9 },    // C6 (final!)
    ];
    for (const n of melody) {
      tone(n.freq, n.start, n.dur, 'square', 0.5);
    }

    // ── High sparkle on the final note ──
    tone(2093.0, beat * 7 + eighth + 0.05, 0.15, 'square', 0.2);

    const totalDur = beat * 8 + 500;
    setTimeout(() => ctx.close(), totalDur);
  } catch {
    // Silently fail if Web Audio API isn't available
  }
}

/** Short "system connected" chime — 3 ascending notes, digital feel, ~0.5s */
export function playOnlineJingle() {
  try {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.20;
    master.connect(ctx.destination);

    // 3-note ascending chime: F5 → A5 → C6 (bright, digital)
    const notes = [
      { freq: 698, start: 0, dur: 0.12 },
      { freq: 880, start: 0.10, dur: 0.12 },
      { freq: 1047, start: 0.20, dur: 0.25 },
    ];

    for (const n of notes) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = n.freq;
      env.gain.setValueAtTime(0, ctx.currentTime + n.start);
      env.gain.linearRampToValueAtTime(0.6, ctx.currentTime + n.start + 0.02);
      env.gain.linearRampToValueAtTime(0, ctx.currentTime + n.start + n.dur);
      osc.connect(env);
      env.connect(master);
      osc.start(ctx.currentTime + n.start);
      osc.stop(ctx.currentTime + n.start + n.dur + 0.05);
    }

    // High sparkle on final note
    const sparkle = ctx.createOscillator();
    const sEnv = ctx.createGain();
    sparkle.type = 'triangle';
    sparkle.frequency.value = 2093; // C7
    sEnv.gain.setValueAtTime(0, ctx.currentTime + 0.22);
    sEnv.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.24);
    sEnv.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.45);
    sparkle.connect(sEnv);
    sEnv.connect(master);
    sparkle.start(ctx.currentTime + 0.22);
    sparkle.stop(ctx.currentTime + 0.50);

    setTimeout(() => ctx.close(), 600);
  } catch { /* silent fail */ }
}
