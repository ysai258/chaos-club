import { describe, expect, it } from 'vitest'
import { judge, levenshtein, normalize } from './match.ts'
import { appendChunk, validateChunk } from './strokes.ts'
import { PROMPTS } from './prompts.ts'

describe('normalize', () => {
  it('drops case, punctuation, articles, accents and plurals', () => {
    expect(normalize('  The AUTO-Rickshaws!! ')).toBe('auto rickshaw')
    expect(normalize('Café')).toBe('cafe')
    expect(normalize("Aunty's buffet")).toBe('aunty buffet')
    expect(normalize('Puppies')).toBe('puppy')
    expect(normalize('boxes')).toBe('box')
    expect(normalize('glass')).toBe('glass')
    expect(normalize('bus')).toBe('bus')
  })
})

describe('judge', () => {
  const auto = ['Auto-rickshaw in traffic', 'auto rickshaw', 'tuk tuk', 'traffic jam']
  it('accepts exact answers in any case / spacing / punctuation', () => {
    expect(judge('auto rickshaw', auto)).toBe('correct')
    expect(judge('AUTORICKSHAW', auto)).toBe('correct')
    expect(judge('Auto-Rickshaw in Traffic!!', auto)).toBe('correct')
    expect(judge('tuk-tuk', auto)).toBe('correct')
    expect(judge('tuktuks', auto)).toBe('correct')
  })
  it('allows small typos on longer words only', () => {
    expect(judge('auto rikshaw', auto)).toBe('correct')
    expect(judge('elefant', ['Elephant'])).toBe('correct')
    expect(judge('cat', ['Car'])).not.toBe('correct')
    expect(judge('bat', ['Cat'])).not.toBe('correct')
    expect(judge('kite', ['Kitten'])).not.toBe('correct')
  })
  it('accepts the answer wrapped in filler words, but not a shopping list', () => {
    expect(judge('is it a samosa?', ['Samosa'])).toBe('correct')
    expect(judge('a big samosa', ['Samosa'])).toBe('correct')
    expect(judge('chai samosa cooker auto fan', ['Samosa'])).not.toBe('correct')
  })
  it('says close when a key word lands', () => {
    expect(judge('wedding', ['Aunty at a wedding buffet', 'wedding buffet'])).toBe('close')
    expect(judge('elephnt trunk', ['Elephant'])).toBe('correct')
    expect(judge('zebra', ['Elephant'])).toBe('wrong')
  })
  it('never matches empty or punctuation-only guesses', () => {
    expect(judge('', ['Samosa'])).toBe('wrong')
    expect(judge('?!...', ['Samosa'])).toBe('wrong')
  })
  it('levenshtein basics', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('', 'abc')).toBe(3)
  })
})

describe('prompt content', () => {
  it('has 200+ prompts across tiers with unique texts and accept lists', () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(200)
    for (const d of ['easy', 'medium', 'hard'] as const) {
      expect(PROMPTS.filter((p) => p.difficulty === d).length).toBeGreaterThanOrEqual(50)
    }
    const seen = new Set<string>()
    for (const p of PROMPTS) {
      const k = normalize(p.text)
      expect(seen.has(k), `duplicate ${p.text}`).toBe(false)
      seen.add(k)
      expect(p.accept.length).toBeGreaterThan(0)
    }
  })
  it('every prompt is guessable by its own text and accept list', () => {
    for (const p of PROMPTS) {
      expect(judge(p.text, [p.text, ...p.accept])).toBe('correct')
      for (const a of p.accept) expect(judge(a, [p.text, ...p.accept])).toBe('correct')
    }
  })
})

describe('ink validation', () => {
  it('rejects malformed chunks', () => {
    expect(validateChunk('nope').ok).toBe(false)
    expect(validateChunk([1, 2, 3]).ok).toBe(false)
    expect(validateChunk([1, 'x']).ok).toBe(false)
    expect(validateChunk([1, Number.NaN]).ok).toBe(false)
    expect(validateChunk([1, Infinity]).ok).toBe(false)
    expect(validateChunk([5000, 5]).ok).toBe(false)
    expect(validateChunk([-500, 5]).ok).toBe(false)
    expect(validateChunk(new Array(122).fill(1)).ok).toBe(false)
  })
  it('clamps slight overshoot and rounds', () => {
    expect(validateChunk([-20, 1020.6, 10.4, 999.5])).toEqual({ ok: true, pts: [0, 1000, 10, 1000] })
  })
  it('cuts a stroke exactly where the ink runs out', () => {
    const r = appendChunk([], 0, [0, 0, 100, 0, 300, 0], 150, 240)
    expect(r.capped).toBe(true)
    expect(r.len).toBe(150)
    expect(r.points).toEqual([0, 0, 100, 0, 150, 0])
  })
  it('caps the point count and skips duplicate points', () => {
    const r = appendChunk([], 0, [0, 0, 0, 0, 1, 0, 2, 0, 3, 0], 10_000, 3)
    expect(r.points).toEqual([0, 0, 1, 0, 2, 0])
    expect(r.capped).toBe(true)
  })
})
