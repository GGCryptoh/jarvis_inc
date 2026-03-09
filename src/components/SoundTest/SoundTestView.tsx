import { useState, useEffect, useCallback, useRef } from 'react'
import { Volume2, VolumeX, SkipBack, SkipForward, Play, Square } from 'lucide-react'

// ── Sound registry ──────────────────────────────────────────
// Each entry wraps a jingle in a start/stop interface so we can
// cancel mid-play via AudioContext.close().
interface SoundEntry {
  id: string
  name: string
  description: string
  duration: string
}

const SOUNDS: SoundEntry[] = [
  {
    id: 'success-jingle',
    name: 'Success Jingle',
    description: 'Police Quest / Sierra ascending arpeggio — square + triangle waves',
    duration: '~1.5s',
  },
  {
    id: 'war-march',
    name: 'War March',
    description: 'Cannon Fodder-inspired cheeky military march — bouncy melody, marching bass, snare hits',
    duration: '~3.4s',
  },
]

// Duplicated synthesis logic so we can capture the AudioContext for stop/pause
function createSuccessJingle(): AudioContext {
  const ctx = new AudioContext()
  const masterGain = ctx.createGain()
  masterGain.gain.value = 0.18
  masterGain.connect(ctx.destination)

  const notes: Array<{ freq: number; start: number; dur: number; type: OscillatorType }> = [
    { freq: 523.25, start: 0.0, dur: 0.15, type: 'square' },
    { freq: 659.25, start: 0.12, dur: 0.15, type: 'square' },
    { freq: 783.99, start: 0.24, dur: 0.15, type: 'square' },
    { freq: 1046.5, start: 0.36, dur: 0.35, type: 'square' },
    { freq: 261.63, start: 0.0, dur: 0.12, type: 'triangle' },
    { freq: 329.63, start: 0.12, dur: 0.12, type: 'triangle' },
    { freq: 392.0, start: 0.24, dur: 0.12, type: 'triangle' },
    { freq: 523.25, start: 0.36, dur: 0.3, type: 'triangle' },
    { freq: 2093.0, start: 0.5, dur: 0.08, type: 'square' },
    { freq: 2637.0, start: 0.56, dur: 0.12, type: 'square' },
  ]

  const now = ctx.currentTime
  for (const note of notes) {
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = note.type
    osc.frequency.value = note.freq
    env.gain.setValueAtTime(0, now + note.start)
    env.gain.linearRampToValueAtTime(note.type === 'square' ? 0.6 : 0.35, now + note.start + 0.02)
    env.gain.setValueAtTime(note.type === 'square' ? 0.6 : 0.35, now + note.start + note.dur - 0.03)
    env.gain.linearRampToValueAtTime(0, now + note.start + note.dur)
    osc.connect(env)
    env.connect(masterGain)
    osc.start(now + note.start)
    osc.stop(now + note.start + note.dur + 0.01)
  }

  return ctx
}

