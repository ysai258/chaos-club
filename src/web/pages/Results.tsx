import { useEffect, useRef } from 'react'
import type { TeamInfo } from '../../shared/protocol.ts'
import type { RoomView } from '../lib/room-context.ts'
import { Avatar, BigText, Button, Card, COLOR, MuteToggle, Spinner, celebrate, cn, haptic, playSound } from '../ui/index.ts'

const MEDAL = ['🥇', '🥈', '🥉']
const PODIUM_HEIGHT = ['h-36', 'h-24', 'h-16']

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!)
}

export function Results({ v }: { v: RoomView }) {
  const { room, me, isHost, host, game, send } = v
  const results = room.results
  const teamById = new Map(room.teams.map((t) => [t.id, t]))
  const playerById = new Map(room.players.map((p) => [p.id, p]))
  const ranking = (results?.ranking ?? []).filter((r) => teamById.has(r.teamId))
  const winners = ranking.filter((r) => r.rank === 1)
  const myRank = ranking.find((r) => r.teamId === me.teamId)
  const iWon = myRank?.rank === 1 && winners.length < ranking.length
  const tie = winners.length > 1
  const allTied = winners.length === ranking.length && ranking.length > 1
  const celebrated = useRef(false)

  useEffect(() => {
    if (celebrated.current) return
    celebrated.current = true
    // Confetti is for the winners only; everyone else gets a polite jingle.
    if (iWon) {
      void celebrate('big')
      playSound('win')
      haptic('success')
    } else {
      playSound('success')
    }
  }, [iWon])

  const winnerTeam = winners[0] ? teamById.get(winners[0].teamId) : undefined
  // Podium order: 2nd, 1st, 3rd.
  const top = ranking.slice(0, 3)
  const podium = top.length >= 3 ? [top[1]!, top[0]!, top[2]!] : top.length === 2 ? [top[1]!, top[0]!] : top

  return (
    <div className="flex min-h-dvh flex-col" data-testid="results">
      <header className="safe-x safe-top mx-auto flex w-full max-w-xl items-center justify-between gap-2">
        <span className="-rotate-2 rounded-lg border-2 border-ink bg-sun px-2 py-0.5 font-chunky text-sm">{room.code}</span>
        <span className="truncate font-display font-extrabold">
          {game?.meta.emoji} {game?.meta.name}
        </span>
        <MuteToggle />
      </header>

      <main className="safe-x mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 pt-6 pb-8">
        {/* Headline */}
        <section className="flex flex-col items-center gap-3 text-center">
          <span className="animate-float text-6xl" aria-hidden>{allTied ? '🤝' : iWon ? '🏆' : tie ? '⚖️' : '🎉'}</span>
          <BigText size="xl" color={winnerTeam?.color ?? 'sun'} as="h1" className="max-w-full" >
            {allTied ? "It's a tie!" : tie ? 'Shared glory!' : `${winnerTeam?.name ?? 'Someone'} win!`}
          </BigText>
          {myRank && !allTied && (
            <p className="font-display text-xl font-bold" data-testid="my-rank">
              {myRank.rank === 1 ? 'Your team took it. Act humble. 😌' : `Your team came ${ordinal(myRank.rank)}. There's always a rematch. 😤`}
            </p>
          )}
        </section>

        {/* Podium */}
        {podium.length > 0 && (
          <section aria-label="Podium" className="flex items-end justify-center gap-2 px-1 sm:gap-4">
            {podium.map((r) => {
              const t = teamById.get(r.teamId)!
              const place = Math.min(r.rank, 3) - 1
              return (
                <div key={r.teamId} className="flex min-w-0 flex-1 animate-pop flex-col items-center gap-2" style={{ animationDelay: `${(2 - place) * 0.15}s` }}>
                  <span className="text-4xl" aria-hidden>{t.emoji}</span>
                  <span className="line-clamp-2 text-center font-display text-sm leading-tight font-extrabold">{t.name}</span>
                  <div
                    className={cn(
                      'flex w-full flex-col items-center justify-start gap-1 rounded-t-2xl border-3 border-b-0 border-ink pt-2 shadow-hard',
                      COLOR[t.color].bg,
                      PODIUM_HEIGHT[place],
                    )}
                  >
                    <span className="text-3xl leading-none" aria-hidden>{MEDAL[place]}</span>
                    <span className="font-chunky text-xl tabular-nums" data-testid="podium-score">{r.score}</span>
                  </div>
                </div>
              )
            })}
          </section>
        )}

        {/* Full ranking when more than the podium */}
        {ranking.length > 3 && (
          <Card padding="sm" className="flex flex-col gap-2">
            {ranking.slice(3).map((r) => {
              const t = teamById.get(r.teamId)!
              return <RankRow key={r.teamId} rank={r.rank} team={t} score={r.score} />
            })}
          </Card>
        )}

        {/* Highlights */}
        {results && results.highlights.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-2xl">Highlights <span aria-hidden>📸</span></h2>
            {results.highlights.map((h, i) => (
              <Card
                key={i}
                color={(['sun', 'bubblegum', 'sky', 'lime', 'grape', 'tomato'] as const)[i % 6]}
                soft
                padding="sm"
                tilt={i % 2 ? 'right' : 'left'}
                className="animate-pop font-display text-lg font-bold"
                style={{ animationDelay: `${0.4 + i * 0.12}s` }}
              >
                {h}
              </Card>
            ))}
          </section>
        )}

        {/* Awards */}
        {results?.awards && results.awards.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-2xl">Awards <span aria-hidden>🏅</span></h2>
            <div className="grid grid-cols-2 gap-3">
              {results.awards.map((a, i) => {
                const p = playerById.get(a.playerId)
                const t = p?.teamId ? teamById.get(p.teamId) : undefined
                return (
                  <Card key={i} padding="sm" tilt={i % 2 ? 'right' : 'left'} className="flex animate-pop flex-col items-center gap-1 text-center" style={{ animationDelay: `${0.6 + i * 0.12}s` }}>
                    <span className="text-4xl" aria-hidden>{a.emoji}</span>
                    <span className="font-display leading-tight font-extrabold">{a.title}</span>
                    <span className="flex max-w-full items-center gap-1.5 text-sm font-semibold">
                      <Avatar emoji={p?.avatar ?? '👤'} size="xs" {...(t ? { color: t.color } : {})} />
                      <span className="truncate">{p?.name ?? 'Someone who left'}</span>
                    </span>
                  </Card>
                )
              })}
            </div>
          </section>
        )}
      </main>

      <footer className="safe-x sticky bottom-0 z-30 border-t-3 border-ink bg-paper/95 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-xl flex-col gap-2">
          {isHost ? (
            <>
              <Button size="xl" block icon="🔁" onClick={() => send({ t: 'room/playAgain' })} data-testid="play-again">
                Play again
              </Button>
              <Button variant="secondary" block icon="🛋️" onClick={() => send({ t: 'room/backToLobby' })} data-testid="back-to-lobby">
                Back to lobby
              </Button>
            </>
          ) : (
            <div className="flex min-h-16 items-center justify-center gap-3 rounded-3xl border-3 border-dashed border-ink/40 px-4 text-center font-display font-bold">
              <Spinner size="sm" /> {host?.name ?? 'The host'} decides what&apos;s next…
            </div>
          )}
        </div>
      </footer>
    </div>
  )
}

function RankRow({ rank, team, score }: { rank: number; team: TeamInfo; score: number }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border-2 border-ink bg-white px-3 py-2">
      <span className="w-8 font-chunky text-sm">{ordinal(rank)}</span>
      <span className={cn('grid size-9 place-items-center rounded-lg border-2 border-ink text-lg', COLOR[team.color].bg)} aria-hidden>{team.emoji}</span>
      <span className="min-w-0 flex-1 truncate font-display font-extrabold">{team.name}</span>
      <span className="font-chunky tabular-nums">{score}</span>
    </div>
  )
}
