import type { TeamColor } from '../../shared/protocol.ts'

/**
 * Literal Tailwind classes per palette colour. Tailwind only ships classes it
 * can see written out in full, so never build `bg-${color}` strings — use this.
 */
export const COLOR: Record<TeamColor, { bg: string; soft: string; text: string; border: string; fill: string }> = {
  tomato: { bg: 'bg-tomato', soft: 'bg-tomato-soft', text: 'text-tomato', border: 'border-tomato', fill: 'fill-tomato' },
  sky: { bg: 'bg-sky', soft: 'bg-sky-soft', text: 'text-sky', border: 'border-sky', fill: 'fill-sky' },
  lime: { bg: 'bg-lime', soft: 'bg-lime-soft', text: 'text-lime', border: 'border-lime', fill: 'fill-lime' },
  grape: { bg: 'bg-grape', soft: 'bg-grape-soft', text: 'text-grape', border: 'border-grape', fill: 'fill-grape' },
  sun: { bg: 'bg-sun', soft: 'bg-sun-soft', text: 'text-sun', border: 'border-sun', fill: 'fill-sun' },
  bubblegum: { bg: 'bg-bubblegum', soft: 'bg-bubblegum-soft', text: 'text-bubblegum', border: 'border-bubblegum', fill: 'fill-bubblegum' },
}

export const PALETTE: TeamColor[] = ['tomato', 'sky', 'lime', 'grape', 'sun', 'bubblegum']

/** CSS value for inline styles: `style={{ background: colorVar('sky') }}`. */
export function colorVar(color: TeamColor | 'ink' | 'paper', soft = false): string {
  return `var(--color-${color}${soft && color !== 'ink' && color !== 'paper' ? '-soft' : ''})`
}
