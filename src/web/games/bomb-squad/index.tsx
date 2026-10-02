import { useEffect, useMemo, useState } from 'react'
import type { GameScreenProps, WebGame } from '../types.ts'
import type { BombSquadView, HeckleKind, ModuleView, Prediction } from '../../../games/bomb-squad/shared.ts'
import { Avatar, Badge, Button, Card, Countdown, Segmented, TeamPill, celebrate, cn, haptic, playSound, toast } from '../../ui/index.ts'
import { AnswerSticker, Casing, ModuleChips, TimerPanel } from './Bomb.tsx'
import { Face, type Act } from './faces.tsx'
import { Manual } from './Manual.tsx'
import { HECKLE, MODULE_EMOJI, timerText } from './util.ts'

type Props = GameScreenProps<BombSquadView>

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

function Screen(props: Props) {
  const { view: v, onEvent, me, player } = props
  const [flash, setFlash] = useState<null | 'boom' | 'defused'>(null)
  const [shake, setShake] = useState(0)
  const [bubbles, setBubbles] = useState<{ id: number; emoji: string; name: string; x: number }[]>([])
  const onMyTeam = v.activeTeamId !== null && me.teamId === v.activeTeamId

  useEffect(() => onEvent((type, data) => {
    switch (type) {
      case 'armed':
        playSound('whoosh'); haptic('heavy'); break
      case 'strike':
        playSound('error'); haptic('error'); setShake((n) => n + 1); break
      case 'solved':
        playSound('success'); haptic('success'); break
      case 'boom':
        setFlash('boom'); playSound('boom'); haptic('buzz')
        setTimeout(() => setFlash(null), 2200); break
      case 'defused':
        setFlash('defused'); playSound('win'); haptic('success')
        void celebrate(onMyTeam ? 'big' : 'small')
        setTimeout(() => setFlash(null), 2000); break
      case 'heckle': {
        const kind = data.kind as HeckleKind
        const who = player(String(data.by))
        const id = Number(data.id)
        setBubbles((b) => [...b.slice(-5), { id, emoji: HECKLE[kind]?.emoji ?? '📣', name: who?.name ?? '', x: 8 + ((id * 37) % 70) }])
        if (onMyTeam) { playSound('pop'); haptic('tap') }
        setTimeout(() => setBubbles((b) => b.filter((x) => x.id !== id)), 2600)
        break
      }
      case 'takeover': {
        const who = player(String(data.by))
        toast(`${who?.name ?? 'Someone'} grabbed the bomb!`, { emoji: '🫳' })
        break
      }
    }
  }), [onEvent, onMyTeam, player])

  return (
    <div className="relative mx-auto flex w-full max-w-[520px] flex-col gap-3 pb-6" data-testid="bomb-squad" data-role={v.role} data-phase={v.phase}>
      <div key={shake} className={cn('flex flex-col gap-3', shake > 0 && 'animate-shake')}>
        <TopLine {...props} />
        <Body {...props} />
      </div>
      {bubbles.map((b) => (
        <div key={b.id} className="pointer-events-none fixed bottom-24 z-40 flex animate-float flex-col items-center" style={{ left: `${b.x}%` }}>
          <span className="animate-pop text-5xl drop-shadow-[2px_2px_0_#16130f]">{b.emoji}</span>
          <span className="rounded-full border-2 border-ink bg-white px-2 font-display text-xs font-bold">{b.name}</span>
        </div>
      ))}
      {flash && <Flash kind={flash} />}
    </div>
  )
}

function Flash({ kind }: { kind: 'boom' | 'defused' }) {
  return (
    <div
      className={cn('fixed inset-0 z-50 grid place-items-center animate-fade-in', kind === 'boom' ? 'bg-tomato' : 'bg-lime')}
      style={kind === 'boom' ? { background: 'radial-gradient(circle at 50% 48%, #fff4e0 0 8%, #ffd23f 16%, #ff5a36 38%, #16130f 100%)' } : undefined}
      data-testid={`flash-${kind}`}
      aria-live="assertive"
    >
      <div className={cn('flex flex-col items-center gap-2', kind === 'boom' ? 'animate-shake' : 'animate-pop')}>
        <span className="animate-pop text-8xl">{kind === 'boom' ? '💥' : '✅'}</span>
        <span className="font-chunky text-6xl text-white text-outline-thick">{kind === 'boom' ? 'BOOM' : 'DEFUSED'}</span>
      </div>
    </div>
  )
}

