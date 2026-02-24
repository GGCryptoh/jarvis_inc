/**
 * Marketplace sound system — Web Audio API, zero dependencies.
 * Ported from main app with lower master volume (0.12 vs 0.18).
 */

/**
 * Retro success jingle — ascending arpeggio (C5 → E5 → G5 → C6).
 * Plays when CEO mascot celebrates.
 */
export function playSuccessJingle(): void {
  try {
    const ctx = new AudioContext();
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.12;
    masterGain.connect(ctx.destination);

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

      env.gain.setValueAtTime(0, now + note.start);
      env.gain.linearRampToValueAtTime(note.type === 'square' ? 0.6 : 0.35, now + note.start + 0.02);
      env.gain.setValueAtTime(note.type === 'square' ? 0.6 : 0.35, now + note.start + note.dur - 0.03);
      env.gain.linearRampToValueAtTime(0, now + note.start + note.dur);

      osc.connect(env);
      env.connect(masterGain);

      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.01);
    }

    setTimeout(() => ctx.close(), 1500);
  } catch {
    // Silently fail if Web Audio API isn't available
  }
}

/**
 * Short notification ding — 2-note ascending chime.
 * Plays when new forum posts or feature requests arrive.
 */
export function playNotificationDing(): void {
  try {
    const ctx = new AudioContext();
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.12;
    masterGain.connect(ctx.destination);

    const now = ctx.currentTime;

    // Two-note ascending chime: E5 → A5
    const notes = [
      { freq: 659.25, start: 0, dur: 0.10, type: 'square' as OscillatorType },
      { freq: 880.00, start: 0.08, dur: 0.18, type: 'square' as OscillatorType },
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();

      osc.type = note.type;
      osc.frequency.value = note.freq;

      env.gain.setValueAtTime(0, now + note.start);
      env.gain.linearRampToValueAtTime(0.5, now + note.start + 0.01);
      env.gain.linearRampToValueAtTime(0, now + note.start + note.dur);

      osc.connect(env);
      env.connect(masterGain);

      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.02);
    }

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Silently fail if Web Audio API isn't available
  }
}
