// STUB — replaced by the Silent Sketch Relay game agent.
import type { GameDefinition } from '../types.ts'

interface State { over: boolean }

export const sketchRelay: GameDefinition<State> = {
  id: 'sketch-relay',
  meta: {
    name: 'Silent Sketch Relay', emoji: '✏️', tagline: 'Coming soon', howToPlay: ['Coming soon'],
    minPlayers: 2, maxPlayers: 16, teams: { min: 2, max: 2 }, minTeamSize: 1,
    estimatedMinutes: 10, teamChat: false, color: 'bubblegum',
  },
  settingsSpec: [],
  parseSettings: () => ({}),
  create: () => ({ over: false }),
  view: () => ({}),
  action: (state) => ({ state, error: 'Not implemented' }),
  deadline: () => null,
  tick: (state) => ({ state }),
  onPlayerGone: (state) => ({ state }),
  scores: () => ({}),
  isOver: (s) => s.over,
  results: () => ({ highlights: [] }),
}