function TopLine({ view: v, team, scores }: Props) {
  const t = v.activeTeamId ? team(v.activeTeamId) : undefined
  return (
    <div className="flex items-center justify-between gap-2">
      <Badge color="ink" size="md">Round {v.round}/{v.rounds} · Bomb {Math.min(v.turn + 1, v.turnCount)}/{v.turnCount}</Badge>
      {t && v.phase !== 'over' && <TeamPill team={t} score={scores[t.id] ?? 0} size="sm" compact />}
    </div>
  )
}

function Body(props: Props) {
  const { view: v } = props
  if (v.phase === 'over') return <GameOver {...props} />
  if (v.phase === 'aftermath') return <Aftermath {...props} />
  switch (v.role) {
    case 'defuser':
    case 'loneWolf':
      return v.phase === 'briefing' ? <DefuserBriefing {...props} /> : <DefuserLive {...props} />
    case 'expert':
      return <Expert {...props} />
    case 'spectator':
      return <Spectator {...props} />
    case 'benched':
      return (
        <Card color="sky" soft tilt="left">
          <h2 className="text-2xl">🪑 You’re on the bench</h2>
          <p className="mt-1 text-lg">You joined mid-game. Grab some popcorn — you’re in from the next game.</p>
        </Card>
      )
  }
}

function useSend({ send, view }: Props) {
  return (type: string, payload: Record<string, unknown> = {}) => send(type, { turn: view.turn, ...payload })
}

// ---------------------------------------------------------------------------
// Defuser
// ---------------------------------------------------------------------------

function DefuserBriefing(props: Props) {
  const { view: v, deadline } = props
  const send = useSend(props)
  const solo = v.role === 'loneWolf'
  const kinds = v.bomb?.modules ?? []
  return (
    <div className="flex flex-col gap-3">
      <Card color="tomato" tilt="left" padding="lg" className="flex flex-col items-center gap-2 text-center">
        <span className="animate-wiggle-loop text-6xl">💣</span>
        <h2 className="text-3xl leading-tight">{solo ? 'Lone wolf mode' : 'You’re the DEFUSER'}</h2>
        <p className="text-lg leading-snug">
          {solo
            ? 'Nobody to help you: you get the bomb AND the whole manual. Flip between them. Breathe.'
            : 'Only you will see the bomb. Your team holds the manual. Describe EVERYTHING out loud.'}
        </p>
      </Card>
      <Card padding="sm" className="flex flex-col gap-2">
        <div className="font-display text-sm font-bold uppercase text-ink-soft">Inside this bomb</div>
        <div className="flex flex-wrap gap-2">
          {kinds.map((m) => <Badge key={m.id} size="md">{MODULE_EMOJI[m.kind]} {m.name}</Badge>)}
        </div>
        <div className="font-display font-bold">
          ⏱ Fuse {timerText(v.bomb?.fuseMs ?? 0)}
          {v.bomb?.bonuses.length ? <span className="text-ink-soft"> ({v.bomb.bonuses.join(', ')})</span> : null}
        </div>
      </Card>
      <PageHolders {...props} />
      <Button size="xl" variant="danger" block icon="🧨" data-testid="arm" onClick={() => send('arm')}>
        Arm it!
      </Button>
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-display text-sm font-bold">Arms itself in</span>
        <Countdown deadline={deadline} variant="badge" />
      </div>
    </div>
  )
}

