/**
 * Pitch Wars — Shark Tank meets Snake Oil.
 *
 * Every round each team draws a terrible product and a forced twist, builds a
 * startup poster in private, then one rotating "lead pitcher" sells it live on
 * Meet while every other team plays Shark: firing hostile questions, throwing
 * one curveball per round and finally signing secret cheques. Hit your Ask and
 * it's a DEAL (bonus); miss it and the sharks only half-fund you.
 *
 * Money is integer lakh internally (100 lakh = ₹1 crore). Scores are crore.
 */
import type { PlayerId, TeamId } from '../../shared/protocol.ts'
import type { BaseCtx, GameDefinition, GameEvent, Step } from '../types.ts'
import { CURVEBALLS, PRODUCTS, QUESTIONS, TWISTS } from './content.ts'
import type {
  PwCheque, PwDraft, PwFired, PwPhase, PwPitchRecord, PwProduct, PwRole, PwView,
} from './shared.ts'

// ---------------------------------------------------------------- constants

export const WALLET = 1000 // ₹10 crore per shark per round
export const CHEQUE_STEP = 50 // ₹0.5 crore
export const STAGE_MS = 7_000
export const INVEST_MS = 30_000
export const CURVEBALL_BONUS_MS = 15_000
export const FIRES_PER_PITCH = 2
export const QUESTION_HAND = 3
export const CURVEBALL_HAND = 2
export const LATE_GRACE_MS = 500
const ASK_FRACTIONS = [0.1, 0.2, 0.3, 0.5, 0.7, 1]
export const EQUITY_OPTIONS = [2, 5, 10, 20, 33, 51]
export const MASCOTS = [
  '🦈', '🐐', '🦄', '🐒', '🦚', '🐘', '🐯', '🐄', '🦜', '🐸', '🐙', '🦀',
  '🌶️', '🥭', '☕', '🍛', '🛺', '🚀', '💎', '🔥', '👑', '🧠', '🪔', '🏏',
]
const LIMITS = { name: 32, slogan: 70, price: 22 }

// ---------------------------------------------------------------- types

export interface Settings extends Record<string, unknown> {
  rounds: number
  prepSeconds: number
  pitchSeconds: number
}

interface PPlayer { id: PlayerId; name: string; teamId: TeamId; gone: boolean }
interface PTeam { id: TeamId; name: string; memberIds: PlayerId[] }

interface TeamRound {
  product: PwProduct
  twist: string
  draft: PwDraft
  ready: boolean
  pitcherId: PlayerId | null
  redraws: { product: number; twist: number }
}

interface Hand {
  questions: { id: string; text: string; fired: boolean }[]
  fired: number
  curveballs: { id: string; text: string }[]
  curveballUsed: boolean
}

interface Current {
  teamId: TeamId
  pitcherId: PlayerId | null
  questions: PwFired[]
  curveball: PwFired | null
}

interface Stats { invested: number; fired: number; curveballs: number; cheques: number }

export interface State {
  settings: Settings
  phase: PwPhase
  stage: number
  endsAt: number | null
  round: number
  order: TeamId[]
  pitchIdx: number
  players: PPlayer[]
  teams: PTeam[]
  pitcherOffset: Record<TeamId, number>
  askOptions: number[]
  teamRounds: Record<TeamId, TeamRound>
  hands: Record<TeamId, Hand>
  current: Current | null
  cheques: Record<PlayerId, number>
  wallets: Record<PlayerId, number>
  decks: { products: number[]; twists: number[]; questions: number[]; curveballs: number[] }
  history: PwPitchRecord[]
  money: Record<TeamId, number>
  stats: Record<PlayerId, Stats>
  seq: number
}

// ---------------------------------------------------------------- helpers

function shuffle<T>(xs: readonly T[], random: () => number): T[] {
  const a = xs.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const t = a[i] as T
    a[i] = a[j] as T
    a[j] = t
  }
  return a
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

type DeckName = keyof State['decks']
const DECK_SIZE: Record<DeckName, number> = {
  products: PRODUCTS.length, twists: TWISTS.length, questions: QUESTIONS.length, curveballs: CURVEBALLS.length,
}

/** Draw one card index; refills (reshuffles) the deck when it runs dry. */
function draw(s: State, deck: DeckName, random: () => number): number {
  let pile = s.decks[deck]
  if (pile.length === 0) pile = shuffle(range(DECK_SIZE[deck]), random)
  const [top, ...rest] = pile
  s.decks = { ...s.decks, [deck]: rest }
  return top ?? 0
}

