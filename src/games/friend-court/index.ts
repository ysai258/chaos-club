import type { GameDefinition } from '../types.ts'
import * as E from './engine.ts'

export type { State, Settings } from './engine.ts'

export const friendCourt: GameDefinition<E.State, E.Settings> = {
  id: 'friend-court',
  meta: {
    name: 'Friend Court',
    emoji: '⚖️',
    tagline: 'Your friends are on trial. The evidence is ridiculous. Argue anyway.',
    howToPlay: [
      'Each case puts a real player on trial for something absurd. One team prosecutes, the other defends — sides swap every case.',
      'You get secret evidence cards. When you hold the floor, argue out loud on the call and tap a card to enter it as an exhibit (+1 each, max 2 per speech).',
      "Not speaking? Slip your lawyer a note (one card per case) — they'll have to use it. Or smash OBJECTION! to interrupt the other side.",
      'The judge (a rotating player who sits the case out) rules SUSTAINED (+1 objector, last exhibit struck) or OVERRULED (+1 speaker).',
      'Guilty or not guilty? The verdict wins the case (+3). With 3+ teams, the teams not arguing are the jury.',
      'Vote "respect" for the best performer on the OTHER side — bragging rights only.',
    ],
    minPlayers: 3,
    maxPlayers: 16,
    teams: { min: 2, max: 4 },
    minTeamSize: 1,
    estimatedMinutes: 15,
    teamChat: true,
    color: 'grape',
  },
  settingsSpec: [
    { key: 'cases', label: 'Cases', kind: 'select', default: '4', options: [
      { value: '2', label: '2 cases (~7 min)' },
      { value: '4', label: '4 cases (~15 min)' },
      { value: '6', label: '6 cases (~22 min)' },
    ] },
    { key: 'pace', label: 'Speech length', kind: 'select', default: 'normal', options: [
      { value: 'snappy', label: 'Snappy (30s / 20s)' },
      { value: 'normal', label: 'Normal (45s / 30s)' },
      { value: 'epic', label: 'Epic (60s / 40s)' },
    ] },
    { key: 'hostJudge', label: 'Host is always the judge', kind: 'toggle', default: false },
  ],
  parseSettings: E.parseSettings,
  create: E.create,
  view: E.view,
  action: E.action,
  deadline: E.deadline,
  tick: E.tick,
  onPlayerGone: E.onPlayerGone,
  scores: E.scores,
  isOver: E.isOver,
  results: E.results,
}
