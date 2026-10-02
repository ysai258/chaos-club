/**
 * The nine co-op challenges. Each one is a tiny state machine for ONE team.
 * Pure functions: never mutate `d`, return a copy.
 *
 * `d.mole` is the team's active saboteur for this challenge (null when the
 * team has no mole, the mole is exposed, or gone). It must never leak into a
 * non-mole view: every `view` only reads it to decide `viewer === d.mole`.
 */
import type { PlayerId } from '../../shared/protocol.ts'
import type { ChallengeKind, Evidence, Fact, InputSpec, PlayView } from './shared.ts'
import {
  BALLPARK, BLIND_GRIDS, DOORS, GUARDS, HEAT_THEMES, HEISTS, INTEL_CATEGORIES, SAFES, STOCKS,
} from './content.ts'

export type Rng = () => number

export const randInt = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1))

export function shuffle<T>(r: Rng, xs: readonly T[]): T[] {
  const a = xs.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    const t = a[i] as T
    a[i] = a[j] as T
    a[j] = t
  }
  return a
}

export function pick<T>(r: Rng, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)] as T
}

/** Random index into a list of `len`, avoiding `avoid` while possible. */
export function pickIndex(r: Rng, len: number, avoid: readonly number[]): number {
  const free: number[] = []
  for (let i = 0; i < len; i++) if (!avoid.includes(i)) free.push(i)
  return free.length ? pick(r, free) : Math.floor(r() * len)
}

const fmt = (n: number): string => (n >= 1000 && n <= 2100 ? String(n) : n.toLocaleString('en-IN'))

export interface Base {
  roster: PlayerId[]
  mole: PlayerId | null
  gone: PlayerId[]
  stage: string
  deadline: number
  done: boolean
  /** Content index used, for no-repeat bookkeeping. */
  content: number
  /** Timer multiplier. */
  pace: number
}

export interface SetupArgs {
  roster: PlayerId[]
  mole: PlayerId | null
  /** When the challenge phase starts (after the briefing). */
  start: number
  random: Rng
  avoid: number[]
  pace: number
}

export interface Resolution {
  success: boolean
  points: number
  sabotage: boolean
  evidence: Evidence
}

export interface ActArgs { now: number; random: Rng }

export interface Challenge<D extends Base> {
  kind: ChallengeKind
  name: string
  emoji: string
  rules: string[]
  setup(a: SetupArgs): D
  /** Handle one `play` action from a roster member. Return an error string to reject. */
  act(d: D, pid: PlayerId, value: unknown, a: ActArgs): D | string
  /** The stage deadline passed. */
  timeout(d: D, a: ActArgs): D
  /** A player left for good (already pushed into `d.gone`). Reassign roles, then settle. */
  onGone(d: D, pid: PlayerId, a: ActArgs): D
  resolve(d: D, random: Rng): Resolution
  view(d: D, viewer: PlayerId): PlayView
  /** What a wiretap on `target` reveals, or null when this challenge has nothing hidden per player. */
  wiretap(d: D, target: PlayerId): string | null
}

// ---------- helpers ----------

export const active = (d: Base): PlayerId[] => d.roster.filter((p) => !d.gone.includes(p))
const dur = (d: Base, ms: number): number => Math.round(ms * d.pace)
const waiting = (d: Base, who: PlayerId[], has: Record<PlayerId, unknown>): PlayerId[] =>
  who.filter((p) => !d.gone.includes(p) && !(p in has))
const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi

function baseView(c: Challenge<Base>, d: Base, stageLabel: string): PlayView {
  return {
    kind: c.kind, name: c.name, emoji: c.emoji, rules: c.rules, stage: d.stage, stageLabel,
    facts: [], intel: [], objective: null, input: null, mine: null, board: null, waitingOn: [], note: null,
  }
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)] as number
}

// ---------- 1. Safe Cracker ----------

export interface SafeD extends Base { target: number; picks: Record<PlayerId, number> }

const SAFE_MS = 50_000

export const safe: Challenge<SafeD> = {
  kind: 'safe', name: 'Safe Cracker', emoji: '🔐',
  rules: [
    'Everyone secretly dials one number, 0 to 9.',
    'Crack it if the team total hits the target EXACTLY.',
    'Afterwards you see every number — shuffled, nobody\'s name on it.',
  ],
  setup(a) {
    const n = a.roster.length
    const content = pickIndex(a.random, SAFES.length, a.avoid)
    return {
      roster: a.roster, mole: a.mole, gone: [], stage: 'dial', deadline: a.start + Math.round(SAFE_MS * a.pace),
      done: false, content, pace: a.pace, target: randInt(a.random, n * 2, n * 7), picks: {},
    }
  },
  act(d, pid, value) {
    if (pid in d.picks) return 'You already dialled'
    if (!isInt(value, 0, 9)) return 'Pick a number from 0 to 9'
    const next = { ...d, picks: { ...d.picks, [pid]: value } }
    return waiting(next, next.roster, next.picks).length === 0 ? { ...next, done: true } : next
  },
  timeout: (d) => ({ ...d, done: true }),
  onGone: (d) => (waiting(d, d.roster, d.picks).length === 0 ? { ...d, done: true } : d),
  resolve(d, r) {
    const nums = d.roster.filter((p) => p in d.picks).map((p) => d.picks[p] as number)
    const sum = nums.reduce((a, b) => a + b, 0)
    const missing = active(d).filter((p) => !(p in d.picks)).length
    const diff = Math.abs(sum - d.target)
    const success = diff === 0
    const items = shuffle(r, nums).map((n) => `🔢 ${n}`)
    for (let i = 0; i < missing; i++) items.push('⏳ froze (0)')
    return {
      success, points: success ? 3 : 0,
      sabotage: d.mole !== null && (diff === 1 || diff === 2),
      evidence: {
        success, points: success ? 3 : 0,
        headline: success ? `Click. The safe swings open — exactly ${d.target}.` : `Total ${sum}. The target was ${d.target}. Off by ${diff}.`,
        facts: [{ label: 'Target', value: String(d.target) }, { label: 'Team total', value: String(sum), tone: success ? 'good' : 'bad' }],
        anon: [{ title: 'The numbers dialled (shuffled)', items }],
        named: null,
      },
    }
  },
  view(d, viewer) {
    const v = baseView(safe as unknown as Challenge<Base>, d, 'Dial your number')
    v.facts = [{ label: 'The safe', value: SAFES[d.content] ?? 'a safe' }, { label: 'Target', value: String(d.target) }]
    v.waitingOn = waiting(d, d.roster, d.picks)
    if (d.roster.includes(viewer)) {
      if (viewer in d.picks) v.mine = `You dialled ${d.picks[viewer]}`
      else if (!d.done) v.input = { type: 'number', label: 'Your secret number', min: 0, max: 9 }
    }
    if (viewer === d.mole) v.objective = 'Make the total miss by EXACTLY 1 or 2. A near-miss looks like an honest slip. Miss by more and you earn nothing.'
    v.note = 'Agree on who dials what in team chat. Everyone sees the shuffled numbers afterwards — so if someone lies about their number, it shows.'
    return v
  },
  wiretap: (d, t) => (t in d.picks ? `dialled ${d.picks[t]}` : 'never dialled (counted as 0)'),
}