function clone(s: State): State {
  return structuredClone(s)
}

const err = (state: State, error: string): Step<State> => ({ state, error })

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max)
}

const crore = (lakh: number) => Math.round(lakh / 10) / 10
export const fmtCrore = (lakh: number) => `₹${crore(lakh)} cr`

function playerOf(s: State, id: PlayerId): PPlayer | undefined {
  return s.players.find((p) => p.id === id)
}

function activeTeams(s: State): PTeam[] {
  return s.teams.filter((t) => t.memberIds.some((id) => !playerOf(s, id)?.gone))
}

function isConnected(ctx: BaseCtx, id: PlayerId): boolean {
  return ctx.players.find((p) => p.id === id)?.connected ?? false
}

/** Rotating lead pitcher: round r → member (offset + r) % size, skipping vanished players. */
function pickPitcher(s: State, team: PTeam): PlayerId | null {
  const n = team.memberIds.length
  if (n === 0) return null
  const start = (s.pitcherOffset[team.id] ?? 0) + s.round
  for (let k = 0; k < n; k++) {
    const id = team.memberIds[(start + k) % n] as PlayerId
    if (!playerOf(s, id)?.gone) return id
  }
  return null
}

/** Next teammate after `from` who hasn't vanished. */
function nextTeammate(s: State, team: PTeam, from: PlayerId | null): PlayerId | null {
  const n = team.memberIds.length
  const at = from ? team.memberIds.indexOf(from) : -1
  for (let k = 1; k <= n; k++) {
    const id = team.memberIds[(at + k + n) % n] as PlayerId
    if (!playerOf(s, id)?.gone) return id
  }
  return null
}

function sharkIds(s: State): PlayerId[] {
  const cur = s.current?.teamId
  const active = new Set(activeTeams(s).map((t) => t.id))
  return s.players.filter((p) => !p.gone && p.teamId !== cur && active.has(p.teamId)).map((p) => p.id)
}

function defaultDraft(s: State, random: () => number): PwDraft {
  return {
    name: '',
    slogan: '',
    price: '',
    mascot: MASCOTS[Math.floor(random() * MASCOTS.length)] ?? '🦈',
    ask: s.askOptions[3] ?? 500,
    equity: 10,
  }
}

function finalDraft(tr: TeamRound): PwDraft {
  return {
    ...tr.draft,
    name: tr.draft.name.trim() || tr.product.title,
    slogan: tr.draft.slogan.trim(),
    price: tr.draft.price.trim(),
  }
}

// ---------------------------------------------------------------- flow

function bump(s: State, phase: PwPhase, endsAt: number | null) {
  s.phase = phase
  s.endsAt = endsAt
  s.stage += 1
}

function startRound(s: State, ctx: BaseCtx, round: number): GameEvent[] {
  const teams = activeTeams(s)
  if (teams.length < 2) return endGame(s)
  s.round = round
  const k = teams.length - 1
  s.askOptions = ASK_FRACTIONS.map((f) => Math.round(f * WALLET * k))
  s.teamRounds = {}
  s.hands = {}
  for (const t of teams) {
    s.teamRounds[t.id] = {
      product: PRODUCTS[draw(s, 'products', ctx.random)] as PwProduct,
      twist: TWISTS[draw(s, 'twists', ctx.random)] as string,
      draft: defaultDraft(s, ctx.random),
      ready: false,
      pitcherId: pickPitcher(s, t),
      redraws: { product: 1, twist: 1 },
    }
    s.hands[t.id] = {
      questions: [],
      fired: 0,
      curveballs: range(CURVEBALL_HAND).map(() => {
        const i = draw(s, 'curveballs', ctx.random)
        return { id: `c${i}`, text: CURVEBALLS[i] as string }
      }),
      curveballUsed: false,
    }
  }
  const ids = teams.map((t) => t.id)
  const r = round % ids.length
  s.order = [...ids.slice(r), ...ids.slice(0, r)]
  s.pitchIdx = 0
  s.current = null
  s.cheques = {}
  s.wallets = Object.fromEntries(s.players.filter((p) => !p.gone).map((p) => [p.id, WALLET]))
  bump(s, 'prep', ctx.now + s.settings.prepSeconds * 1000)
  return [{ type: 'pw/round', data: { round } }]
}

function endGame(s: State): GameEvent[] {
  s.current = null
  bump(s, 'over', null)
  return [{ type: 'pw/over' }]
}

