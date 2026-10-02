/** Pure helpers for Overheard: codes, clue checks, word matching. */
import type { Digit } from './shared.ts'

export function makeCode(random: () => number): Digit[] {
  const pool: Digit[] = [1, 2, 3, 4]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = pool[i]!
    pool[i] = pool[j]!
    pool[j] = a
  }
  return pool.slice(0, 3)
}

export function pickDistinct<T>(items: readonly T[], n: number, random: () => number): T[] {
  const copy = [...items]
  const out: T[] = []
  while (out.length < n && copy.length > 0) {
    const i = Math.floor(random() * copy.length)
    out.push(copy.splice(i, 1)[0]!)
  }
  return out
}

export function isDigit(v: unknown): v is Digit {
  return v === 1 || v === 2 || v === 3 || v === 4
}

/** Three distinct digits 1–4. */
export function parseCode(v: unknown): Digit[] | null {
  if (!Array.isArray(v) || v.length !== 3) return null
  if (!v.every(isDigit)) return null
  if (new Set(v).size !== 3) return null
  return v as Digit[]
}

/** Three slots, each a digit or null. */
export function parseSlots(v: unknown): (Digit | null)[] | null {
  if (!Array.isArray(v) || v.length !== 3) return null
  if (!v.every((d) => d === null || isDigit(d))) return null
  return v as (Digit | null)[]
}

export function sameCode(a: readonly Digit[] | null, b: readonly Digit[]): boolean {
  return a !== null && a.length === b.length && a.every((d, i) => d === b[i])
}

export const MAX_CLUE = 40
export const SILENCE = '🤐'

export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return v.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Lowercase letters and digits only. */
export function squash(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')
}

function stem(word: string): string {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word
}

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem)
}

/**
 * Why a clue is not allowed, or null when it is fine.
 * A clue may not contain one of the team's own keywords (or a 4+ letter part of one),
 * and may not repeat a clue the team already gave.
 */
export function clueProblem(clue: string, keywords: readonly string[], usedClues: readonly string[]): string | null {
  if (clue.length === 0) return 'Every clue needs at least one character'
  const flat = squash(clue)
  const clueTokens = tokens(clue)
  for (const kw of keywords) {
    const k = squash(kw)
    if (k.length >= 3 && flat.includes(k)) return `"${clue}" gives away "${kw}" — no saying your own keyword`
    for (const part of tokens(kw)) {
      if (part.length >= 4 && clueTokens.includes(part)) return `"${clue}" uses part of "${kw}" — too easy`
    }
  }
  if (usedClues.some((u) => squash(u) === flat && flat.length > 0)) return `Your team already used "${clue}" — say something new`
  return null
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]!
}

/** Forgiving keyword match for the tiebreak: case, spacing, plurals and one typo (for 5+ letters). */
export function wordMatches(guess: string, keyword: string): boolean {
  const g = stem(squash(guess))
  const k = stem(squash(keyword))
  if (!g || !k) return false
  if (g === k) return true
  return k.length >= 5 && editDistance(g, k) <= 1
}
