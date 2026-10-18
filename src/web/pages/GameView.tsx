import { useCallback, useMemo, useState } from 'react'
import type { PlayerId, TeamId } from '../../shared/protocol.ts'
import type { GameScreenProps } from '../games/types.ts'
import { webGames } from '../games/registry.ts'
import { platformGames } from './TestLabScreen.tsx'
import type { RoomView } from '../lib/room-context.ts'
import { GameErrorBoundary } from '../components/ErrorBoundary.tsx'
import { TeamChat } from '../components/TeamChat.tsx'
import { HowToVideoButton } from '../components/HowToVideo.tsx'
import { Button, Card, Countdown, MuteToggle, Sheet, TeamPill, cn } from '../ui/index.ts'

/** Room chrome around a running game: header, scoreboard, timer, chat. */
export function GameView({ v }: { v: RoomView }) {
  const { room, me, isHost, client, game, send } = v
  const [menu, setMenu] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const web = webGames[room.gameId] ?? platformGames[room.gameId]

  const players = room.players
  const teams = room.teams
  const sendGame = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      client.send({ t: 'game', type, payload })
    },
    [client],
  )
  const onEvent = useCallback((h: (type: string, data: Record<string, unknown>) => void) => client.onEvent(h), [client])
  const player = useCallback((id: PlayerId) => players.find((p) => p.id === id), [players])
  const team = useCallback((id: TeamId) => teams.find((t) => t.id === id), [teams])

  const props = useMemo<GameScreenProps>(
    () => ({
      view: room.game?.view,
      me,
      players,
      teams,
      deadline: room.game?.deadline ?? null,
      scores: room.game?.scores ?? {},
      send: sendGame,
      onEvent,
      now: client.now,
      player,
      team,
      room,
    }),
    [room, me, players, teams, sendGame, onEvent, client, player, team],
  )

  const scores = room.game?.scores ?? {}
  const scoredTeams = teams.filter((t) => t.id in scores)
  const shownTeams = scoredTeams.length ? scoredTeams : teams
  const myTeam = me.teamId ? team(me.teamId) : undefined
  const Screen = web?.Screen
  const wide = shownTeams.length > 2

  return (
    <div className="flex min-h-dvh flex-col" data-testid="game-view">
      <header className="safe-x sticky top-0 z-30 border-b-3 border-ink bg-paper/95 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <span
            className="hidden shrink-0 -rotate-3 rounded-lg border-2 border-ink bg-sun px-1.5 py-0.5 font-chunky text-xs min-[400px]:inline-block"
            title="Room code"
            data-testid="room-code"
          >
            {room.code}
          </span>
          <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1 pl-0.5" aria-label="Scores" data-testid="scoreboard">
            {shownTeams.map((t) => (
              <TeamPill key={t.id} team={t} score={scores[t.id] ?? 0} size="sm" compact={wide} className={cn(t.id === me.teamId && 'outline-2 outline-offset-1 outline-ink')} />
            ))}
          </div>
          <MuteToggle />
          <button
            type="button"
            aria-label="Room menu"
            onClick={() => {
              setConfirmEnd(false)
              setMenu(true)
            }}
            className="grid size-11 shrink-0 place-items-center rounded-xl border-3 border-ink bg-white text-xl font-black shadow-hard-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
          >
            ⋯
          </button>
        </div>
        {room.game?.deadline != null && (
          <div className="mx-auto mt-2 max-w-3xl">
            <Countdown deadline={room.game.deadline} />
          </div>
        )}
      </header>

      {v.joinedMidGame && (
        <div className="safe-x mx-auto mt-3 w-full max-w-[520px]">
          <Card color="sky" soft padding="sm" shadow="sm" className="text-center text-sm font-bold">
            <span aria-hidden>🍿</span> You joined mid-game — enjoy the show. You&apos;re in from the next round.
          </Card>
        </div>
      )}

      <main className={cn('safe-x mx-auto flex w-full max-w-[520px] flex-1 flex-col pt-4', game?.meta.teamChat ? 'pb-28' : 'safe-bottom')}>
        {Screen ? (
          <GameErrorBoundary gameName={game?.meta.name ?? 'This game'}>
            <Screen {...props} />
          </GameErrorBoundary>
        ) : (
          <Card>Unknown game “{room.gameId}”.</Card>
        )}
      </main>

      {game?.meta.teamChat && me.teamId && (
        <TeamChat
          messages={room.teamChat}
          me={me}
          team={myTeam}
          players={players}
          onSend={(text) => client.send({ t: 'room/teamChat', text })}
        />
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title={`${game?.meta.emoji ?? '🎮'} ${game?.meta.name ?? 'Game'}`}>
        <div className="flex flex-col gap-4 pt-1">
          <div className="flex items-center justify-between gap-3 rounded-2xl border-3 border-ink bg-white p-3">
            <span className="font-bold">Room code</span>
            <span className="font-chunky text-xl tracking-wider">{room.code}</span>
          </div>
          {game && (
            <HowToVideoButton compact gameId={room.gameId} name={game.meta.name} emoji={game.meta.emoji} color={game.meta.color} howToPlay={game.meta.howToPlay} />
          )}
          {game && (
            <details className="rounded-2xl border-3 border-ink bg-white p-3">
              <summary className="min-h-8 cursor-pointer font-display font-extrabold">How to play</summary>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5">
                {game.meta.howToPlay.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
            </details>
          )}
          {isHost ? (
            <Button
              variant={confirmEnd ? 'danger' : 'secondary'}
              block
              icon="🛑"
              onClick={() => {
                if (!confirmEnd) return setConfirmEnd(true)
                send({ t: 'room/backToLobby' })
                setMenu(false)
              }}
            >
              {confirmEnd ? 'Tap again — end game for everyone' : 'End game & back to lobby'}
            </Button>
          ) : (
            <p className="text-center text-sm text-ink-soft">Only the host can end the game.</p>
          )}
        </div>
      </Sheet>
    </div>
  )
}