function skippedRecord(s: State, teamId: TeamId, tr: TeamRound | undefined, cur: Current | null): PwPitchRecord {
  const product = tr?.product ?? { title: 'Mystery product', blurb: '' }
  return {
    round: s.round, teamId, pitcherId: null, product, twist: tr?.twist ?? '',
    draft: tr ? finalDraft(tr) : { name: product.title, slogan: '', price: '', mascot: '👻', ask: 0, equity: 0 },
    questions: cur?.questions ?? [], curveball: cur?.curveball ?? null,
    cheques: [], byTeam: [], total: 0, deal: false, points: 0, skipped: true,
  }
}

/** Move to the stage of the next pitch that still has a team, or finish the round. */
function nextPitch(s: State, ctx: BaseCtx): GameEvent[] {
  if (activeTeams(s).length < 2) return endGame(s)
  while (s.pitchIdx < s.order.length) {
    const teamId = s.order[s.pitchIdx] as TeamId
    const team = activeTeams(s).find((t) => t.id === teamId)
    const tr = s.teamRounds[teamId]
    if (team && tr) {
      if (!tr.pitcherId || playerOf(s, tr.pitcherId)?.gone) tr.pitcherId = pickPitcher(s, team)
      s.current = { teamId, pitcherId: tr.pitcherId, questions: [], curveball: null }
      s.cheques = {}
      for (const t of activeTeams(s)) {
        const hand = s.hands[t.id]
        if (!hand || t.id === teamId) continue
        hand.fired = 0
        hand.questions = range(QUESTION_HAND).map(() => {
          const i = draw(s, 'questions', ctx.random)
          return { id: `q${i}`, text: QUESTIONS[i] as string, fired: false }
        })
      }
      bump(s, 'stage', ctx.now + STAGE_MS)
      return [{ type: 'pw/stage', data: { teamId, pitcherId: tr.pitcherId } }]
    }
    // Team vanished before its turn: record a skipped pitch.
    if (tr) s.history.push(skippedRecord(s, teamId, tr, null))
    s.pitchIdx += 1
  }
  if (s.round + 1 < s.settings.rounds) return startRound(s, ctx, s.round + 1)
  return endGame(s)
}

function startPitch(s: State, ctx: BaseCtx): GameEvent[] {
  bump(s, 'pitch', ctx.now + s.settings.pitchSeconds * 1000)
  return [{ type: 'pw/pitch', data: { teamId: s.current?.teamId ?? null } }]
}

function startInvest(s: State, ctx: BaseCtx): GameEvent[] {
  s.cheques = {}
  bump(s, 'invest', ctx.now + INVEST_MS)
  return [{ type: 'pw/invest' }]
}

function reveal(s: State, ctx: BaseCtx): GameEvent[] {
  const cur = s.current
  const tr = cur ? s.teamRounds[cur.teamId] : undefined
  if (!cur || !tr) return nextPitch(s, ctx)
  const draft = finalDraft(tr)
  const cheques: PwCheque[] = []
  const byTeam: { teamId: TeamId; amount: number }[] = []
  for (const t of activeTeams(s)) {
    if (t.id === cur.teamId) continue
    const signed: number[] = []
    for (const id of t.memberIds) {
      const p = playerOf(s, id)
      if (!p || p.gone) continue
      const amt = s.cheques[id]
      if (amt === undefined) {
        cheques.push({ playerId: id, teamId: t.id, amount: null })
        continue
      }
      cheques.push({ playerId: id, teamId: t.id, amount: amt })
      signed.push(amt)
      s.wallets[id] = Math.max(0, (s.wallets[id] ?? 0) - amt)
      const st = s.stats[id]
      if (st) { st.invested += amt; st.cheques += 1 }
    }
    const avg = signed.length ? Math.round(signed.reduce((a, b) => a + b, 0) / signed.length) : 0
    byTeam.push({ teamId: t.id, amount: avg })
  }
  const total = byTeam.reduce((a, b) => a + b.amount, 0)
  const deal = total > 0 && total >= draft.ask
  const points = deal ? total + Math.round(draft.ask / 2) : Math.round(total / 2)
  s.money[cur.teamId] = (s.money[cur.teamId] ?? 0) + points
  s.history.push({
    round: s.round, teamId: cur.teamId, pitcherId: cur.pitcherId, product: tr.product, twist: tr.twist, draft,
    questions: cur.questions, curveball: cur.curveball, cheques, byTeam, total, deal, points, skipped: false,
  })
  s.cheques = {}
  const revealMs = Math.min(18_000, 8_000 + cheques.length * 1_200)
  bump(s, 'reveal', ctx.now + revealMs)
  return [{ type: 'pw/reveal', data: { teamId: cur.teamId, deal, points } }]
}