function DefuserLive(props: Props) {
  const { view: v } = props
  const send = useSend(props)
  const bomb = v.bomb!
  const solo = v.role === 'loneWolf'
  const [mode, setMode] = useState<'bomb' | 'manual'>('bomb')
  const [cur, setCur] = useState(() => Math.max(0, bomb.modules.findIndex((m) => !m.solved)))
  const solvedKey = bomb.modules.map((m) => (m.solved ? 1 : 0)).join('')
  // Hop to the next unsolved module once this one is done.
  useEffect(() => {
    if (!bomb.modules[cur]?.solved) return
    const next = bomb.modules.findIndex((m) => !m.solved)
    if (next < 0) return
    const id = setTimeout(() => setCur(next), 650)
    return () => clearTimeout(id)
  }, [solvedKey])
  const m = bomb.modules[cur]
  const act: Act = (type, payload = {}) => send(type, { module: cur, ...payload })

  return (
    <div className="flex flex-col gap-3">
      <TimerPanel bomb={bomb} ticking />
      {solo && (
        <Segmented
          value={mode}
          onChange={setMode}
          label="Bomb or manual"
          options={[{ value: 'bomb', label: '💣 Bomb' }, { value: 'manual', label: `📖 Manual (${v.manual.length})` }]}
        />
      )}
      {mode === 'manual' && solo ? (
        <Manual sections={v.manual} compact />
      ) : (
        <>
          {bomb.edgework && <Casing e={bomb.edgework} />}
          <ModuleChips modules={bomb.modules} current={cur} onPick={(i) => { haptic('tap'); setCur(i) }} />
          {m && <ModuleCard key={m.id} m={m} act={m.solved ? null : act} />}
        </>
      )}
    </div>
  )
}

