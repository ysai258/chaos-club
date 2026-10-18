import { useState, type FormEvent } from 'react'
import type { PlayerInfo, TeamInfo } from '../../shared/protocol.ts'
import { startBlocker } from '../../shared/start-check.ts'
import type { RoomView } from '../lib/room-context.ts'
import { GameCard } from '../components/GameCard.tsx'
import { HowToVideoButton } from '../components/HowToVideo.tsx'
import { SettingsForm } from '../components/SettingsForm.tsx'
import { ShareButton } from '../components/ShareButton.tsx'
import { Avatar, Badge, Button, Card, COLOR, Input, MuteToggle, Sheet, Spinner, Stepper, cn, haptic, playSound } from '../ui/index.ts'

export function Lobby({ v }: { v: RoomView }) {
  const { room, me, isHost, host, games, game, send } = v
  const [moving, setMoving] = useState<PlayerInfo | null>(null)
  const [renaming, setRenaming] = useState<TeamInfo | null>(null)
  const [confirmKick, setConfirmKick] = useState(false)

  const byId = new Map(room.players.map((p) => [p.id, p]))
  const connectedCount = room.players.filter((p) => p.connected).length
  const blocker = game
    ? startBlocker(
        game.meta,
        room.teams.map((t) => ({ name: t.name, size: t.playerIds.filter((id) => byId.get(id)?.connected).length })),
      )
    : 'Loading games…'
  const teamRange = game?.meta.teams ?? { min: 1, max: 6 }

  const openMove = (p: PlayerInfo) => {
    if (!isHost && p.id !== me.id) return
    haptic('tap')
    setConfirmKick(false)
    setMoving(p)
  }

  const start = () => {
    playSound('whoosh')
    send({ t: 'room/start' })
  }

  return (
    <div className="flex min-h-dvh flex-col" data-testid="lobby">
      {/* Top bar */}
      <header className="safe-x sticky top-0 z-30 border-b-3 border-ink bg-paper/95 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col leading-none">
            <span className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-ink-soft">Room code</span>
            <span className="font-chunky text-[1.75rem] tracking-wider" data-testid="room-code">{room.code}</span>
          </div>
          <ShareButton code={room.code} size="sm" color="sky" />
          <MuteToggle />
        </div>
      </header>

      <main className="safe-x mx-auto flex w-full max-w-xl flex-1 flex-col gap-9 pt-5 pb-8">
        {/* Hello */}
        <div className="flex items-center gap-3">
          <Avatar emoji={me.avatar} size="lg" host={me.isHost} />
          <div className="min-w-0">
            <p className="truncate font-display text-2xl font-extrabold">Hey {me.name}!</p>
            <p className="text-ink-soft">
              {isHost ? (
                <>You&apos;re the host <span aria-hidden>👑</span> Set teams, pick a game, hit start.</>
              ) : (
                <>{host ? <b>{host.name}</b> : 'The host'} is running the show. Pick a team while you wait.</>
              )}
            </p>
          </div>
        </div>

        {/* Teams */}
        <section className="flex flex-col gap-4" aria-labelledby="teams-h">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="teams-h" className="text-3xl">
              Teams <Badge size="md" className="ml-1 align-middle">{connectedCount} here</Badge>
            </h2>
            {isHost && (
              <div className="flex items-center gap-2">
                {teamRange.max > teamRange.min && (
                  <Stepper
                    label="Number of teams"
                    value={room.teams.length}
                    min={teamRange.min}
                    max={Math.min(6, teamRange.max)}
                    suffix={<span className="ml-1 text-sm font-bold">teams</span>}
                    onChange={(count) => send({ t: 'room/setTeams', count })}
                  />
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  icon="🔀"
                  onClick={() => {
                    playSound('whoosh')
                    send({ t: 'room/shuffleTeams' })
                  }}
                >
                  Shuffle
                </Button>
              </div>
            )}
          </div>

          <div className={cn('grid grid-cols-1 gap-4', room.teams.length > 1 && 'sm:grid-cols-2')}>
            {room.teams.map((team, i) => {
              const mine = me.teamId === team.id
              return (
                <Card
                  key={team.id}
                  color={team.color}
                  soft
                  padding="sm"
                  tilt={i % 2 ? 'right' : 'left'}
                  className="flex min-w-0 flex-col gap-3"
                  data-testid={`team-${i}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl border-3 border-ink text-2xl', COLOR[team.color].bg)} aria-hidden>
                      {team.emoji}
                    </span>
                    <h3 className="min-w-0 flex-1 truncate text-lg leading-tight" data-testid="team-name">{team.name}</h3>
                    {mine && <Badge color="ink">yours</Badge>}
                    {isHost && (
                      <button
                        type="button"
                        aria-label={`Rename ${team.name}`}
                        onClick={() => setRenaming(team)}
                        className="grid size-11 shrink-0 place-items-center rounded-xl border-2 border-ink bg-white text-lg active:scale-90"
                      >
                        ✏️
                      </button>
                    )}
                  </div>
                  <ul className="flex flex-wrap gap-2">
                    {team.playerIds.length === 0 && <li className="px-1 py-2 text-ink-soft">Nobody yet <span aria-hidden>👻</span></li>}
                    {team.playerIds.map((id) => {
                      const p = byId.get(id)
                      if (!p) return null
                      const tappable = isHost || p.id === me.id
                      return (
                        <li key={id} className="animate-pop">
                          <button
                            type="button"
                            disabled={!tappable}
                            onClick={() => openMove(p)}
                            data-testid="player-chip"
                            className={cn(
                              'flex h-11 max-w-[14rem] items-center gap-2 rounded-full border-2 border-ink bg-white pr-3 pl-1 font-semibold',
                              tappable && 'shadow-hard-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none',
                              !tappable && 'cursor-default',
                              !p.connected && 'opacity-60',
                            )}
                          >
                            <Avatar emoji={p.avatar} size="xs" connected={p.connected} />
                            <span className="truncate">{p.name}</span>
                            {p.isHost && <span aria-label="host">👑</span>}
                            {p.id === me.id && <Badge color="ink">you</Badge>}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {!mine && (
                    <Button size="sm" variant="secondary" icon="👉" className="self-start" onClick={() => send({ t: 'room/movePlayer', playerId: me.id, teamId: team.id })}>
                      Join this team
                    </Button>
                  )}
                </Card>
              )
            })}
          </div>
          {isHost && <p className="text-sm text-ink-soft">Tip: tap a player to move or remove them.</p>}
        </section>

        {/* Game */}
        <section className="flex flex-col gap-4" aria-labelledby="game-h">
          <h2 id="game-h" className="text-3xl">{isHost ? 'Pick a game' : 'The game'}</h2>
          {games === null ? (
            <div className="grid place-items-center py-6"><Spinner size="lg" /></div>
          ) : (
            <>
              {isHost && (
                <div className="grid grid-cols-2 gap-3" role="list" aria-label="Games">
                  {games.map((g, i) => (
                    <div role="listitem" key={g.id}>
                      <GameCard
                        game={g}
                        index={i}
                        compact
                        selected={g.id === room.gameId}
                        onClick={() => {
                          if (g.id !== room.gameId) {
                            playSound('pop')
                            send({ t: 'room/pickGame', gameId: g.id })
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
              {game && (
                <div className="flex flex-col gap-4" key={game.id} data-testid="selected-game">
                  <GameCard game={game} />
                  <Card className="flex flex-col gap-3" tilt="right">
                    <h3 className="text-xl">How to play <span aria-hidden>📜</span></h3>
                    <ol className="flex flex-col gap-2.5">
                      {game.meta.howToPlay.map((line, i) => (
                        <li key={i} className="flex gap-3">
                          <span className={cn('grid size-7 shrink-0 place-items-center rounded-full border-2 border-ink font-display text-sm font-black', COLOR[game.meta.color].bg)}>
                            {i + 1}
                          </span>
                          <span className="pt-0.5 leading-snug">{line}</span>
                        </li>
                      ))}
                    </ol>
                    <HowToVideoButton gameId={game.id} name={game.meta.name} emoji={game.meta.emoji} color={game.meta.color} howToPlay={game.meta.howToPlay} />
                  </Card>
                  {game.settingsSpec.length > 0 && (
                    <Card className="flex flex-col gap-3" tilt="left" data-testid="settings">
                      <h3 className="text-xl">Settings <span aria-hidden>🎛️</span></h3>
                      <SettingsForm
                        spec={game.settingsSpec}
                        values={room.settings}
                        editable={isHost}
                        onChange={(patch) => send({ t: 'room/settings', settings: { ...room.settings, ...patch } })}
                      />
                    </Card>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {/* Start bar */}
      <footer className="safe-x sticky bottom-0 z-30 border-t-3 border-ink bg-paper/95 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-xl flex-col gap-2">
          {isHost ? (
            <>
              <p className={cn('min-h-5 text-center text-sm font-bold', blocker ? 'text-tomato' : 'text-ink-soft')} data-testid="start-blocker">
                {blocker ? <>⚠️ {blocker}</> : <>All set. Phones up, everyone! <span aria-hidden>📱</span></>}
              </p>
              <Button size="xl" block icon={game?.meta.emoji ?? '🚀'} disabled={!!blocker} onClick={start} data-testid="start-game">
                Start {game?.meta.name ?? 'game'}
              </Button>
            </>
          ) : (
            <div className="flex min-h-16 items-center justify-center gap-3 rounded-3xl border-3 border-dashed border-ink/40 px-4 text-center font-display font-bold">
              <Spinner size="sm" /> Waiting for {host?.name ?? 'the host'} to start{game ? ` ${game.meta.name}` : ''}…
            </div>
          )}
        </div>
      </footer>

      {/* Move / kick sheet */}
      <Sheet open={!!moving} onClose={() => setMoving(null)} title={moving ? (moving.id === me.id ? 'Switch team' : `Move ${moving.name}`) : ''}>
        {moving && (
          <div className="flex flex-col gap-3 pt-1">
            {room.teams.map((t) => {
              const here = t.id === moving.teamId
              return (
                <Button
                  key={t.id}
                  color={t.color}
                  size="lg"
                  block
                  disabled={here}
                  icon={t.emoji}
                  className="justify-start"
                  onClick={() => {
                    send({ t: 'room/movePlayer', playerId: moving.id, teamId: t.id })
                    setMoving(null)
                  }}
                >
                  {t.name} {here && '(here now)'}
                </Button>
              )
            })}
            {isHost && moving.id !== me.id && (
              <div className="mt-3 border-t-2 border-dashed border-ink/25 pt-4">
                <Button
                  variant={confirmKick ? 'danger' : 'secondary'}
                  block
                  icon="🥾"
                  onClick={() => {
                    if (!confirmKick) return setConfirmKick(true)
                    send({ t: 'room/kick', playerId: moving.id })
                    setMoving(null)
                  }}
                >
                  {confirmKick ? `Tap again to kick ${moving.name}` : `Remove ${moving.name} from the room`}
                </Button>
              </div>
            )}
          </div>
        )}
      </Sheet>

      {/* Rename sheet */}
      <Sheet open={!!renaming} onClose={() => setRenaming(null)} title="Rename team">
        {renaming && <RenameForm team={renaming} onSave={(name) => {
          send({ t: 'room/renameTeam', teamId: renaming.id, name })
          setRenaming(null)
        }} />}
      </Sheet>
    </div>
  )
}

function RenameForm({ team, onSave }: { team: TeamInfo; onSave: (name: string) => void }) {
  const [name, setName] = useState(team.name)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) onSave(name.trim())
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 pt-1">
      <Input label="Team name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} autoFocus enterKeyHint="done" />
      <Button type="submit" size="lg" block icon="✨" disabled={!name.trim()}>Save name</Button>
    </form>
  )
}
