import type { AnyGame } from './types.ts'
import { bombSquad } from './bomb-squad/index.ts'
import { overheard } from './overheard/index.ts'
import { friendCourt } from './friend-court/index.ts'
import { pitchWars } from './pitch-wars/index.ts'
import { theMole } from './the-mole/index.ts'
import { sketchRelay } from './sketch-relay/index.ts'

export const games: Record<string, AnyGame> = Object.fromEntries(
  [bombSquad, overheard, friendCourt, pitchWars, theMole, sketchRelay].map((g) => [g.id, g]),
)