function createWarMarch(): AudioContext {
  const ctx = new AudioContext()
  const masterGain = ctx.createGain()
  masterGain.gain.value = 0.16
  masterGain.connect(ctx.destination)
  const now = ctx.currentTime

  const BPM = 140
  const beat = 60 / BPM
  const eighth = beat / 2

  function tone(freq: number, start: number, dur: number, type: OscillatorType, vol = 0.5) {
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    env.gain.setValueAtTime(0, now + start)
    env.gain.linearRampToValueAtTime(vol, now + start + 0.01)
    env.gain.setValueAtTime(vol, now + start + dur - 0.02)
    env.gain.linearRampToValueAtTime(0, now + start + dur)
    osc.connect(env)
    env.connect(masterGain)
    osc.start(now + start)
    osc.stop(now + start + dur + 0.01)
  }

  function snare(start: number, dur = 0.06) {
    const bufSize = ctx.sampleRate * dur
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize)
    }
    const src = ctx.createBufferSource()
    const env = ctx.createGain()
    src.buffer = buf
    env.gain.setValueAtTime(0.4, now + start)
    env.gain.linearRampToValueAtTime(0, now + start + dur)
    src.connect(env)
    env.connect(masterGain)
    src.start(now + start)
  }

  const bassNotes = [
    { freq: 130.81, start: 0 }, { freq: 196.0, start: beat },
    { freq: 130.81, start: beat * 2 }, { freq: 196.0, start: beat * 3 },
    { freq: 174.61, start: beat * 4 }, { freq: 130.81, start: beat * 5 },
    { freq: 196.0, start: beat * 6 }, { freq: 196.0, start: beat * 7 },
  ]
  for (const n of bassNotes) tone(n.freq, n.start, beat * 0.8, 'triangle', 0.45)

  for (let bar = 0; bar < 2; bar++) {
    const offset = bar * beat * 4
    snare(offset + beat)
    snare(offset + beat * 3)
  }

  const melody = [
    { freq: 523.25, start: 0, dur: eighth * 0.8 },
    { freq: 523.25, start: eighth, dur: eighth * 0.8 },
    { freq: 659.25, start: eighth * 2, dur: eighth * 0.8 },
    { freq: 659.25, start: eighth * 3, dur: eighth * 0.8 },
    { freq: 783.99, start: beat * 2, dur: beat * 0.8 },
    { freq: 659.25, start: beat * 3, dur: eighth * 0.8 },
    { freq: 587.33, start: beat * 3 + eighth, dur: eighth * 0.8 },
    { freq: 523.25, start: beat * 4, dur: eighth * 0.8 },
    { freq: 587.33, start: beat * 4 + eighth, dur: eighth * 0.8 },
    { freq: 659.25, start: beat * 5, dur: beat * 0.8 },
    { freq: 523.25, start: beat * 6, dur: eighth * 0.8 },
    { freq: 783.99, start: beat * 6 + eighth, dur: eighth * 0.8 },
    { freq: 880.0, start: beat * 7, dur: eighth * 0.8 },
    { freq: 1046.5, start: beat * 7 + eighth, dur: beat * 0.9 },
  ]
  for (const n of melody) tone(n.freq, n.start, n.dur, 'square', 0.5)
  tone(2093.0, beat * 7 + eighth + 0.05, 0.15, 'square', 0.2)

  return ctx
}

const CREATORS: Record<string, () => AudioContext> = {
  'success-jingle': createSuccessJingle,
  'war-march': createWarMarch,
}