function afterReveal(s: State, ctx: BaseCtx): GameEvent[] {
  s.current = null
  s.pitchIdx += 1
  return nextPitch(s, ctx)
}

/** Every connected shark has signed → reveal now. */
function maybeAllSigned(s: State, ctx: BaseCtx): GameEvent[] {
  if (s.phase !== 'invest') return []
  const live = sharkIds(s).filter((id) => isConnected(ctx, id))
  if (live.length > 0 && live.every((id) => s.cheques[id] !== undefined)) return reveal(s, ctx)
  return []
}

function maybeAllReady(s: State, ctx: BaseCtx): GameEvent[] {
  if (s.phase !== 'prep') return []
  if (activeTeams(s).every((t) => s.teamRounds[t.id]?.ready)) {
    s.pitchIdx = 0
    return nextPitch(s, ctx)
  }
  return []
}

// ---------------------------------------------------------------- view

function view(s: State, viewerId: PlayerId): PwView {
  const me = playerOf(s, viewerId)
  const myTeamId = me?.teamId ?? null
  const cur = s.current
  const live = s.phase === 'stage' || s.phase === 'pitch' || s.phase === 'invest' || s.phase === 'reveal'
  const role: PwRole = !me || me.gone || s.phase === 'over' ? 'spectator'
    : cur && live && me.teamId !== cur.teamId ? 'shark' : 'pitching'

  const pitchedIds = new Set(s.history.filter((h) => h.round === s.round).map((h) => h.teamId))
  const myTr = myTeamId && s.phase !== 'over' ? s.teamRounds[myTeamId] : undefined
  const curTr = cur ? s.teamRounds[cur.teamId] : undefined
  const hand = role === 'shark' && myTeamId && (s.phase === 'stage' || s.phase === 'pitch') ? s.hands[myTeamId] : undefined
  const active = new Set(activeTeams(s).map((t) => t.id))

  return {
    phase: s.phase,
    stage: s.stage,
    round: s.round,
    rounds: s.settings.rounds,
    order: s.order,
    currentTeamId: live ? cur?.teamId ?? null : null,
    role,
    myTeamId,
    teams: s.teams.map((t) => ({
      id: t.id,
      pitcherId: s.teamRounds[t.id]?.pitcherId ?? null,
      ready: s.teamRounds[t.id]?.ready ?? false,
      folded: !active.has(t.id),
      pitchedThisRound: pitchedIds.has(t.id),
    })),
    askOptions: s.askOptions,
    equityOptions: EQUITY_OPTIONS,
    mascots: MASCOTS,
    walletPerRound: WALLET,
    myTeam: myTr && myTeamId ? {
      teamId: myTeamId,
      product: myTr.product,
      twist: myTr.twist,
      draft: myTr.draft,
      ready: myTr.ready,
      pitcherId: myTr.pitcherId,
      redraws: myTr.redraws,
    } : null,
    onStage: cur && curTr && live ? {
      teamId: cur.teamId,
      pitcherId: cur.pitcherId,
      product: curTr.product,
      twist: curTr.twist,
      draft: finalDraft(curTr),
      questions: cur.questions,
      curveball: cur.curveball,
    } : null,
    sharkHand: hand ? {
      questions: hand.questions,
      firesLeft: Math.max(0, FIRES_PER_PITCH - hand.fired),
      curveballs: hand.curveballUsed ? [] : hand.curveballs,
      canCurveball: s.phase === 'pitch' && !hand.curveballUsed && !cur?.curveball,
    } : null,
    invest: s.phase === 'invest' ? {
      sharkIds: sharkIds(s),
      lockedIds: Object.keys(s.cheques),
      mine: role === 'shark' ? s.cheques[viewerId] ?? null : null,
      wallet: s.wallets[viewerId] ?? 0,
    } : null,
    reveal: s.phase === 'reveal' ? s.history[s.history.length - 1] ?? null : null,
    history: s.phase === 'reveal' ? s.history.slice(0, -1) : s.history,
    money: s.money,
  }
}

// ---------------------------------------------------------------- actions

