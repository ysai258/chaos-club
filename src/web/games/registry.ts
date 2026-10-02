import type { WebGame } from './types.ts'
import { bombSquadWeb } from './bomb-squad/index.tsx'
import { overheardWeb } from './overheard/index.tsx'
import { friendCourtWeb } from './friend-court/index.tsx'
import { pitchWarsWeb } from './pitch-wars/index.tsx'
import { theMoleWeb } from './the-mole/index.tsx'
import { sketchRelayWeb } from './sketch-relay/index.tsx'

export const webGames: Record<string, WebGame> = Object.fromEntries(
  [bombSquadWeb, overheardWeb, friendCourtWeb, pitchWarsWeb, theMoleWeb, sketchRelayWeb].map((g) => [g.id, g]),
)
