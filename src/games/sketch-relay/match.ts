/**
 * Fuzzy guess matching. Forgiving about case, spacing, punctuation, articles,
 * plurals and small typos; strict enough that "cat" does not match "car".
 */

const ARTICLES = new Set(['a', 'an', 'the'])
const FILLER = new Set(['is', 'it', 'its', 'this', 'that', 'thats', 'maybe', 'i', 'think', 'guess', 'like', 'some', 'kind', 'of', 'ok', 'okay'])

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y'
  if (word.length > 4 && /(ches|shes|xes|sses|zes)$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1)
  return word
}

/** Lowercase words with diacritics, punctuation, articles and plurals removed. */
export function words(raw: string): string[] {
  const s = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  if (!s) return []
  return s.split(' ').filter((w) => !ARTICLES.has(w)).map(stem)
}

export function normalize(raw: string): string {
  return words(raw).join(' ')
}

export function levenshtein(a: string, b: string, cap = 99): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > cap) return cap + 1
    prev = cur
  }
  return prev[b.length] ?? cap + 1
}

/** Typos allowed for an answer of this many letters (spaces ignored). */
export function tolerance(len: number): number {
  if (len <= 4) return 0
  if (len <= 7) return 1
  return 2
}

function compactMatch(guess: string, answer: string): boolean {
  if (!guess || !answer) return false
  if (guess === answer) return true
  return levenshtein(guess, answer, 3) <= tolerance(answer.length)
}

/** Does `ws` contain `target` as a contiguous run of words (each fuzzy-matched)? */
function containsRun(ws: string[], target: string[]): boolean {
  for (let i = 0; i + target.length <= ws.length; i++) {
    let ok = true
    for (let k = 0; k < target.length; k++) {
      if (!compactMatch(ws[i + k] ?? '', target[k] ?? '')) { ok = false; break }
    }
    if (ok) return true
  }
  return false
}

export type Verdict = 'correct' | 'close' | 'wrong'

export function judge(guess: string, answers: readonly string[]): Verdict {
  const gw = words(guess)
  if (gw.length === 0) return 'wrong'
  const gCompact = gw.join('')
  // "is it a samosa??" -> "samosa"
  const core = gw.filter((w) => !FILLER.has(w))
  const coreCompact = core.join('')
  let close = false
  for (const ans of answers) {
    const aw = words(ans)
    if (aw.length === 0) continue
    const aCompact = aw.join('')
    if (compactMatch(gCompact, aCompact) || compactMatch(coreCompact, aCompact)) return 'correct'
    // The answer inside a slightly longer guess ("big auto rickshaw"), but not a list of guesses.
    if (core.length <= aw.length + 2 && containsRun(core, aw)) return 'correct'
    if (!close) {
      if (gCompact.length >= 3 && levenshtein(gCompact, aCompact, 6) <= tolerance(aCompact.length) + 2) close = true
      const longA = aw.filter((w) => w.length >= 4)
      if (core.some((w) => w.length >= 4 && longA.some((a) => compactMatch(w, a)))) close = true
    }
  }
  return close ? 'close' : 'wrong'
}