/** The pitcher, or any teammate when the pitcher has dropped off. */
function canDrive(s: State, ctx: BaseCtx, playerId: PlayerId): boolean {
  const cur = s.current
  if (!cur) return false
  if (cur.pitcherId === playerId) return true
  const me = playerOf(s, playerId)
  return me?.teamId === cur.teamId && (!cur.pitcherId || !isConnected(ctx, cur.pitcherId))
}

function action(state: State, playerId: PlayerId, act: { type: string; payload: Record<string, unknown> }, ctx: BaseCtx): Step<State> {
  const me = playerOf(state, playerId)
  if (!me || me.gone) return err(state, "You're watching this one — you'll play next game")
  const p = act.payload ?? {}
  if (state.phase === 'over') return err(state, 'The game is over')
  if (p.stage !== state.stage) return err(state, 'Too late — that moment has passed')
  if (state.endsAt !== null && ctx.now > state.endsAt + LATE_GRACE_MS) return err(state, "Time's up!")

  const s = clone(state)
  const cur = s.current
  const myTr = s.teamRounds[me.teamId]

  switch (act.type) {
    case 'draft': {
      if (s.phase !== 'prep' || !myTr) return err(state, 'Drafting is closed')
      const d = { ...myTr.draft }
      if ('name' in p) { const v = cleanText(p.name, LIMITS.name); if (v === null) return err(state, 'Bad name'); d.name = v }
      if ('slogan' in p) { const v = cleanText(p.slogan, LIMITS.slogan); if (v === null) return err(state, 'Bad slogan'); d.slogan = v }
      if ('price' in p) { const v = cleanText(p.price, LIMITS.price); if (v === null) return err(state, 'Bad price'); d.price = v }
      if ('mascot' in p) {
        if (typeof p.mascot !== 'string' || !MASCOTS.includes(p.mascot)) return err(state, 'Pick a mascot from the list')
        d.mascot = p.mascot
      }
      if ('ask' in p) {
        if (typeof p.ask !== 'number' || !s.askOptions.includes(p.ask)) return err(state, 'Pick one of the Ask amounts')
        d.ask = p.ask
      }
      if ('equity' in p) {
        if (typeof p.equity !== 'number' || !EQUITY_OPTIONS.includes(p.equity)) return err(state, 'Pick an equity option')
        d.equity = p.equity
      }
      myTr.draft = d
      return { state: s }
    }

    case 'redraw': {
      if (s.phase !== 'prep' || !myTr) return err(state, 'Too late to redraw')
      if (myTr.ready) return err(state, 'Un-ready first to redraw')
      const card = p.card
      if (card !== 'product' && card !== 'twist') return err(state, 'Redraw what?')
      if (myTr.redraws[card] <= 0) return err(state, `No ${card} redraws left this round`)
      myTr.redraws = { ...myTr.redraws, [card]: myTr.redraws[card] - 1 }
      if (card === 'product') myTr.product = PRODUCTS[draw(s, 'products', ctx.random)] as PwProduct
      else myTr.twist = TWISTS[draw(s, 'twists', ctx.random)] as string
      return { state: s, events: [{ type: 'pw/redraw', data: { card }, to: { teamId: me.teamId } }] }
    }

    case 'ready': {
      if (s.phase !== 'prep' || !myTr) return err(state, 'Prep is over')
      if (typeof p.ready !== 'boolean') return err(state, 'Ready or not?')
      myTr.ready = p.ready
      const events: GameEvent[] = [{ type: 'pw/ready', data: { teamId: me.teamId, ready: p.ready } }]
      return { state: s, events: [...events, ...maybeAllReady(s, ctx)] }
    }

    case 'takeMic': {
      const ok = s.phase === 'prep' || ((s.phase === 'stage' || s.phase === 'pitch') && cur?.teamId === me.teamId)
      if (!ok || !myTr) return err(state, "You can't take the mic now")
      if (myTr.pitcherId === playerId) return err(state, 'You already have the mic')
      if (myTr.pitcherId && isConnected(ctx, myTr.pitcherId)) return err(state, 'Your pitcher is still here — no mic snatching!')
      myTr.pitcherId = playerId
      if (cur && cur.teamId === me.teamId) cur.pitcherId = playerId
      return { state: s, events: [{ type: 'pw/mic', data: { teamId: me.teamId, pitcherId: playerId } }] }
    }

    case 'start': {
      if (s.phase !== 'stage' || !cur) return err(state, 'Not now')
      if (!canDrive(s, ctx, playerId)) return err(state, 'Only the pitcher can start')
      return { state: s, events: startPitch(s, ctx) }
    }

    case 'done': {
      if (s.phase !== 'pitch' || !cur) return err(state, 'Not pitching right now')
      if (!canDrive(s, ctx, playerId)) return err(state, 'Only the pitcher can wrap up')
      return { state: s, events: startInvest(s, ctx) }
    }

    case 'fire': {
      if (s.phase !== 'pitch' || !cur) return err(state, 'Questions are fired during the pitch')
      if (me.teamId === cur.teamId) return err(state, "You can't grill your own pitch")
      const hand = s.hands[me.teamId]
      if (!hand) return err(state, 'No question cards')
      if (hand.fired >= FIRES_PER_PITCH) return err(state, 'Your team is out of questions for this pitch')
      const q = hand.questions.find((x) => x.id === p.id)
      if (!q) return err(state, 'That card is not in your hand')
      if (q.fired) return err(state, 'Already fired that one')
      q.fired = true
      hand.fired += 1
      const st = s.stats[playerId]
      if (st) st.fired += 1
      s.seq += 1
      const fired: PwFired = { id: `f${s.seq}`, text: q.text, byTeamId: me.teamId, byPlayerId: playerId, at: ctx.now }
      cur.questions.push(fired)
      return { state: s, events: [{ type: 'pw/fire', data: { ...fired } }] }
    }

    case 'curveball': {
      if (s.phase !== 'pitch' || !cur) return err(state, 'Curveballs fly during the pitch')
      if (me.teamId === cur.teamId) return err(state, "Don't curveball yourself")
      const hand = s.hands[me.teamId]
      if (!hand || hand.curveballUsed) return err(state, 'Your team already threw its curveball this round')
      if (cur.curveball) return err(state, 'Someone already threw a curveball at this pitch')
      const c = hand.curveballs.find((x) => x.id === p.id)
      if (!c) return err(state, 'That curveball is not in your hand')
      hand.curveballUsed = true
      const st = s.stats[playerId]
      if (st) st.curveballs += 1
      s.seq += 1
      cur.curveball = { id: `f${s.seq}`, text: c.text, byTeamId: me.teamId, byPlayerId: playerId, at: ctx.now }
      s.endsAt = (s.endsAt ?? ctx.now) + CURVEBALL_BONUS_MS
      return { state: s, events: [{ type: 'pw/curveball', data: { ...cur.curveball } }] }
    }

    case 'invest': {
      if (s.phase !== 'invest' || !cur) return err(state, 'Cheques are signed after the pitch')
      if (me.teamId === cur.teamId) return err(state, "You can't fund yourself, nice try")
      if (!sharkIds(s).includes(playerId)) return err(state, 'Only sharks can invest')
      const amt = p.amount
      if (typeof amt !== 'number' || !Number.isInteger(amt) || amt < 0 || amt % CHEQUE_STEP !== 0) return err(state, 'Invalid amount')
      if (amt > (s.wallets[playerId] ?? 0)) return err(state, "That's more than your wallet")
      s.cheques[playerId] = amt
      return { state: s, events: [{ type: 'pw/signed', data: { playerId } }, ...maybeAllSigned(s, ctx)] }
    }

    case 'next': {
      if (s.phase !== 'reveal') return err(state, 'Nothing to skip')
      if (playerId !== ctx.hostId) return err(state, 'Only the host can skip ahead')
      return { state: s, events: afterReveal(s, ctx) }
    }

    default:
      return err(state, 'Unknown action')
  }
}

