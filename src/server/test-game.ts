/**
 * "Test Lab" — a tiny platform-owned game used by the platform's unit and e2e
 * tests (and as a reference for game builders). Registered only when
 * CHAOS_TEST_GAME=1, never in production.
 *
 * Exercises: settings of every kind, deadlines and chained ticks, per-viewer
 * secrets, team/player-addressed events, onPlayerGone, results with awards.
 */
import type { GameDefinition } from '../games/types.ts'
import type { PlayerId, TeamId } from '../shared/protocol.ts'

export const TEST_GAME_ID = 'test-lab'

export interface TestSettings extends Record<string, unknown> {
  rounds: number
  roundSeconds: number
  mode: 'calm' | 'chaos'
  bonus: boolean
}

export interface TestState {
  round: number
  rounds: number
  roundSeconds: number
  deadline: number | null
  scores: Record<TeamId, number>
  secrets: Record<TeamId, string>
  taps: Record<PlayerId, number>
  gone: PlayerId[]
  over: boolean
  bonus: boolean
}

export interface TestView {
  round: number
  rounds: number
  /** Only the viewer's own team's secret. */
  secret: string | null
  myTaps: number
  gone: PlayerId[]
  spectator: boolean
}

const WORDS = ['mango', 'chai', 'samosa', 'auto', 'jalebi', 'monsoon', 'cricket', 'biryani']

export const testGame: GameDefinition<TestState, TestSettings> = {
  id: TEST_GAME_ID,
  meta: {
    name: 'Test Lab',
    emoji: '🧪',
    tagline: 'A tiny game that pokes every platform feature.',
    howToPlay: ['Tap to score for your team.', 'Each round has a timer.', 'Most points when the rounds run out wins.'],
    minPlayers: 2,
    maxPlayers: 24,
    teams: { min: 2, max: 4 },
    minTeamSize: 1,
    estimatedMinutes: 1,
    teamChat: true,
    color: 'grape',
  },
  settingsSpec: [
    { key: 'rounds', label: 'Rounds', kind: 'number', min: 1, max: 5, default: 1 },
    { key: 'roundSeconds', label: 'Seconds per round', kind: 'number', min: 5, max: 120, step: 5, default: 60 },
    { key: 'mode', label: 'Mode', kind: 'select', options: [{ value: 'calm', label: 'Calm' }, { value: 'chaos', label: 'Chaos' }], default: 'calm' },
    { key: 'bonus', label: 'Bonus points', kind: 'toggle', default: false },
  ],
  parseSettings(raw) {
    const num = (v: unknown, min: number, max: number, d: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d
    return {
      rounds: num(raw.rounds, 1, 5, 1),
      roundSeconds: num(raw.roundSeconds, 5, 120, 60),
      mode: raw.mode === 'chaos' ? 'chaos' : 'calm',
      bonus: raw.bonus === true,
    }
  },
  create(ctx) {
    const secrets: Record<TeamId, string> = {}
    const scores: Record<TeamId, number> = {}
    for (const t of ctx.teams) {
      secrets[t.id] = WORDS[Math.floor(ctx.random() * WORDS.length)]!
      scores[t.id] = 0
    }
    return {
      round: 1,
      rounds: ctx.settings.rounds,
      roundSeconds: ctx.settings.roundSeconds,
      deadline: ctx.now + ctx.settings.roundSeconds * 1000,
      scores,
      secrets,
      taps: {},
      gone: [],
      over: false,
      bonus: ctx.settings.bonus,
    }
  },
  view(state, viewerId, ctx) {
    const me = ctx.players.find((p) => p.id === viewerId)
    return {
      round: state.round,
      rounds: state.rounds,
      secret: me ? (state.secrets[me.teamId] ?? null) : null,
      myTaps: state.taps[viewerId] ?? 0,
      gone: state.gone,
      spectator: !me,
    } satisfies TestView
  },
  action(state, playerId, action, ctx) {
    const me = ctx.players.find((p) => p.id === playerId)
    if (!me) return { state, error: 'Not in this game' }
    switch (action.type) {
      case 'point': {
        if (action.payload.round !== undefined && action.payload.round !== state.round) return { state, error: 'That was last round!' }
        const add = state.bonus ? 2 : 1
        return {
          state: {
            ...state,
            scores: { ...state.scores, [me.teamId]: (state.scores[me.teamId] ?? 0) + add },
            taps: { ...state.taps, [playerId]: (state.taps[playerId] ?? 0) + 1 },
          },
          events: [{ type: 'point', data: { by: playerId }, to: { teamId: me.teamId } }],
        }
      }
      case 'whisper':
        return { state, events: [{ type: 'whisper', data: { text: 'psst' }, to: { playerIds: [playerId] } }] }
      case 'shout':
        return { state, events: [{ type: 'shout', data: { by: playerId } }] }
      case 'skip':
        // Pull the deadline to now so the platform ticks immediately.
        return { state: { ...state, deadline: ctx.now } }
      case 'finish':
        if (playerId !== ctx.hostId) return { state, error: 'Only the host can finish' }
        return { state: { ...state, over: true, deadline: null } }
      case 'explode':
        throw new Error('test-lab exploded on purpose')
      default:
        return { state, error: `Unknown action ${action.type}` }
    }
  },
  deadline: (state) => (state.over ? null : state.deadline),
  tick(state, ctx) {
    if (state.round >= state.rounds) return { state: { ...state, over: true, deadline: null }, events: [{ type: 'timeup' }] }
    return {
      state: { ...state, round: state.round + 1, deadline: ctx.now + state.roundSeconds * 1000 },
      events: [{ type: 'round', data: { round: state.round + 1 } }],
    }
  },
  onPlayerGone(state, playerId) {
    return { state: { ...state, gone: [...state.gone, playerId] } }
  },
  scores: (state) => state.scores,
  isOver: (state) => state.over,
  results(state, ctx) {
    const best = Object.entries(state.taps).sort((a, b) => b[1] - a[1])[0]
    const name = (id: string) => ctx.players.find((p) => p.id === id)?.name ?? 'Someone'
    return {
      highlights: best ? [`${name(best[0])} tapped ${best[1]} times. Calm down.`, 'Nobody read the instructions.'] : ['A quiet game. Suspiciously quiet.'],
      awards: best ? [{ playerId: best[0], title: 'Fastest Thumb', emoji: '👍' }] : [],
    }
  },
}
