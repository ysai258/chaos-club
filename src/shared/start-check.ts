/**
 * Why a game can't start yet, as a sentence for a human — or null when it can.
 *
 * Shared by the server (authoritative) and the lobby (to explain a disabled
 * Start button). Pure: no I/O, no game imports.
 */
import type { GameMeta } from '../games/types.ts'

export interface StartCheckTeam {
  name: string
  /** Connected players on this team. */
  size: number
}

export function startBlocker(
  meta: Pick<GameMeta, 'minPlayers' | 'maxPlayers' | 'teams' | 'minTeamSize'>,
  teams: StartCheckTeam[],
): string | null {
  const players = teams.reduce((n, t) => n + t.size, 0)
  if (players < meta.minPlayers) {
    const more = meta.minPlayers - players
    return `Need ${more} more player${more === 1 ? '' : 's'} (min ${meta.minPlayers})`
  }
  if (players > meta.maxPlayers) return `Too many players for this one (max ${meta.maxPlayers})`
  const { min, max } = meta.teams
  if (teams.length < min || teams.length > max) {
    return min === max ? `This game needs exactly ${min} teams` : `This game needs ${min}–${max} teams`
  }
  const minSize = Math.max(1, meta.minTeamSize)
  const short = teams.find((t) => t.size < minSize)
  if (short) {
    return minSize === 1
      ? `${short.name} is empty — every team needs a player`
      : `Each team needs at least ${minSize} players`
  }
  return null
}