// ---------------------------------------------------------------- tick / gone

function tick(state: State, ctx: BaseCtx): Step<State> {
  if (state.endsAt === null || ctx.now < state.endsAt) return { state }
  const s = clone(state)
  let events: GameEvent[] = []
  switch (s.phase) {
    case 'prep': s.pitchIdx = 0; events = nextPitch(s, ctx); break
    case 'stage': events = startPitch(s, ctx); break
    case 'pitch': events = startInvest(s, ctx); break
    case 'invest': events = reveal(s, ctx); break
    case 'reveal': events = afterReveal(s, ctx); break
    default: s.endsAt = null
  }
  return { state: s, events }
}

function onPlayerGone(state: State, playerId: PlayerId, ctx: BaseCtx): Step<State> {
  const known = playerOf(state, playerId)
  if (!known || known.gone || state.phase === 'over') return { state }
  const s = clone(state)
  const p = playerOf(s, playerId) as PPlayer
  p.gone = true
  delete s.cheques[playerId]
  if (activeTeams(s).length < 2) return { state: s, events: endGame(s) }

  const events: GameEvent[] = []
  const team = s.teams.find((t) => t.id === p.teamId) as PTeam
  const tr = s.teamRounds[team.id]
  const teamAlive = activeTeams(s).some((t) => t.id === team.id)
  if (tr && tr.pitcherId === playerId) {
    tr.pitcherId = teamAlive ? nextTeammate(s, team, playerId) : null
    if (s.current?.teamId === team.id) s.current.pitcherId = tr.pitcherId
    if (tr.pitcherId) events.push({ type: 'pw/mic', data: { teamId: team.id, pitcherId: tr.pitcherId } })
  }

  const midPitch = s.phase === 'stage' || s.phase === 'pitch' || s.phase === 'invest'
  if (!teamAlive && s.current?.teamId === team.id && midPitch) {
    // The whole pitching team vanished mid-pitch: nothing to fund.
    s.history.push(skippedRecord(s, team.id, tr, s.current))
    s.pitchIdx += 1
    s.current = null
    return { state: s, events: [...events, ...nextPitch(s, ctx)] }
  }
  if (s.phase === 'prep') events.push(...maybeAllReady(s, ctx))
  if (s.phase === 'invest') events.push(...maybeAllSigned(s, ctx))
  return { state: s, events }
}

