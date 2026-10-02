import type { ModuleKind, WireColor, ButtonColor, StripColor, DiscoColor, HeckleKind } from '../../../games/bomb-squad/shared.ts'

/** Same formula the server uses to judge a button release: whole seconds rounded up, "M:SS". */
export function timerText(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const MODULE_EMOJI: Record<ModuleKind, string> = {
  wires: '🧵',
  button: '🔴',
  glyphs: '👽',
  saywhat: '🗯️',
  wheels: '🔐',
  disco: '🪔',
}

/** Real colours for drawing; names stay plain for saying out loud. */
export const HEX: Record<WireColor | ButtonColor | StripColor | DiscoColor, string> = {
  red: '#ef3b2c',
  blue: '#2f7df6',
  yellow: '#ffd23f',
  green: '#3cbf4a',
  black: '#16130f',
  white: '#ffffff',
  pink: '#ff7ac6',
}

export const HECKLE: Record<HeckleKind, { emoji: string; label: string }> = {
  tick: { emoji: '⏰', label: 'Tick tock' },
  chicken: { emoji: '🐔', label: 'Bawk bawk' },
  airhorn: { emoji: '📯', label: 'Airhorn' },
  popcorn: { emoji: '🍿', label: 'Popcorn' },
  pray: { emoji: '🙏', label: 'Pray' },
  clap: { emoji: '👏', label: 'Slow clap' },
}

export const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)
