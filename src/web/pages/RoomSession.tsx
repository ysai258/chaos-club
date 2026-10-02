import { useEffect, useMemo } from 'react'
import { useLocation } from 'wouter'
import type { ClientMessage } from '../../shared/protocol.ts'
import { useRoomClient } from '../lib/useRoom.ts'
import { useGames } from '../lib/useGames.ts'
import type { Profile } from '../lib/storage.ts'
import type { RoomView } from '../lib/room-context.ts'
import { Button, ClockContext, Spinner, toast } from '../ui/index.ts'
import { ConnectionBanner } from '../components/ConnectionBanner.tsx'
import { FullScreenMessage } from './FullScreenMessage.tsx'
import { Lobby } from './Lobby.tsx'
import { GameView } from './GameView.tsx'
import { Results } from './Results.tsx'

export function RoomSession({ code, profile }: { code: string; profile: Profile }) {
  const [, navigate] = useLocation()
  const { client, state } = useRoomClient(code, profile)
  const games = useGames()

  useEffect(() => {
    if (!client) return
    return client.onError((_code, message) => toast(message, { kind: 'error' }))
  }, [client])

  const room = state.room
  const view = useMemo<RoomView | null>(() => {
    if (!client || !room) return null
    const me = room.players.find((p) => p.id === room.you)
    if (!me) return null
    return {
      room,
      me,
      isHost: me.isHost,
      host: room.players.find((p) => p.isHost),
      client,
      games,
      game: games?.find((g) => g.id === room.gameId),
      status: state.status,
      joinedMidGame: state.joinedMidGame,
      send: (msg: ClientMessage) => client.send(msg),
    }
  }, [client, room, games, state.status, state.joinedMidGame])

  if (state.fatal) {
    const f = state.fatal
    return (
      <FullScreenMessage
        emoji={f.code === 'kicked' ? '🥾' : f.code === 'room_closed' ? '🚪' : '🕳️'}
        title={f.code === 'kicked' ? 'Booted!' : f.code === 'room_closed' ? 'Party over' : 'No such room'}
        color="tomato"
        actions={<Button size="lg" block icon="🏠" onClick={() => navigate('/')}>Back home</Button>}
      >
        {f.message}
      </FullScreenMessage>
    )
  }

  if (!view || !client) {
    return (
      <FullScreenMessage emoji="🚪" title={`Joining ${code}…`}>
        <div className="flex justify-center py-2">
          <Spinner size="lg" />
        </div>
      </FullScreenMessage>
    )
  }

  return (
    <ClockContext.Provider value={client.now}>
      <ConnectionBanner status={state.status} />
      {view.room.phase === 'lobby' ? <Lobby v={view} /> : view.room.phase === 'playing' ? <GameView v={view} /> : <Results v={view} />}
    </ClockContext.Provider>
  )
}