// ── Component ───────────────────────────────────────────────
export default function SoundTestView() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)

  const current = SOUNDS[currentIndex]

  const stop = useCallback(() => {
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {})
      ctxRef.current = null
    }
    setPlaying(false)
    setPaused(false)
  }, [])

  const play = useCallback(() => {
    stop()
    const creator = CREATORS[SOUNDS[currentIndex].id]
    if (!creator) return
    const ctx = creator()
    ctxRef.current = ctx
    setPlaying(true)
    setPaused(false)

    // Auto-stop when context finishes (rough timer)
    const checkInterval = setInterval(() => {
      if (ctx.state === 'closed') {
        clearInterval(checkInterval)
        if (ctxRef.current === ctx) {
          setPlaying(false)
          setPaused(false)
          ctxRef.current = null
        }
      }
    }, 200)
  }, [currentIndex, stop])

  const togglePause = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx || !playing) return
    if (ctx.state === 'running') {
      ctx.suspend()
      setPaused(true)
    } else if (ctx.state === 'suspended') {
      ctx.resume()
      setPaused(false)
    }
  }, [playing])

  const prev = useCallback(() => {
    stop()
    setCurrentIndex(i => (i - 1 + SOUNDS.length) % SOUNDS.length)
  }, [stop])

  const next = useCallback(() => {
    stop()
    setCurrentIndex(i => (i + 1) % SOUNDS.length)
  }, [stop])

  // Keyboard controls
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); stop() }
      if (e.key === ' ') { e.preventDefault(); playing ? togglePause() : play() }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); next() }
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); prev() }
      if (e.key === 'Enter') { e.preventDefault(); play() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [stop, play, togglePause, next, prev, playing])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {})
      }
    }
  }, [])

  return (
    <div className="h-full flex items-center justify-center bg-black p-8">
      <div className="w-full max-w-lg">
        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="font-pixel text-pixel-green text-[10px] tracking-widest mb-2">
            SOUND TEST
          </h1>
          <p className="text-[8px] font-pixel text-pixel-green/50 tracking-wider">
            WEB AUDIO API SYNTHESIZER
          </p>
        </div>

        {/* CRT-style player card */}
        <div className="retro-window">
          <div className="retro-window-title">
            <span className="font-pixel text-[8px]">JINGLE PLAYER</span>
            <span className="font-pixel text-[8px] text-pixel-green/60">
              {currentIndex + 1} / {SOUNDS.length}
            </span>
          </div>
          <div className="retro-window-body p-6">
            {/* Track info */}
            <div className="retro-inset p-4 mb-6">
              <div className="font-pixel text-pixel-green text-[10px] mb-2">
                {current.name}
              </div>
              <div className="font-pixel text-pixel-green/60 text-[7px] leading-relaxed">
                {current.description}
              </div>
              <div className="font-pixel text-pixel-cyan text-[7px] mt-2">
                Duration: {current.duration}
              </div>
            </div>

            {/* Status indicator */}
            <div className="text-center mb-6">
              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded font-pixel text-[8px] ${
                playing && !paused
                  ? 'bg-pixel-green/20 text-pixel-green'
                  : paused
                    ? 'bg-yellow-500/20 text-yellow-400'
                    : 'bg-jarvis-surface text-jarvis-muted'
              }`}>
                {playing && !paused ? (
                  <><Volume2 size={12} className="animate-pulse" /> PLAYING</>
                ) : paused ? (
                  <><VolumeX size={12} /> PAUSED</>
                ) : (
                  <><VolumeX size={12} /> STOPPED</>
                )}
              </div>
            </div>

            {/* Transport controls */}
            <div className="flex items-center justify-center gap-3">
              <button onClick={prev} className="retro-button px-3 py-2" title="Previous (P)">
                <SkipBack size={14} />
              </button>

              <button
                onClick={playing ? togglePause : play}
                className="retro-button px-5 py-2"
                title={playing ? 'Pause (Space)' : 'Play (Space / Enter)'}
              >
                {playing && !paused ? (
                  <div className="flex gap-1">
                    <div className="w-[3px] h-[14px] bg-current" />
                    <div className="w-[3px] h-[14px] bg-current" />
                  </div>
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
              </button>

              <button onClick={stop} className="retro-button px-3 py-2" title="Stop (Esc)">
                <Square size={14} fill="currentColor" />
              </button>

              <button onClick={next} className="retro-button px-3 py-2" title="Next (N)">
                <SkipForward size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Keyboard legend */}
        <div className="mt-6 retro-inset p-4">
          <div className="font-pixel text-[7px] text-pixel-green/50 text-center tracking-wider mb-3">
            KEYBOARD CONTROLS
          </div>
          <div className="grid grid-cols-2 gap-y-1 gap-x-6 font-pixel text-[7px]">
            <div className="text-pixel-cyan text-right">SPACE</div>
            <div className="text-pixel-green/70">Play / Pause</div>
            <div className="text-pixel-cyan text-right">ENTER</div>
            <div className="text-pixel-green/70">Play</div>
            <div className="text-pixel-cyan text-right">ESC</div>
            <div className="text-pixel-green/70">Stop</div>
            <div className="text-pixel-cyan text-right">N</div>
            <div className="text-pixel-green/70">Next track</div>
            <div className="text-pixel-cyan text-right">P</div>
            <div className="text-pixel-green/70">Previous track</div>
          </div>
        </div>

        {/* Track list */}
        <div className="mt-4 retro-inset p-4">
          <div className="font-pixel text-[7px] text-pixel-green/50 text-center tracking-wider mb-3">
            ALL TRACKS
          </div>
          {SOUNDS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => { stop(); setCurrentIndex(i) }}
              className={`w-full text-left px-2 py-1 rounded font-pixel text-[8px] transition-colors ${
                i === currentIndex
                  ? 'bg-pixel-green/20 text-pixel-green'
                  : 'text-pixel-green/50 hover:text-pixel-green hover:bg-pixel-green/10'
              }`}
            >
              {i + 1}. {s.name} <span className="text-pixel-cyan">{s.duration}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
