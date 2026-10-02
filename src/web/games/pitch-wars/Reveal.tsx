import { useEffect, useState } from 'react'
import type { PwPitchRecord } from '../../../games/pitch-wars/shared.ts'
import { Avatar, Badge, Button, Card, celebrate, cn, haptic, playSound } from '../../ui/index.ts'
import { Poster } from './Poster.tsx'
import { money, teamColor, type Props } from './util.tsx'

const STEP_MS = 900

export function Reveal(props: Props) {
  const rec = props.view.reveal
  if (!rec) return null
  return <RevealInner key={`${rec.round}-${rec.teamId}`} rec={rec} {...props} />
}

function RevealInner({ rec, view, team, player, me, room, send }: Props & { rec: PwPitchRecord }) {
  const [shown, setShown] = useState(0)
  const n = rec.cheques.length
  const done = shown > n
  useEffect(() => {
    if (shown > n) return
    const id = setTimeout(() => {
      setShown((s) => s + 1)
      if (shown < n) { playSound('pop'); haptic('tap') }
    }, shown === 0 ? 600 : STEP_MS)
    return () => clearTimeout(id)
  }, [shown, n])
  useEffect(() => {
    if (!done) return
    if (rec.deal) {
      playSound('win'); haptic('success')
      if (me.teamId === rec.teamId) void celebrate('big')
      else void celebrate('small')
    } else {
      playSound('buzz'); haptic('error')
    }
  }, [done, rec.deal, rec.teamId, me.teamId])

  const t = team(rec.teamId)
  // running total from revealed cheques, per-team average like the server
  const visible = rec.cheques.slice(0, shown)
  const runningByTeam = new Map<string, number[]>()
  for (const c of visible) if (c.amount !== null) runningByTeam.set(c.teamId, [...(runningByTeam.get(c.teamId) ?? []), c.amount])
  const running = done ? rec.total : [...runningByTeam.values()].reduce((a, xs) => a + Math.round(xs.reduce((x, y) => x + y, 0) / xs.length), 0)
  const scaleMax = Math.max(rec.draft.ask, rec.total, 1) * 1.15
  const isHost = room.players.find((p) => p.id === me.id)?.isHost

  return (
    <div className="flex flex-col gap-4" data-testid="pw-reveal">
      <div className="text-center">
        <p className="font-display text-sm font-black uppercase tracking-widest text-ink-soft">The verdict on</p>
        <p className="font-display text-2xl font-black leading-tight">{rec.draft.mascot} {rec.draft.name}</p>
        <p className="text-sm">by {t?.name} · pitched by {rec.pitcherId ? player(rec.pitcherId)?.name : '—'}</p>
      </div>

      {/* Money meter with the Ask line */}
      <div className="relative mt-5 h-16 overflow-visible rounded-2xl border-3 border-ink bg-white shadow-hard">
        <div
          className={cn('h-full rounded-l-xl transition-[width] duration-700 ease-out', running >= rec.draft.ask && running > 0 ? 'bg-lime' : 'bg-sun')}
          style={{ width: `${Math.min(100, (running / scaleMax) * 100)}%` }}
        />
        <div className="absolute inset-y-[-8px] border-l-4 border-dashed border-ink" style={{ left: `${(rec.draft.ask / scaleMax) * 100}%` }}>
          <span className="absolute -top-6 -translate-x-1/2 whitespace-nowrap rounded border-2 border-ink bg-ink px-1 text-[0.65rem] font-black text-sun">ASK {money(rec.draft.ask)}</span>
        </div>
        <span className="absolute inset-0 grid place-items-center">
          <span className="rounded-xl border-2 border-ink bg-paper px-3 py-0.5 font-chunky text-xl tabular-nums" data-testid="pw-total">{money(running)}</span>
        </span>
      </div>

      {/* Cheques */}
      <div className="flex flex-col gap-2">
        {rec.cheques.map((c, i) => {
          const p = player(c.playerId)
          const open = i < shown
          return (
            <div
              key={c.playerId}
              className={cn(
                'flex items-center gap-3 rounded-2xl border-3 border-ink px-3 py-2 transition-all',
                open ? 'animate-pop bg-white shadow-hard-sm' : 'bg-ink/5',
              )}
            >
              <Avatar emoji={p?.avatar ?? '🦈'} size="sm" color={teamColor(team(c.teamId))} />
              <span className="min-w-0 flex-1 truncate font-display font-bold">{p?.name ?? 'A shark'}</span>
              <span className="font-display text-lg font-black tabular-nums">
                {!open ? '🂠' : c.amount === null ? '😴 asleep' : c.amount === 0 ? "🙅 I'm out" : money(c.amount)}
              </span>
            </div>
          )
        })}
        {n === 0 && <p className="text-center text-ink-soft">No sharks left in the tank 🫥</p>}
      </div>

      {done && (
        <div className="flex flex-col items-center gap-2 text-center">
          <div
            data-testid="pw-verdict"
            className={cn(
              'animate-pop whitespace-nowrap rounded-2xl border-4 border-ink px-5 py-2 font-chunky text-4xl shadow-hard-xl',
              rec.deal ? 'rotate-[-6deg] bg-lime' : 'rotate-[5deg] bg-tomato text-white',
            )}
          >
            {rec.deal ? 'DEAL! 🤝' : 'NO DEAL'}
          </div>
          <p className="mt-2 font-display text-lg font-extrabold">
            {rec.deal
              ? `${t?.name} bank ${money(rec.points)} (incl. ${money(rec.points - rec.total)} deal bonus)`
              : rec.total === 0
                ? `${t?.name} get nothing. Not even chai money.`
                : `Missed the Ask — sharks only half-fund it: ${money(rec.points)}`}
          </p>
          {rec.byTeam.length > 1 && (
            <div className="flex flex-wrap justify-center gap-2">
              {rec.byTeam.map((b) => <Badge key={b.teamId} color={teamColor(team(b.teamId))} size="md">{team(b.teamId)?.emoji} avg {money(b.amount)}</Badge>)}
            </div>
          )}
        </div>
      )}

      <Poster draft={rec.draft} product={rec.product} twist={rec.twist} color={teamColor(t)} compact />

      {isHost && done && (
        <Button block variant="dark" size="lg" onClick={() => send('next', { stage: view.stage })} data-testid="pw-next">Next ▶</Button>
      )}
    </div>
  )
}

/** Wall of every pitch so far. */
export function Gallery({ view, team, player }: Props) {
  const list = view.history.filter((h) => !h.skipped)
  if (list.length === 0) return null
  return (
    <section className="flex flex-col gap-3" data-testid="pw-gallery">
      <h3 className="font-display text-xl font-black">🖼️ The pitch wall</h3>
      {list.slice().reverse().map((h) => (
        <Card key={`${h.round}-${h.teamId}`} padding="sm" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-bold">R{h.round + 1} · {team(h.teamId)?.name} · 🎤 {h.pitcherId ? player(h.pitcherId)?.name : '—'}</span>
            <Badge color={h.deal ? 'lime' : 'tomato'}>{h.deal ? 'DEAL' : 'NO DEAL'} {money(h.points)}</Badge>
          </div>
          <Poster draft={h.draft} product={h.product} twist={h.twist} color={teamColor(team(h.teamId))} compact showAsk={false} />
        </Card>
      ))}
    </section>
  )
}