// ---------- 2. The Heist ----------

export interface HeistD extends Base {
  leader: PlayerId
  crewSize: number
  crew: PlayerId[]
  cards: Record<PlayerId, 'clean' | 'jam'>
}

const HEIST_CREW_MS = 30_000
const HEIST_RUN_MS = 20_000

const crewSizeFor = (n: number): number => Math.min(n, Math.max(2, Math.ceil(n / 2)))

function heistSettle(d: HeistD): HeistD {
  if (d.stage === 'run' && waiting(d, d.crew, d.cards).length === 0) return { ...d, done: true }
  return d
}

function heistStartRun(d: HeistD, crew: PlayerId[], now: number): HeistD {
  return heistSettle({ ...d, crew, stage: 'run', deadline: now + dur(d, HEIST_RUN_MS) })
}

export const heist: Challenge<HeistD> = {
  kind: 'heist', name: 'The Heist', emoji: '💰',
  rules: [
    'The Leader picks a crew for the job.',
    'Each crew member secretly plays 🔓 CRACK or 🧨 JAM.',
    'One single JAM ruins the heist. You learn HOW MANY jams — never whose.',
  ],
  setup(a) {
    const content = pickIndex(a.random, HEISTS.length, a.avoid)
    return {
      roster: a.roster, mole: a.mole, gone: [], stage: 'crew', deadline: a.start + Math.round(HEIST_CREW_MS * a.pace),
      done: false, content, pace: a.pace, leader: pick(a.random, a.roster), crewSize: crewSizeFor(a.roster.length), crew: [], cards: {},
    }
  },
  act(d, pid, value, a) {
    if (d.stage === 'crew') {
      if (pid !== d.leader) return 'Only the Leader picks the crew'
      if (!Array.isArray(value) || !value.every((x) => typeof x === 'string')) return 'Pick your crew'
      const crew = [...new Set(value as string[])]
      const act = active(d)
      if (crew.length !== d.crewSize || !crew.every((p) => act.includes(p))) return `Pick exactly ${d.crewSize} people`
      return heistStartRun(d, crew, a.now)
    }
    if (!d.crew.includes(pid)) return "You're not on the crew"
    if (pid in d.cards) return 'You already played your card'
    if (value !== 'clean' && value !== 'jam') return 'Play CRACK or JAM'
    return heistSettle({ ...d, cards: { ...d.cards, [pid]: value } })
  },
  timeout(d, a) {
    if (d.stage === 'crew') return heistStartRun(d, shuffle(a.random, active(d)).slice(0, d.crewSize), a.now)
    return { ...d, done: true }
  },
  onGone(d, pid, a) {
    const act = active(d)
    let next: HeistD = { ...d, crewSize: Math.min(d.crewSize, act.length) }
    if (next.stage === 'crew' && pid === d.leader && act.length) next = { ...next, leader: pick(a.random, act) }
    if (act.length === 0) return { ...next, done: true }
    return heistSettle(next)
  },
  resolve(d, r) {
    const played = d.crew.filter((p) => p in d.cards).map((p) => d.cards[p] as 'clean' | 'jam')
    const jams = played.filter((c) => c === 'jam').length
    const success = jams === 0 && d.crew.length > 0
    const target = HEISTS[d.content] ?? 'the loot'
    return {
      success, points: success ? 4 : 0,
      sabotage: d.mole !== null && d.cards[d.mole] === 'jam',
      evidence: {
        success, points: success ? 4 : 0,
        headline: success ? `Clean getaway with ${target}!` : `${jams} JAM${jams === 1 ? '' : 'S'}. The alarm went off.`,
        facts: [{ label: 'Leader', value: '', playerId: d.leader }, { label: 'Jams', value: String(jams), tone: jams ? 'bad' : 'good' }],
        anon: [{ title: 'Cards played (shuffled)', items: shuffle(r, played).map((c) => (c === 'jam' ? '🧨 JAM' : '🔓 CRACK')) }],
        named: { title: 'The crew', rows: d.crew.map((p) => ({ playerId: p, text: d.gone.includes(p) ? 'left mid-job' : 'was on the job' })) },
      },
    }
  },
  view(d, viewer) {
    const v = baseView(heist as unknown as Challenge<Base>, d, d.stage === 'crew' ? 'Leader picks the crew' : 'Crew plays cards')
    v.facts = [
      { label: 'The job', value: HEISTS[d.content] ?? 'the loot' },
      { label: 'Leader', value: '', playerId: d.leader },
      { label: 'Crew size', value: String(d.crewSize) },
    ]
    if (d.stage === 'crew') {
      v.waitingOn = d.gone.includes(d.leader) ? [] : [d.leader]
      if (viewer === d.leader && !d.done) {
        v.input = {
          type: 'multi', label: `Pick ${d.crewSize} for the crew`, count: d.crewSize,
          options: active(d).map((p) => ({ value: p, label: '', playerId: p })),
        }
      }
      v.note = viewer === d.leader ? 'Pick people you trust. Including yourself is allowed.' : 'Lobby the Leader in team chat: who do you trust?'
    } else {
      v.board = { title: 'The crew', items: d.crew.map((p) => ({ text: '', by: p })) }
      v.waitingOn = waiting(d, d.crew, d.cards)
      if (d.crew.includes(viewer)) {
        const mine = d.cards[viewer]
        if (mine) v.mine = mine === 'jam' ? 'You played 🧨 JAM' : 'You played 🔓 CRACK'
        else if (!d.done) v.input = { type: 'choice', label: 'Play your card', columns: 2, options: [{ value: 'clean', label: '🔓 CRACK' }, { value: 'jam', label: '🧨 JAM' }] }
      } else v.note = 'You sit this job out. Watch who the Leader trusted.'
    }
    if (viewer === d.mole) v.objective = 'If you get on the crew, play 🧨 JAM. Not on it? Lobby to get on — or let it succeed and look trustworthy.'
    return v
  },
  wiretap(d, t) {
    if (!d.crew.includes(t)) return 'was not on the crew'
    const c = d.cards[t]
    return c === 'jam' ? 'played 🧨 JAM' : c === 'clean' ? 'played 🔓 CRACK' : 'never played a card'
  },
}

