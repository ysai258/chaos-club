/**
 * Haptics and sound. Both are best-effort: no vibration API on iOS Safari,
 * no audio until the first user gesture. Mute is persisted per device.
 */
import { useSyncExternalStore } from 'react'

// ---------------------------------------------------------------- haptics

export type HapticKind = 'tap' | 'success' | 'error' | 'buzz' | 'heavy'

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,
  success: [12, 40, 18],
  error: [40, 30, 40],
  buzz: [80, 40, 80, 40, 120],
  heavy: 35,
}

export function haptic(kind: HapticKind = 'tap'): void {
  if (isMuted()) return
  try {
    navigator.vibrate?.(PATTERNS[kind])
  } catch {
    /* unsupported */
  }
}

export function useHaptics() {
  return haptic
}

// ---------------------------------------------------------------- mute store

const MUTE_KEY = 'chaos:muted'
const listeners = new Set<() => void>()
let muted = readMuted()

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function isMuted(): boolean {
  return muted
}

export function setMuted(next: boolean): void {
  muted = next
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  } catch {
    /* private mode */
  }
  for (const l of listeners) l()
}

export function useMuted(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => muted,
    () => false,
  )
  return [value, setMuted]
}

// ---------------------------------------------------------------- sound

export type SoundName = 'tap' | 'pop' | 'success' | 'error' | 'tick' | 'boom' | 'win' | 'buzz' | 'whoosh' | 'ding'

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  ctx ??= new AC()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(
  ac: AudioContext,
  { freq, to, type = 'square', dur = 0.08, at = 0, vol = 0.12 }: { freq: number; to?: number; type?: OscillatorType; dur?: number; at?: number; vol?: number },
): void {
  const t0 = ac.currentTime + at
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  gain.gain.setValueAtTime(vol, t0)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(gain).connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function noise(ac: AudioContext, dur: number, vol: number): void {
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2
  const src = ac.createBufferSource()
  const filter = ac.createBiquadFilter()
  const gain = ac.createGain()
  filter.type = 'lowpass'
  filter.frequency.value = 900
  gain.gain.value = vol
  src.buffer = buf
  src.connect(filter).connect(gain).connect(ac.destination)
  src.start()
}

export function playSound(name: SoundName): void {
  if (muted) return
  const ac = audio()
  if (!ac) return
  try {
    switch (name) {
      case 'tap':
        return tone(ac, { freq: 520, dur: 0.04, vol: 0.06 })
      case 'pop':
        return tone(ac, { freq: 300, to: 900, type: 'sine', dur: 0.1, vol: 0.18 })
      case 'tick':
        return tone(ac, { freq: 1400, dur: 0.025, vol: 0.05 })
      case 'ding':
        return tone(ac, { freq: 1320, type: 'sine', dur: 0.35, vol: 0.15 })
      case 'success':
        ;[523, 659, 784].forEach((f, i) => tone(ac, { freq: f, type: 'triangle', dur: 0.12, at: i * 0.08, vol: 0.14 }))
        return
      case 'win':
        ;[523, 659, 784, 1047].forEach((f, i) => tone(ac, { freq: f, type: 'square', dur: i === 3 ? 0.4 : 0.12, at: i * 0.11, vol: 0.09 }))
        return
      case 'error':
        return tone(ac, { freq: 180, to: 120, type: 'sawtooth', dur: 0.22, vol: 0.1 })
      case 'buzz':
        return tone(ac, { freq: 110, type: 'sawtooth', dur: 0.5, vol: 0.12 })
      case 'whoosh':
        return tone(ac, { freq: 200, to: 1200, type: 'sine', dur: 0.18, vol: 0.08 })
      case 'boom':
        noise(ac, 0.7, 0.6)
        return tone(ac, { freq: 90, to: 30, type: 'sine', dur: 0.6, vol: 0.4 })
    }
  } catch {
    /* audio is a nicety */
  }
}

export function useSound() {
  const [isMutedNow, set] = useMuted()
  return { play: playSound, muted: isMutedNow, setMuted: set, toggle: () => set(!isMutedNow) }
}

// ---------------------------------------------------------------- confetti

/** Burst of confetti in the palette colours. Lazy-loads canvas-confetti. */
export async function celebrate(intensity: 'small' | 'big' = 'big'): Promise<void> {
  const { default: confetti } = await import('canvas-confetti')
  const colors = ['#ff5a36', '#38b6ff', '#9be15d', '#a77bff', '#ffd23f', '#ff7ac6']
  if (intensity === 'small') {
    void confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 }, colors, disableForReducedMotion: true })
    return
  }
  const end = Date.now() + 1200
  const frame = () => {
    void confetti({ particleCount: 5, angle: 60, spread: 60, origin: { x: 0, y: 0.75 }, colors, disableForReducedMotion: true })
    void confetti({ particleCount: 5, angle: 120, spread: 60, origin: { x: 1, y: 0.75 }, colors, disableForReducedMotion: true })
    if (Date.now() < end) requestAnimationFrame(frame)
  }
  frame()
}