// ---------------------------------------------------------------- results

function results(s: State, ctx: BaseCtx) {
  const name = (id: PlayerId | null) => (id ? ctx.players.find((p) => p.id === id)?.name ?? playerOf(s, id)?.name : null) ?? 'Someone'
  const teamName = (id: TeamId) => ctx.teams.find((t) => t.id === id)?.name ?? s.teams.find((t) => t.id === id)?.name ?? 'A team'
  const pitched = s.history.filter((h) => !h.skipped)
  const highlights: string[] = []

  const best = pitched.slice().sort((a, b) => b.points - a.points)[0]
  if (best) highlights.push(`${name(best.pitcherId)} sold "${best.draft.name}" for ${fmtCrore(best.points)}${best.deal ? ' — DEAL! 🤝' : ''}`)
  const worst = pitched.slice().sort((a, b) => a.total - b.total)[0]
  if (worst && worst !== best) highlights.push(`"${worst.draft.name}" raised ${worst.total === 0 ? 'absolutely nothing 💀' : fmtCrore(worst.total)} (twist: ${worst.twist})`)
  const deals = pitched.filter((h) => h.deal).length
  if (pitched.length) highlights.push(`${deals} deal${deals === 1 ? '' : 's'} and ${pitched.length - deals} "I'm out"s across ${pitched.length} pitches`)
  const biggest = pitched.flatMap((h) => h.cheques.map((c) => ({ ...c, h }))).filter((c) => (c.amount ?? 0) > 0)
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0]
  if (biggest) highlights.push(`Biggest cheque: ${name(biggest.playerId)} put ${fmtCrore(biggest.amount ?? 0)} into ${teamName(biggest.h.teamId)}'s "${biggest.h.draft.name}"`)
  const cb = pitched.find((h) => h.curveball && h.deal)
  if (cb?.curveball) highlights.push(`Curveball "${cb.curveball.text}" — and they STILL closed the deal`)

  const awards: { playerId: PlayerId; title: string; emoji: string }[] = []
  const byPitcher = new Map<PlayerId, number>()
  for (const h of pitched) if (h.pitcherId) byPitcher.set(h.pitcherId, (byPitcher.get(h.pitcherId) ?? 0) + h.points)
  const topPitcher = [...byPitcher].sort((a, b) => b[1] - a[1])[0]
  if (topPitcher && topPitcher[1] > 0) awards.push({ playerId: topPitcher[0], title: 'Golden Mic', emoji: '🎤' })

  const sharks = Object.entries(s.stats).filter(([, st]) => st.cheques > 0)
  const generous = sharks.slice().sort((a, b) => b[1].invested - a[1].invested)[0]
  if (generous && generous[1].invested > 0) awards.push({ playerId: generous[0], title: 'Angel Investor', emoji: '😇' })
  const stingy = sharks.slice().sort((a, b) => a[1].invested - b[1].invested)[0]
  if (stingy && stingy[0] !== generous?.[0]) awards.push({ playerId: stingy[0], title: 'Kanjoos Shark', emoji: '🪙' })
  const griller = Object.entries(s.stats).sort((a, b) => b[1].fired - a[1].fired)[0]
  if (griller && griller[1].fired >= 2) awards.push({ playerId: griller[0], title: 'Grill Master', emoji: '🔥' })
  const thrower = Object.entries(s.stats).find(([, st]) => st.curveballs > 0)
  if (thrower) awards.push({ playerId: thrower[0], title: 'Curveball Bowler', emoji: '🏏' })
  return { highlights: highlights.slice(0, 6), awards }
}