// ---------- 3. Heat Scale (Ito) ----------

export interface HeatD extends Base { nums: Record<PlayerId, number>; ranks: Record<PlayerId, number> }
const HEAT_MS = 80_000

export const heat: Challenge<HeatD> = {
  kind: 'heat', name: 'Heat Scale', emoji: '🌶️',
  rules: [
    'Everyone gets a secret number from 1 to 100.',
    "Describe it on the scale — name a thing — but never say the number.",
    'Then each of you claims your spot in the line. All spots right = win.',
  ],
  setup(a) {
    const content = pickIndex(a.random, HEAT_THEMES.length, a.avoid)
    const pool = shuffle(a.random, Array.from({ length: 100 }, (_, i) => i + 1))
    const nums: Record<PlayerId, number> = {}
    a.roster.forEach((p, i) => { nums[p] = pool[i] as number })
    return {
      roster: a.roster, mole: a.mole, gone: [], stage: 'line', deadline: a.start + Math.round(HEAT_MS * a.pace),
      done: false, content, pace: a.pace, nums, ranks: {},
    }
  },
  act(d, pid, value) {
    if (pid in d.ranks) return 'You already took your spot'
    if (!isInt(value, 1, active(d).length)) return `Pick a spot from 1 to ${active(d).length}`
    const next = { ...d, ranks: { ...d.ranks, [pid]: value } }
    return waiting(next, next.roster, next.ranks).length === 0 ? { ...next, done: true } : next
  },
  timeout: (d) => ({ ...d, done: true }),
  onGone: (d) => (waiting(d, d.roster, d.ranks).length === 0 ? { ...d, done: true } : d),
  resolve(d) {
    const act = active(d).slice().sort((a, b) => (d.nums[a] as number) - (d.nums[b] as number))
    const success = act.length > 0 && act.every((p, i) => d.ranks[p] === i + 1)
    const theme = HEAT_THEMES[d.content]
    return {
      success, points: success ? 3 : 0, sabotage: d.mole !== null && !success,
      evidence: {
        success, points: success ? 3 : 0,
        headline: success ? 'Perfect line. Everyone read the room.' : 'The line was wrong somewhere…',
        facts: theme ? [{ label: 'Scale', value: `${theme.scale}: 1 = ${theme.low}, 100 = ${theme.high}` }] : [],
        anon: [],
        named: {
          title: 'True order (number → spot they claimed)',
          rows: act.map((p, i) => {
            const r = d.ranks[p]
            return { playerId: p, text: `#${i + 1} · had ${d.nums[p]} → claimed ${r === undefined ? 'nothing' : `#${r}`}${r === i + 1 ? ' ✅' : ' ❌'}` }
          }),
        },
      },
    }
  },
  view(d, viewer) {
    const v = baseView(heat as unknown as Challenge<Base>, d, 'Describe, then line up')
    const theme = HEAT_THEMES[d.content]
    if (theme) v.facts = [{ label: 'Scale', value: theme.scale }, { label: '1', value: theme.low }, { label: '100', value: theme.high }]
    v.waitingOn = waiting(d, d.roster, d.ranks)
    const n = active(d).length
    if (d.roster.includes(viewer)) {
      v.intel = [{ label: 'Your number', value: String(d.nums[viewer]), tone: 'secret' }]
      if (viewer in d.ranks) v.mine = `You claimed spot #${d.ranks[viewer]} of ${n}`
      else if (!d.done) v.input = { type: 'number', label: `Your spot in the line (1 = lowest, ${n} = highest)`, min: 1, max: n }
    }
    if (viewer === d.mole) {
      v.objective = 'Get at least one person into the wrong spot. Describe your number a little "off" — it\'s all subjective, right?'
      v.intel = [...v.intel, ...active(d).filter((p) => p !== viewer).map((p) => ({ label: 'Insider', value: String(d.nums[p]), playerId: p, tone: 'mole' as const }))]
    }
    v.note = 'Post a thing that matches your number in team chat, e.g. "mine is a medium cutting chai".'
    return v
  },
  wiretap: () => null,
}

// ---------- 4. Intel Board ----------

export interface IntelD extends Base {
  options: string[]
  answer: string
  clues: Record<PlayerId, string>
  posts: Record<PlayerId, string>
  votes: Record<PlayerId, string>
}
const INTEL_POST_MS = 35_000
const INTEL_VOTE_MS = 30_000

function intelSettle(d: IntelD, now: number): IntelD {
  if (d.stage === 'post' && waiting(d, d.roster, d.posts).length === 0) return intelSettle({ ...d, stage: 'vote', deadline: now + dur(d, INTEL_VOTE_MS) }, now)
  if (d.stage === 'vote' && waiting(d, d.roster, d.votes).length === 0) return { ...d, done: true }
  return d
}

export const intel: Challenge<IntelD> = {
  kind: 'intel', name: 'Intel Board', emoji: '🗂️',
  rules: [
    'One option is the target. Your clue rules out ONE wrong option.',
    'Post a clue to the anonymous board, then everyone votes on the target.',
    'Afterwards, HALF the team\'s real clues are revealed at random. Liars, beware.',
  ],
  setup(a) {
    const content = pickIndex(a.random, INTEL_CATEGORIES.length, a.avoid)
    const cat = INTEL_CATEGORIES[content] ?? { name: '', options: [] }
    const n = a.roster.length
    const options = shuffle(a.random, cat.options).slice(0, Math.min(cat.options.length, Math.max(4, n + 1)))
    const answer = pick(a.random, options)
    const wrong = shuffle(a.random, options.filter((o) => o !== answer))
    const clues: Record<PlayerId, string> = {}
    a.roster.forEach((p, i) => { clues[p] = wrong[i % wrong.length] as string })
    return {
      roster: a.roster, mole: a.mole, gone: [], stage: 'post', deadline: a.start + Math.round(INTEL_POST_MS * a.pace),
      done: false, content, pace: a.pace, options, answer, clues, posts: {}, votes: {},
    }
  },
  act(d, pid, value, a) {
    if (typeof value !== 'string' || !d.options.includes(value)) return 'Pick one of the options'
    if (d.stage === 'post') {
      if (pid in d.posts) return 'You already posted'
      return intelSettle({ ...d, posts: { ...d.posts, [pid]: value } }, a.now)
    }
    if (pid in d.votes) return 'You already voted'
    return intelSettle({ ...d, votes: { ...d.votes, [pid]: value } }, a.now)
  },
  timeout(d, a) {
    if (d.stage === 'post') return intelSettle({ ...d, stage: 'vote', deadline: a.now + dur(d, INTEL_VOTE_MS) }, a.now)
    return { ...d, done: true }
  },
  onGone: (d, _p, a) => intelSettle(d, a.now),
  resolve(d, r) {
    const tally: Record<string, number> = {}
    for (const p of d.roster) { const v = d.votes[p]; if (v) tally[v] = (tally[v] ?? 0) + 1 }
    const best = Math.max(0, ...Object.values(tally))
    const top = Object.keys(tally).filter((k) => tally[k] === best)
    const choice = top.length === 1 ? (top[0] as string) : null
    const success = choice === d.answer
    const lies = d.roster.filter((p) => p in d.posts && d.posts[p] !== d.clues[p]).length
    const exposed = shuffle(r, d.roster).slice(0, Math.ceil(d.roster.length / 2))
    return {
      success, points: success ? 3 : 0, sabotage: d.mole !== null && !success,
      evidence: {
        success, points: success ? 3 : 0,
        headline: success ? `Target found: ${d.answer}.` : choice ? `You picked ${choice}. It was ${d.answer}.` : `Split vote — no pick. It was ${d.answer}.`,
        facts: [
          { label: 'Target', value: d.answer, tone: 'good' },
          { label: 'Posts that were NOT the poster\'s real clue', value: String(lies), tone: lies ? 'bad' : 'good' },
        ],
        anon: [],
        named: { title: 'Random half: real clues revealed', rows: exposed.map((p) => ({ playerId: p, text: `real clue: NOT ${d.clues[p]}` })) },
      },
    }
  },
  view(d, viewer) {
    const v = baseView(intel as unknown as Challenge<Base>, d, d.stage === 'post' ? 'Post to the board' : 'Vote on the target')
    const cat = INTEL_CATEGORIES[d.content]
    v.facts = [{ label: 'Category', value: cat?.name ?? '' }, { label: 'Options', value: d.options.join(' · ') }]
    if (d.roster.includes(viewer)) v.intel = [{ label: 'Your real clue', value: `It is NOT ${d.clues[viewer]}`, tone: 'secret' }]
    if (d.stage === 'post') {
      v.waitingOn = waiting(d, d.roster, d.posts)
      const mine = d.posts[viewer]
      if (mine) v.mine = `You posted: NOT ${mine}`
      else if (d.roster.includes(viewer) && !d.done) v.input = { type: 'choice', label: 'Post to the board', columns: 2, options: d.options.map((o) => ({ value: o, label: `NOT ${o}` })) }
      v.note = 'The board is anonymous. Nobody sees who posted what.'
    } else {
      // Order by option list, never by posting order — timing would leak authorship.
      const posted = d.options.flatMap((o) => d.roster.filter((p) => d.posts[p] === o).map(() => ({ text: `NOT ${o}` })))
      v.board = { title: 'The anonymous board', items: posted }
      v.waitingOn = waiting(d, d.roster, d.votes)
      const mine = d.votes[viewer]
      if (mine) v.mine = `You voted: ${mine}`
      else if (d.roster.includes(viewer) && !d.done) v.input = { type: 'choice', label: 'Which one is the target?', columns: 2, options: d.options.map((o) => ({ value: o, label: o })) }
    }
    if (viewer === d.mole) {
      v.objective = 'Make the team vote for ANYTHING but the target. Posting a fake clue works — but if your real clue gets revealed, you\'re toast.'
      v.intel = [...v.intel, { label: 'Insider', value: `The target is ${d.answer}`, tone: 'mole' }]
    }
    return v
  },
  wiretap: (d, t) => `real clue: NOT ${d.clues[t]} · posted: ${d.posts[t] ? `NOT ${d.posts[t]}` : 'nothing'}`,
}

// ---------- 5. Bribe the Guard ----------

export interface BribeD extends Base { price: number; hints: Record<PlayerId, [number, number]>; pays: Record<PlayerId, number> }
const BRIBE_MS = 50_000

export const bribe: Challenge<BribeD> = {
  kind: 'bribe', name: 'Bribe the Guard', emoji: '🪙',
  rules: [
    'The guard has a secret price. Each of you slips him 0–5 coins.',
    'Pay exactly the price: 5 points. Every extra coin wasted costs a point. Short = 0.',
    'Everyone has a hint about the price. Afterwards: payments shown, shuffled.',
  ],
  setup(a) {
    const n = a.roster.length
    const content = pickIndex(a.random, GUARDS.length, a.avoid)
    const price = randInt(a.random, 2 * n, 4 * n - 1)
    const hints: Record<PlayerId, [number, number]> = {}
    for (const p of a.roster) {
      const w = randInt(a.random, 3, 6)
      const lo = Math.max(0, price - randInt(a.random, 0, w))
      hints[p] = [lo, lo + w]
    }
    return {
      roster: a.roster, mole: a.mole, gone: [], stage: 'pay', deadline: a.start + Math.round(BRIBE_MS * a.pace),
      done: false, content, pace: a.pace, price, hints, pays: {},
    }
  },
  act(d, pid, value) {
    if (pid in d.pays) return 'You already paid'
    if (!isInt(value, 0, 5)) return 'Pay 0 to 5 coins'
    const next = { ...d, pays: { ...d.pays, [pid]: value } }
    return waiting(next, next.roster, next.pays).length === 0 ? { ...next, done: true } : next
  },
  timeout: (d) => ({ ...d, done: true }),
  onGone: (d) => (waiting(d, d.roster, d.pays).length === 0 ? { ...d, done: true } : d),
  resolve(d, r) {
    const paid = d.roster.filter((p) => p in d.pays).map((p) => d.pays[p] as number)
    const total = paid.reduce((a, b) => a + b, 0)
    const success = total >= d.price
    const over = total - d.price
    const points = success ? Math.max(1, 5 - over) : 0
    return {
      success, points, sabotage: d.mole !== null && (!success || over >= 3),
      evidence: {
        success, points,
        headline: !success ? `${total} coins. The guard wanted ${d.price}. Door stays shut.` : over === 0 ? `Exactly ${d.price}. The guard winks. Perfect.` : `You got in — but overpaid by ${over}.`,
        facts: [{ label: 'Price', value: String(d.price) }, { label: 'Paid', value: String(total), tone: success && over < 3 ? 'good' : 'bad' }],
        anon: [
          { title: 'Payments (shuffled)', items: shuffle(r, paid).map((c) => `🪙 ${c}`) },
          { title: 'Hints everyone got (shuffled)', items: shuffle(r, d.roster.map((p) => { const h = d.hints[p] as [number, number]; return `${h[0]}–${h[1]}` })) },
        ],
        named: null,
      },
    }
  },
  view(d, viewer) {
    const v = baseView(bribe as unknown as Challenge<Base>, d, 'Slip the guard some coins')
    v.facts = [{ label: 'The guard', value: GUARDS[d.content] ?? 'the guard' }, { label: 'Scoring', value: 'Exact = 5 pts · each extra coin −1 · short = 0' }]
    v.waitingOn = waiting(d, d.roster, d.pays)
    const h = d.hints[viewer]
    if (h) v.intel = [{ label: 'Your hint', value: `The price is between ${h[0]} and ${h[1]}`, tone: 'secret' }]
    if (d.roster.includes(viewer)) {
      if (viewer in d.pays) v.mine = `You paid ${d.pays[viewer]} coin${d.pays[viewer] === 1 ? '' : 's'}`
      else if (!d.done) v.input = { type: 'number', label: 'Your coins', min: 0, max: 5 }
    }
    if (viewer === d.mole) {
      v.objective = 'Make the team overpay by 3+ coins, or come up short. "I just wanted to be safe!" is a great excuse.'
      v.intel = [...v.intel, { label: 'Insider', value: `The exact price is ${d.price}`, tone: 'mole' }]
    }
    v.note = 'Pool your hints in team chat to narrow the price, then split who pays what.'
    return v
  },
  wiretap(d, t) {
    const h = d.hints[t]
    return `paid ${t in d.pays ? d.pays[t] : 'nothing'} · hint said ${h ? `${h[0]}–${h[1]}` : '?'}`
  },
}

// ---------- 6. Ballpark ----------

export interface BallD extends Base { dir: 'high' | 'low'; hints: Record<PlayerId, string>; guesses: Record<PlayerId, number> }
const BALL_MS = 60_000

export const ballpark: Challenge<BallD> = {
  kind: 'ballpark', name: 'Ballpark', emoji: '📏',
  rules: [
    'A number question. Each of you holds a true hint.',
    "Everyone guesses. The team's answer is the MIDDLE guess (median).",
    'Land within the margin to score. Guesses are shown with names afterwards.',
  ],
  setup(a) {
    const content = pickIndex(a.random, BALLPARK.length, a.avoid)
    const q = BALLPARK[content] as (typeof BALLPARK)[number]
    const step = Math.max(1, 10 ** Math.floor(Math.log10(q.tol)))
    const hints: Record<PlayerId, string> = {}
    for (const p of a.roster) {
      const k = 1.3 + a.random() * 2.5
      if (a.random() < 0.5) hints[p] = `more than ${fmt(Math.floor((q.a - q.tol * k) / step) * step)}`
      else hints[p] = `less than ${fmt(Math.ceil((q.a + q.tol * k) / step) * step)}`
    }
    return {
      roster: a.roster, mole: a.mole, gone: [], stage: 'guess', deadline: a.start + Math.round(BALL_MS * a.pace),
      done: false, content, pace: a.pace, dir: a.random() < 0.5 ? 'high' : 'low', hints, guesses: {},
    }
  },
  act(d, pid, value) {
    if (pid in d.guesses) return 'You already guessed'
    if (!isInt(value, 0, 10_000_000)) return 'Enter a whole number'
    const next = { ...d, guesses: { ...d.guesses, [pid]: value } }
    return waiting(next, next.roster, next.guesses).length === 0 ? { ...next, done: true } : next
  },
  timeout: (d) => ({ ...d, done: true }),
  onGone: (d) => (waiting(d, d.roster, d.guesses).length === 0 ? { ...d, done: true } : d),
  resolve(d, r) {
    const q = BALLPARK[d.content] as (typeof BALLPARK)[number]
    const gs = d.roster.filter((p) => p in d.guesses).map((p) => d.guesses[p] as number)
    const m = gs.length ? median(gs) : null
    const success = m !== null && Math.abs(m - q.a) <= q.tol
    const sabotage = d.mole !== null && m !== null && (d.dir === 'high' ? m > q.a + q.tol : m < q.a - q.tol)
    return {
      success, points: success ? 3 : 0, sabotage,
      evidence: {
        success, points: success ? 3 : 0,
        headline: m === null ? 'Nobody guessed!' : success ? `Team said ${fmt(m)} — real answer ${fmt(q.a)}. In the park!` : `Team said ${fmt(m)} — real answer ${fmt(q.a)}. Out of the park.`,
        facts: [{ label: 'Answer', value: `${fmt(q.a)} ${q.unit}`.trim(), tone: 'good' }, { label: 'Margin', value: `± ${fmt(q.tol)}` }, { label: 'Team answer', value: m === null ? '—' : fmt(m), tone: success ? 'good' : 'bad' }],
        anon: [{ title: 'Hints everyone got (shuffled)', items: shuffle(r, d.roster.map((p) => d.hints[p] ?? '')) }],
        named: { title: 'Guesses', rows: d.roster.map((p) => ({ playerId: p, text: p in d.guesses ? fmt(d.guesses[p] as number) : 'no guess' })) },
      },
    }
  },
  view(d, viewer) {
    const q = BALLPARK[d.content] as (typeof BALLPARK)[number]
    const v = baseView(ballpark as unknown as Challenge<Base>, d, 'Guess the number')
    v.facts = [{ label: 'Question', value: q.q }, { label: 'Margin', value: `± ${fmt(q.tol)} ${q.unit}`.trim() }]
    v.waitingOn = waiting(d, d.roster, d.guesses)
    const h = d.hints[viewer]
    if (h) v.intel = [{ label: 'Your hint', value: `The answer is ${h}`, tone: 'secret' }]
    if (d.roster.includes(viewer)) {
      if (viewer in d.guesses) v.mine = `You guessed ${fmt(d.guesses[viewer] as number)}`
      else if (!d.done) v.input = { type: 'number', label: q.unit ? `Your guess (${q.unit})` : 'Your guess', min: 0, max: 10_000_000, big: true }
    }
    if (viewer === d.mole) {
      v.objective = `Drag the team's middle guess too ${d.dir === 'high' ? 'HIGH' : 'LOW'} (outside the margin). One wild guess won't move a median — you'll have to talk them into it.`
      v.intel = [...v.intel, { label: 'Insider', value: `The real answer is ${fmt(q.a)}`, tone: 'mole' }]
    }
    v.note = 'Share hints in team chat. One crazy guess barely moves the median.'
    return v
  },
  wiretap: (d, t) => `hint was "${d.hints[t] ?? '?'}" · guessed ${t in d.guesses ? fmt(d.guesses[t] as number) : 'nothing'}`,
}

// ---------- 7. Code Relay ----------

export interface CodeD extends Base { code: string; keymaster: PlayerId; seen: Record<PlayerId, number[]>; entry: string | null }
const CODE_MS = 60_000

function assignDigits(r: Rng, people: PlayerId[]): Record<PlayerId, number[]> {
  const seen: Record<PlayerId, number[]> = {}
  if (people.length === 1) { seen[people[0] as string] = [0, 1, 2, 3]; return seen }
  // Shuffle the positions, deal two each round-robin so every digit is covered first.
  const order = shuffle(r, [0, 1, 2, 3])
  people.forEach((p, i) => {
    const a = order[(2 * i) % 4] as number
    const b = order[(2 * i + 1) % 4] as number
    seen[p] = [a, b].sort()
  })
  return seen
}

const maskCode = (code: string, pos: number[]): string =>
  code.split('').map((c, i) => (pos.includes(i) ? c : '_')).join(' ')

export const code: Challenge<CodeD> = {
  kind: 'code', name: 'Code Relay', emoji: '🔢',
  rules: [
    'A 4-digit door code. The Keymaster is blindfolded — sees nothing.',
    'Everyone else sees two of the digits. Feed them to the Keymaster.',
    'Afterwards: who saw which digits is revealed.',
  ],
  setup(a) {
    const content = pickIndex(a.random, DOORS.length, a.avoid)
    const keymaster = pick(a.random, a.roster)
    const others = shuffle(a.random, a.roster.filter((p) => p !== keymaster))
    const c = Array.from({ length: 4 }, () => String(randInt(a.random, 0, 9))).join('')
    return {
      roster: a.roster, mole: a.mole, gone: [], stage: 'enter', deadline: a.start + Math.round(CODE_MS * a.pace),
      done: false, content, pace: a.pace, code: c, keymaster, seen: assignDigits(a.random, others), entry: null,
    }
  },
  act(d, pid, value) {
    if (pid !== d.keymaster) return 'Only the Keymaster types the code'
    if (typeof value !== 'string' || !/^\d{4}$/.test(value)) return 'Enter 4 digits'
    return { ...d, entry: value, done: true }
  },
  timeout: (d) => ({ ...d, done: true }),
  onGone(d, pid, a) {
    if (pid !== d.keymaster) return d
    const act = active(d)
    if (!act.length) return { ...d, done: true }
    return { ...d, keymaster: pick(a.random, act) }
  },
  resolve(d) {
    const success = d.entry === d.code
    return {
      success, points: success ? 3 : 0, sabotage: d.mole !== null && !success,
      evidence: {
        success, points: success ? 3 : 0,
        headline: success ? 'Beep-beep-boop. Door open!' : d.entry ? `Wrong code. Typed ${d.entry}, real code ${d.code}.` : `Time ran out. The code was ${d.code}.`,
        facts: [{ label: 'Real code', value: d.code, tone: 'good' }, { label: 'Typed', value: d.entry ?? '—', tone: success ? 'good' : 'bad' }, { label: 'Keymaster', value: '', playerId: d.keymaster }],
        anon: [],
        named: { title: 'Who saw which digits', rows: Object.keys(d.seen).map((p) => ({ playerId: p, text: maskCode(d.code, d.seen[p] as number[]) })) },
      },
    }
  },
  view(d, viewer) {
    const v = baseView(code as unknown as Challenge<Base>, d, 'Relay the code')
    v.facts = [{ label: 'The door', value: DOORS[d.content] ?? 'the door' }, { label: 'Keymaster', value: '', playerId: d.keymaster }]
    v.waitingOn = d.gone.includes(d.keymaster) || d.done ? [] : [d.keymaster]
    const seen = d.seen[viewer]
    if (seen && viewer !== d.keymaster) v.intel = [{ label: 'Your digits', value: maskCode(d.code, seen), tone: 'secret' }]
    if (viewer === d.keymaster) {
      if (d.entry) v.mine = `You typed ${d.entry}`
      else if (!d.done) v.input = { type: 'digits', label: 'Type the code', length: 4 }
      v.note = "You're the Keymaster. You see nothing — trust your team (or don't)."
    } else v.note = 'Tell the Keymaster your digits — team chat or out loud.'
    if (viewer === d.mole) {
      v.objective = 'Get the Keymaster to type a wrong code. Digits only you saw can\'t be double-checked…'
      v.intel = [...v.intel, { label: 'Insider', value: `Full code: ${d.code.split('').join(' ')}`, tone: 'mole' }]
    }
    return v
  },
  wiretap: () => null,
}

// ---------- 8. Stock Tip ----------

type Dir = 'up' | 'down'
export interface StockD extends Base { truth: Dir; tips: Record<PlayerId, Dir>; calls: Record<PlayerId, { dir: Dir; stake: number }> }
const STOCK_MS = 45_000
const arrow = (d: Dir): string => (d === 'up' ? '📈 UP' : '📉 DOWN')

function stockOutcome(d: StockD): { call: Dir | null; stake: number; points: number } {
  const calls = d.roster.filter((p) => p in d.calls).map((p) => d.calls[p] as { dir: Dir; stake: number })
  const up = calls.filter((c) => c.dir === 'up').length
  const down = calls.length - up
  if (up === down) return { call: null, stake: 0, points: 0 }
  const call: Dir = up > down ? 'up' : 'down'
  const stake = median(calls.map((c) => c.stake))
  return { call, stake, points: call === d.truth ? 2 * stake : -stake }
}

export const stock: Challenge<StockD> = {
  kind: 'stock', name: 'Stock Tip', emoji: '📈',
  rules: [
    'Will the stock go UP or DOWN? Everyone has a tip — tips are right about 70% of the time.',
    'Everyone calls a direction and a stake (1–3). Majority call, middle stake.',
    'Right: +2 × stake. Wrong: −stake. A tie means no trade.',
  ],
  setup(a) {
    const content = pickIndex(a.random, STOCKS.length, a.avoid)
    const truth: Dir = a.random() < 0.5 ? 'up' : 'down'
    const tips: Record<PlayerId, Dir> = {}
    for (const p of a.roster) tips[p] = a.random() < 0.7 ? truth : truth === 'up' ? 'down' : 'up'
    return {
      roster: a.roster, mole: a.mole, gone: [], stage: 'trade', deadline: a.start + Math.round(STOCK_MS * a.pace),
      done: false, content, pace: a.pace, truth, tips, calls: {},
    }
  },
  act(d, pid, value) {
    if (pid in d.calls) return 'You already called it'
    const m = typeof value === 'string' ? /^(up|down):([123])$/.exec(value) : null
    if (!m) return 'Pick a direction and a stake'
    const next = { ...d, calls: { ...d.calls, [pid]: { dir: m[1] as Dir, stake: Number(m[2]) } } }
    return waiting(next, next.roster, next.calls).length === 0 ? { ...next, done: true } : next
  },
  timeout: (d) => ({ ...d, done: true }),
  onGone: (d) => (waiting(d, d.roster, d.calls).length === 0 ? { ...d, done: true } : d),
  resolve(d, r) {
    const o = stockOutcome(d)
    const success = o.points > 0
    return {
      success, points: o.points, sabotage: d.mole !== null && o.points < 0,
      evidence: {
        success, points: o.points,
        headline: o.call === null ? `Split call — no trade. It went ${arrow(d.truth)}.` : success ? `${STOCKS[d.content]} went ${arrow(d.truth)}. Ka-ching! +${o.points}` : `${STOCKS[d.content]} went ${arrow(d.truth)}. Ouch: ${o.points}.`,
        facts: [{ label: 'It went', value: arrow(d.truth), tone: 'good' }, { label: 'Team call', value: o.call ? `${arrow(o.call)} × ${o.stake}` : 'no trade', tone: success ? 'good' : 'bad' }],
        anon: [{ title: 'Tips everyone got (shuffled)', items: shuffle(r, d.roster.map((p) => arrow(d.tips[p] as Dir))) }],
        named: { title: 'Calls', rows: d.roster.map((p) => { const c = d.calls[p]; return { playerId: p, text: c ? `${arrow(c.dir)} × ${c.stake}` : 'no call' } }) },
      },
    }
  },
  view(d, viewer) {
    const v = baseView(stock as unknown as Challenge<Base>, d, 'Make the call')
    v.facts = [{ label: 'Stock', value: STOCKS[d.content] ?? '' }, { label: 'Payout', value: 'Right +2×stake · Wrong −stake' }]
    v.waitingOn = waiting(d, d.roster, d.calls)
    const t = d.tips[viewer]
    if (t) v.intel = [{ label: 'Your tip (70% reliable)', value: arrow(t), tone: 'secret' }]
    if (d.roster.includes(viewer)) {
      const c = d.calls[viewer]
      if (c) v.mine = `You called ${arrow(c.dir)} × ${c.stake}`
      else if (!d.done) {
        v.input = {
          type: 'choice', label: 'Your call', columns: 3,
          options: (['up', 'down'] as Dir[]).flatMap((dir) => [1, 2, 3].map((s) => ({ value: `${dir}:${s}`, label: `${dir === 'up' ? '📈 UP' : '📉 DOWN'} ×${s}` }))),
        }
      }
    }
    if (viewer === d.mole) {
      v.objective = 'Make the team LOSE money on this trade. Push the wrong direction with a big stake.'
      v.intel = [...v.intel, { label: 'Insider', value: `It WILL go ${arrow(d.truth)}`, tone: 'mole' }]
    }
    v.note = 'Tips can be wrong, even from honest teammates. Share yours in chat.'
    return v
  },
  wiretap(d, t) {
    const c = d.calls[t]
    return `tip said ${arrow(d.tips[t] ?? 'up')} · called ${c ? `${arrow(c.dir)} × ${c.stake}` : 'nothing'}`
  },
}

// ---------- 9. Blind Spot ----------

export interface BlindD extends Base { words: string[]; secret: string; blind: PlayerId; clues: Record<PlayerId, string>; guess: string | null }
const BLIND_CLUE_MS = 45_000
const BLIND_GUESS_MS = 25_000

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function blindSettle(d: BlindD, now: number): BlindD {
  if (d.stage === 'clue') {
    const givers = d.roster.filter((p) => p !== d.blind)
    if (waiting(d, givers, d.clues).length === 0) return { ...d, stage: 'guess', deadline: now + dur(d, BLIND_GUESS_MS) }
  }
  return d
}

export const blind: Challenge<BlindD> = {
  kind: 'blind', name: 'Blind Spot', emoji: '🙈',
  rules: [
    'Everyone sees the secret word — except the Blind.',
    'Each of you gives a one-word clue (with your name on it).',
    'The Blind picks the word from the grid. Right = win.',
  ],
  setup(a) {
    const content = pickIndex(a.random, BLIND_GRIDS.length, a.avoid)
    const grid = BLIND_GRIDS[content] as (typeof BLIND_GRIDS)[number]
    return {
      roster: a.roster, mole: a.mole, gone: [], stage: 'clue', deadline: a.start + Math.round(BLIND_CLUE_MS * a.pace),
      done: false, content, pace: a.pace, words: shuffle(a.random, grid.words), secret: pick(a.random, grid.words),
      blind: pick(a.random, a.roster), clues: {}, guess: null,
    }
  },
  act(d, pid, value, a) {
    if (d.stage === 'clue') {
      if (pid === d.blind) return "You're the Blind — wait for clues"
      if (pid in d.clues) return 'You already gave a clue'
      if (typeof value !== 'string') return 'Type a clue'
      const clue = value.trim().replace(/\s+/g, ' ')
      if (!clue || clue.length > 24) return 'Clue: 1–24 characters'
      if (clue.split(' ').length > 2) return 'Two words max'
      const n = norm(clue)
      if (!n) return 'Type a clue'
      if (n.includes(norm(d.secret)) || (n.length >= 4 && norm(d.secret).includes(n))) return "Can't use the word itself!"
      return blindSettle({ ...d, clues: { ...d.clues, [pid]: clue } }, a.now)
    }
    if (pid !== d.blind) return 'Only the Blind guesses'
    if (typeof value !== 'string' || !d.words.includes(value)) return 'Pick a word from the grid'
    return { ...d, guess: value, done: true }
  },
  timeout(d, a) {
    if (d.stage === 'clue') return { ...d, stage: 'guess', deadline: a.now + dur(d, BLIND_GUESS_MS) }
    return { ...d, done: true }
  },
  onGone(d, pid, a) {
    if (pid === d.blind) return { ...d, done: true }
    return blindSettle(d, a.now)
  },
  resolve(d) {
    const success = d.guess === d.secret
    return {
      success, points: success ? 3 : 0, sabotage: d.mole !== null && !success,
      evidence: {
        success, points: success ? 3 : 0,
        headline: success ? `The Blind found "${d.secret}"!` : d.guess ? `The Blind picked "${d.guess}". The word was "${d.secret}".` : `No guess. The word was "${d.secret}".`,
        facts: [{ label: 'Word', value: d.secret, tone: 'good' }, { label: 'Blind', value: '', playerId: d.blind }, { label: 'Guess', value: d.guess ?? '—', tone: success ? 'good' : 'bad' }],
        anon: [],
        named: { title: 'Clues given', rows: d.roster.filter((p) => p !== d.blind).map((p) => ({ playerId: p, text: d.clues[p] ? `"${d.clues[p]}"` : 'no clue' })) },
      },
    }
  },
  view(d, viewer) {
    const v = baseView(blind as unknown as Challenge<Base>, d, d.stage === 'clue' ? 'Give clues' : 'The Blind guesses')
    const isBlind = viewer === d.blind
    const canSee = !isBlind || viewer === d.mole
    v.facts = [{ label: 'Blind', value: '', playerId: d.blind }, { label: 'Grid', value: d.words.join(' · ') }]
    if (canSee && d.roster.includes(viewer)) v.intel = [{ label: 'Secret word', value: d.secret, tone: viewer === d.mole && isBlind ? 'mole' : 'secret' }]
    const givers = d.roster.filter((p) => p !== d.blind)
    if (d.stage === 'clue') {
      v.waitingOn = waiting(d, givers, d.clues)
      if (!isBlind && d.roster.includes(viewer)) {
        if (d.clues[viewer]) v.mine = `Your clue: "${d.clues[viewer]}"`
        else if (!d.done) v.input = { type: 'text', label: 'One-word clue', maxLength: 24, placeholder: 'e.g. spicy' }
      }
      v.note = isBlind ? "You're the Blind. Clues appear when everyone's in." : 'Clues show up with your name on them. No saying the word!'
    } else {
      v.board = { title: 'Clues', items: givers.filter((p) => d.clues[p]).map((p) => ({ text: d.clues[p] as string, by: p })) }
      v.waitingOn = d.done || d.gone.includes(d.blind) ? [] : [d.blind]
      if (isBlind) {
        if (d.guess) v.mine = `You picked "${d.guess}"`
        else if (!d.done) v.input = { type: 'choice', label: 'Which word is it?', columns: 3, options: d.words.map((w) => ({ value: w, label: w })) }
      } else v.note = 'The Blind is choosing…'
    }
    if (viewer === d.mole) {
      v.objective = isBlind
        ? "You're the Blind, but you know the word. Pick a WRONG one that fits the clues and act baffled."
        : 'Steer the Blind to a wrong word with a clue that is "technically" related.'
    }
    return v
  },
  wiretap: () => null,
}

// ---------- registry ----------

export const CHALLENGES: Record<ChallengeKind, Challenge<Base>> = {
  safe: safe as unknown as Challenge<Base>,
  heist: heist as unknown as Challenge<Base>,
  heat: heat as unknown as Challenge<Base>,
  intel: intel as unknown as Challenge<Base>,
  bribe: bribe as unknown as Challenge<Base>,
  ballpark: ballpark as unknown as Challenge<Base>,
  code: code as unknown as Challenge<Base>,
  stock: stock as unknown as Challenge<Base>,
  blind: blind as unknown as Challenge<Base>,
}

export const ALL_KINDS: ChallengeKind[] = ['safe', 'heist', 'heat', 'intel', 'bribe', 'ballpark', 'code', 'stock', 'blind']

export type { Fact, InputSpec }