function ModuleCard({ m, act, answer }: { m: ModuleView; act: Act | null; answer?: boolean }) {
  return (
    <Card padding="sm" className={cn('flex flex-col gap-3', m.solved && '!bg-lime-soft')} data-testid={`module-${m.id}`} data-kind={m.kind} data-solved={m.solved}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xl leading-tight">{MODULE_EMOJI[m.kind]} {m.name}</h3>
        {m.solved && <Badge color="lime" size="md">✓ Disarmed</Badge>}
      </div>
      {m.face && <Face face={m.face} act={act} solved={m.solved} />}
      {answer && m.solution && !m.solved && <AnswerSticker s={m.solution} />}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Experts
// ---------------------------------------------------------------------------

function PageHolders({ view: v, player }: Props) {
  if (!v.pageHolders.length) return null
  return (
    <details className="group rounded-2xl border-3 border-ink bg-white shadow-hard-sm" open={v.phase === 'briefing'}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 font-display font-extrabold">
        🗂️ Who has which page
        <span className="transition-transform group-open:rotate-180" aria-hidden>▾</span>
      </summary>
      <ul className="flex flex-col gap-2 px-3 pb-3">
        {v.pageHolders.map((h) => {
          const p = player(h.playerId)
          return (
            <li key={h.playerId} className="flex items-start gap-2">
              <Avatar emoji={p?.avatar ?? '🙂'} size="xs" connected={p?.connected ?? false} />
              <div className="min-w-0">
                <div className="font-display font-bold leading-tight">{p?.name ?? 'Someone'}</div>
                <div className="text-sm leading-snug text-ink-soft">{h.titles.join(' · ')}</div>
              </div>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function Expert(props: Props) {
  const { view: v, player, deadline } = props
  const send = useSend(props)
  const bomb = v.bomb!
  const d = v.defuserId ? player(v.defuserId) : undefined
  return (
    <div className="flex flex-col gap-3">
      {v.phase === 'briefing' ? (
        <Card color="sky" tilt="right" className="flex flex-col gap-2">
          <h2 className="text-2xl leading-tight">📖 You’re an EXPERT</h2>
          <p className="text-[17px] leading-snug">
            <b>{d?.name ?? 'Your defuser'}</b> has the bomb. You can’t see it — they’ll describe it. Skim your pages now!
          </p>
          <div className="flex items-center gap-2">
            <span className="shrink-0 font-display text-sm font-bold">Clock starts in</span>
            <Countdown deadline={deadline} variant="badge" />
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          <TimerPanel bomb={bomb} size="sm" />
          <div className="flex flex-wrap gap-1.5" aria-label="Module status" data-testid="module-status">
            {bomb.modules.map((m) => (
              <Badge key={m.id} color={m.solved ? 'lime' : 'white'}>
                {m.solved ? '✅' : MODULE_EMOJI[m.kind]} {m.name}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {v.defuserOffline && (
        <Card color="sun" className="flex animate-pop flex-col gap-2">
          <p className="font-display text-lg font-extrabold">📵 {d?.name ?? 'The defuser'} dropped off!</p>
          <p className="leading-snug">The clock is still ticking. Someone grab the bomb — it moves to your phone.</p>
          {v.canTakeOver && <Button variant="danger" block icon="🫳" data-testid="take-over" onClick={() => send('takeOver')}>I’ll take the bomb</Button>}
        </Card>
      )}
      <Manual sections={v.manual} />
      <PageHolders {...props} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The other team
// ---------------------------------------------------------------------------

function Spectator(props: Props) {
  const { view: v, player, team, deadline } = props
  const send = useSend(props)
  const bomb = v.bomb!
  const t = v.activeTeamId ? team(v.activeTeamId) : undefined
  const d = v.defuserId ? player(v.defuserId) : undefined
  return (
    <div className="flex flex-col gap-3">
      <Card color={t?.color ?? 'sun'} soft tilt="left" padding="sm" className="flex items-center gap-3">
        <Avatar emoji={d?.avatar ?? '🙂'} size="md" />
        <div className="min-w-0">
          <div className="font-display text-xs font-bold uppercase text-ink-soft">🍿 You’re watching</div>
          <div className="font-display text-lg font-extrabold leading-tight">{d?.name ?? 'Someone'} defuses for {t?.name ?? 'them'}</div>
          <div className="text-sm leading-snug">You can see the answers. Stay quiet… or don’t.</div>
        </div>
      </Card>
      {v.phase === 'briefing' && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-display text-sm font-bold">Clock starts in</span>
          <Countdown deadline={deadline} variant="badge" />
        </div>
      )}
      {v.phase === 'live' && <TimerPanel bomb={bomb} />}
      {v.prediction && <PredictCard p={v.prediction} onPick={(g) => send('predict', { guess: g })} />}
      {bomb.edgework && <Casing e={bomb.edgework} />}
      {bomb.modules.map((m) => <ModuleCard key={m.id} m={m} act={null} answer />)}
      {v.heckleEnabled && v.phase === 'live' && <HeckleBar onHeckle={(k) => send('heckle', { kind: k })} />}
    </div>
  )
}

function PredictCard({ p, onPick }: { p: NonNullable<BombSquadView['prediction']>; onPick: (g: Prediction) => void }) {
  if (!p.open && !p.mine) return null
  return (
    <Card padding="sm" className="flex flex-col gap-2" data-testid="predict">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-lg font-extrabold leading-tight">🎲 Team bet · +2 if right</span>
        {!p.open && <Badge color="ink">locked</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button color="lime" disabled={!p.open} className={cn(p.mine === 'defuse' && 'ring-4 ring-ink ring-offset-2')} data-testid="predict-defuse" onClick={() => onPick('defuse')}>✅ Defused</Button>
        <Button color="tomato" disabled={!p.open} className={cn(p.mine === 'boom' && 'ring-4 ring-ink ring-offset-2')} data-testid="predict-boom" onClick={() => onPick('boom')}>💥 Boom</Button>
      </div>
    </Card>
  )
}

function HeckleBar({ onHeckle }: { onHeckle: (k: HeckleKind) => void }) {
  const [cool, setCool] = useState(false)
  return (
    <div className="sticky bottom-2 z-30 rounded-2xl border-3 border-ink bg-white p-2 shadow-hard" data-testid="heckles">
      <div className="mb-1 px-1 font-display text-xs font-bold uppercase text-ink-soft">Heckle their defuser</div>
      <div className="grid grid-cols-6 gap-1.5">
        {(Object.keys(HECKLE) as HeckleKind[]).map((k) => (
          <button
            key={k}
            type="button"
            aria-label={HECKLE[k].label}
            data-testid={`heckle-${k}`}
            disabled={cool}
            onClick={() => {
              haptic('tap'); onHeckle(k); setCool(true); setTimeout(() => setCool(false), 2500)
            }}
            className="grid h-12 place-items-center rounded-xl border-2 border-ink bg-paper text-2xl active:scale-90 disabled:opacity-40"
          >
            {HECKLE[k].emoji}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// After a bomb / after the game
// ---------------------------------------------------------------------------

function Aftermath(props: Props) {
  const { view: v, player, team, me, deadline } = props
  const send = useSend(props)
  const a = v.aftermath!
  const bomb = v.bomb!
  const t = v.activeTeamId ? team(v.activeTeamId) : undefined
  const d = v.defuserId ? player(v.defuserId) : undefined
  const good = a.result === 'defused'
  const next = v.nextUp
  const nextTeam = next ? team(next.teamId) : undefined
  const nextD = next?.defuserId ? player(next.defuserId) : undefined
  const preds = Object.entries(v.predictions)
  return (
    <div className="flex flex-col gap-3">
      <Card color={good ? 'lime' : 'tomato'} tilt="left" padding="lg" className="flex animate-pop flex-col items-center gap-1 text-center" data-testid="aftermath" data-result={a.result}>
        <span className="text-7xl">{good ? '😮‍💨' : a.result === 'boom' ? '💥' : '👻'}</span>
        <h2 className="font-chunky text-4xl leading-none">{good ? 'DEFUSED' : a.result === 'boom' ? 'BOOM' : 'ABANDONED'}</h2>
        <p className="text-lg font-bold leading-snug">{a.reason}</p>
        <p className="text-[15px] leading-snug">
          {d?.name ?? 'Someone'} for {t?.name ?? 'the team'} · {bomb.modules.filter((m) => m.solved).length}/{bomb.modules.length} modules · {bomb.strikes} strike{bomb.strikes === 1 ? '' : 's'}
          {good && bomb.timeLeftMs !== null ? ` · ${timerText(bomb.timeLeftMs)} left` : ''}
        </p>
        <div className="mt-2 rounded-2xl border-3 border-ink bg-white px-4 py-1 font-chunky text-3xl shadow-hard-sm">+{a.points}</div>
        {a.breakdown.length > 0 && <ul className="mt-1 text-sm font-bold">{a.breakdown.map((x) => <li key={x}>{x}</li>)}</ul>}
      </Card>
      {preds.length > 0 && (
        <Card padding="sm" className="flex flex-col gap-1">
          <div className="font-display font-extrabold">🎲 Bets</div>
          {preds.map(([tid, g]) => {
            const right = (g === 'defuse') === good
            return <div key={tid} className="text-[15px]"><b>{team(tid)?.name}</b> bet {g === 'boom' ? 'BOOM' : 'defused'} — {right ? 'right! +2' : 'wrong'}</div>
          })}
        </Card>
      )}
      <details className="rounded-2xl border-3 border-ink bg-white shadow-hard-sm">
        <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 font-display font-extrabold">🔍 How it should have gone</summary>
        <div className="flex flex-col gap-2 px-3 pb-3">
          {bomb.edgework && <Casing e={bomb.edgework} />}
          {bomb.modules.map((m) => (
            <div key={m.id} className="flex flex-col gap-1">
              <div className="font-display font-bold">{m.solved ? '✅' : '❌'} {m.name}</div>
              {m.solution && <AnswerSticker s={m.solution} />}
            </div>
          ))}
        </div>
      </details>
      {next && (
        <Card color={nextTeam?.color ?? 'sun'} soft padding="sm" className="flex items-center gap-3">
          <Avatar emoji={nextD?.avatar ?? '🙂'} size="md" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-xs font-bold uppercase text-ink-soft">Next bomb</div>
            <div className="font-display text-lg font-extrabold leading-tight">
              {nextD?.id === me.id ? 'YOU are defusing next 😬' : `${nextD?.name ?? 'Someone'} defuses for ${nextTeam?.name ?? 'them'}`}
            </div>
          </div>
        </Card>
      )}
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-display text-sm font-bold">{next ? 'Next bomb in' : 'Results in'}</span>
        <Countdown deadline={deadline} variant="badge" />
      </div>
      {me.isHost && <Button variant="secondary" block data-testid="next" onClick={() => send('next')}>{next ? 'Skip to the next bomb ⏭' : 'Show results ⏭'}</Button>}
    </div>
  )
}

function GameOver({ view: v, team, player }: Props) {
  const rows = useMemo(() => v.history.filter((h) => h.result !== 'skipped'), [v.history])
  return (
    <Card padding="md" className="flex flex-col gap-2">
      <h2 className="text-3xl">🏁 That’s all the bombs</h2>
      <ul className="flex flex-col gap-1.5">
        {rows.map((h) => (
          <li key={h.turn} className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink bg-paper px-2.5 py-1.5">
            <span className="min-w-0 truncate font-display font-bold">{h.result === 'defused' ? '✅' : '💥'} {player(h.defuserId ?? '')?.name ?? '—'} · {team(h.teamId)?.name}</span>
            <span className="font-chunky">+{h.points}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export const bombSquadWeb: WebGame = {
  id: 'bomb-squad',
  Screen,
}
