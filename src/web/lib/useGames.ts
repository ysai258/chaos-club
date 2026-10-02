import { useEffect, useState } from 'react'
import { fetchGames, type GameInfo } from './api.ts'

/** Registered games from the server, or null while loading. */
export function useGames(): GameInfo[] | null {
  const [games, setGames] = useState<GameInfo[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = (attempt: number) =>
      fetchGames().then(
        (g) => alive && setGames(g),
        () => alive && attempt < 5 && setTimeout(() => load(attempt + 1), 1000 * (attempt + 1)),
      )
    void load(0)
    return () => {
      alive = false
    }
  }, [])
  return games
}
