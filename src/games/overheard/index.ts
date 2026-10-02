// STUB — replaced by the Overheard game agent.
import type { GameDefinition } from '../types.ts'

interface State { over: boolean }

export const overheard: GameDefinition<State> = {
  id: 'overheard',
  meta: {
    name: 'Overheard', emoji: '👂', tagline: 'Coming soon', howToPlay: ['Coming soon'],
    minPlayers: 2, maxPlayers: 16, teams: { min: 2, max: 2 }, minTeamSize: 1,
    estimatedMinutes: 10, teamChat: false, color: 'sky',
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
