import { randomBytes, randomInt } from 'node:crypto'

/** mulberry32: tiny, fast, good enough for party games. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a 32-bit hash of a string, for seeding. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** No I, O, L, U, 0, 1 — nothing you can misread over a video call. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ'
export const CODE_LENGTH = 5

export function generateCode(taken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = ''
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    if (!taken(code)) return code
  }
  throw new Error('Could not find a free room code')
}

export function newToken(): string {
  return randomBytes(18).toString('base64url')
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('base64url')}`
}

export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}