// ---------------------------------------------------------------- definition

function num(v: unknown, min: number, max: number, def: number, step = 1): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return def
  const clamped = Math.min(max, Math.max(min, n))
  return Math.min(max, Math.round((clamped - min) / step) * step + min)
}

export const pitchWars: GameDefinition<State, Settings> = {
  id: 'pitch-wars',
  meta: {
    name: 'Pitch Wars',
    emoji: '🦈',
    tagline: 'Sell a terrible startup to your friends. Live. For crores.',
    howToPlay: [
      'Each round your team draws a terrible product and a twist you MUST use.',
      'Prep in secret: name it, write a slogan, set a price and your Ask. Plot in team chat.',
      'One teammate (it rotates!) pitches live on Meet while every other team plays Shark.',
      'Sharks fire nasty questions, throw one curveball, then sign secret cheques.',
      'Raise your Ask = DEAL + bonus. Miss it = half the money. Most crores wins.',
    ],
    minPlayers: 2,
    maxPlayers: 16,
    teams: { min: 2, max: 4 },
    minTeamSize: 1,
    estimatedMinutes: 15,
    teamChat: true,
    color: 'lime',
  },
  settingsSpec: [
    { key: 'rounds', label: 'Rounds (every team pitches once per round)', kind: 'number', min: 1, max: 3, default: 2 },
    { key: 'prepSeconds', label: 'Prep time (seconds)', kind: 'number', min: 60, max: 240, step: 30, default: 120 },
    { key: 'pitchSeconds', label: 'Pitch time (seconds)', kind: 'number', min: 45, max: 120, step: 15, default: 75 },
  ],
  parseSettings(raw) {
    return {
      rounds: num(raw.rounds, 1, 3, 2),
      prepSeconds: num(raw.prepSeconds, 60, 240, 120, 30),
      pitchSeconds: num(raw.pitchSeconds, 45, 120, 75, 15),
    }
  },

  create(ctx) {
    const teams: PTeam[] = ctx.teams.map((t) => ({
      id: t.id, name: t.name,
      memberIds: t.playerIds.filter((id) => ctx.players.some((p) => p.id === id && p.teamId === t.id)),
    }))
    const players: PPlayer[] = ctx.players
      .filter((p) => teams.some((t) => t.id === p.teamId))
      .map((p) => ({ id: p.id, name: p.name, teamId: p.teamId, gone: false }))
    const s: State = {
      settings: ctx.settings,
      phase: 'prep',
      stage: 0,
      endsAt: null,
      round: 0,
      order: [],
      pitchIdx: 0,
      players,
      teams,
      pitcherOffset: Object.fromEntries(teams.map((t) => [t.id, Math.floor(ctx.random() * Math.max(1, t.memberIds.length))])),
      askOptions: [],
      teamRounds: {},
      hands: {},
      current: null,
      cheques: {},
      wallets: {},
      decks: {
        products: shuffle(range(PRODUCTS.length), ctx.random),
        twists: shuffle(range(TWISTS.length), ctx.random),
        questions: shuffle(range(QUESTIONS.length), ctx.random),
        curveballs: shuffle(range(CURVEBALLS.length), ctx.random),
      },
      history: [],
      money: Object.fromEntries(teams.map((t) => [t.id, 0])),
      stats: Object.fromEntries(players.map((p) => [p.id, { invested: 0, fired: 0, curveballs: 0, cheques: 0 }])),
      seq: 0,
    }
    startRound(s, ctx, 0)
    return s
  },

  view: (s, viewerId) => view(s, viewerId),
  action,
  deadline: (s) => s.endsAt,
  tick,
  onPlayerGone,
  scores: (s) => Object.fromEntries(Object.entries(s.money).map(([id, lakh]) => [id, crore(lakh)])),
  isOver: (s) => s.phase === 'over',
  results,
}
