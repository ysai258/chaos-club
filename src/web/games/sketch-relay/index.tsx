import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { WebGame, GameScreenProps } from '../types.ts'
import type { BrushSize, GuessView, OptionView, SketchView } from '../../../games/sketch-relay/shared.ts'
import type { TeamInfo } from '../../../shared/protocol.ts'
import {
  Avatar, Badge, BigText, Button, Card, Countdown, Segmented, TeamPill,
  celebrate, cn, haptic, playSound, toast,
} from '../../ui/index.ts'
import { SketchCanvas, type DrawInput } from './SketchCanvas.tsx'
import { BRUSH } from './draw.ts'
import { Gallery } from './Gallery.tsx'

type Props = GameScreenProps<SketchView>

export const DIFF = {
  easy: { label: 'Easy', color: 'lime' as const, stars: '★' },
  medium: { label: 'Medium', color: 'sun' as const, stars: '★★' },
  hard: { label: 'Hard', color: 'tomato' as const, stars: '★★★' },
}

function Screen(props: Props) {
  const { view: v, onEvent, player } = props
  const team = props.team(v.drawingTeamId)

  useEffect(
    () =>
      onEvent((type, data) => {
        if (type === 'yourTurn') {
          haptic('buzz')
          playSound('ding')
        } else if (type === 'correct') {
          const mine = data.teamId === props.me.teamId
          const lostIt = data.steal && v.drawingTeamId === props.me.teamId
          if (mine) {
            void celebrate(data.steal ? 'big' : 'small')
            playSound('win')
          } else {
            playSound(lostIt ? 'error' : 'pop')
            if (lostIt) haptic('error')
          }
        } else if (type === 'close') {
          toast(`“${String(data.text)}” is so close!`, { emoji: '🔥' })
          haptic('success')
        } else if (type === 'frozen') {
          const p = player(String(data.playerId))
          if (p) toast(`${p.name} froze. Stroke wasted!`, { emoji: '🗿', durationMs: 1800 })
        } else if (type === 'stumped') {
          playSound('buzz')
        } else if (type === 'roundStart') {
          playSound('whoosh')
        }
      }),
    [onEvent, player, props.me.teamId, v.drawingTeamId],
  )

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-3 pb-4" data-testid="sketch-relay" data-phase={v.phase} data-role={v.role}>
      <RoundHeader {...props} dteam={team} />
      {v.phase === 'pick' && <PickPhase {...props} dteam={team} />}
      {(v.phase === 'draw' || v.phase === 'lastCall') && <DrawPhase {...props} dteam={team} />}
      {v.phase === 'reveal' && <RevealPhase {...props} dteam={team} />}
      {(v.phase === 'gallery' || v.phase === 'over') && <Gallery {...props} />}
    </div>
  )
}

// ------------------------------------------------------------------ header

function RoundHeader({ view: v, dteam: team }: Props & { dteam: TeamInfo | undefined }) {
  if (v.phase !== 'pick' && v.phase !== 'reveal') return null
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Badge color="ink" size="md">R{v.round + 1}/{v.totalRounds}</Badge>
      {team && (
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-bold">
          <TeamPill team={team} size="sm" className="min-w-0" />
          <span className="shrink-0">draws</span>
        </span>
      )}
      {v.modifier && <ModifierChip m={v.modifier} />}
    </div>
  )
}

function ModifierChip({ m }: { m: NonNullable<SketchView['modifier']> }) {
  return (
    <button
      type="button"
      onClick={() => toast(m.blurb, { emoji: m.emoji, durationMs: 3500 })}
      className="ml-auto min-h-11 shrink-0 animate-wiggle rounded-full border-2 border-ink bg-grape px-3 font-display text-sm font-extrabold shadow-hard-sm"
    >
      {m.emoji} {m.name}
    </button>
  )
}

// ------------------------------------------------------------------ pick

function PickPhase(props: Props & { dteam: TeamInfo | undefined }) {
  const { view: v, send, dteam: team, deadline } = props
  const [picked, setPicked] = useState<number | null>(null)
  if (v.role === 'drawer' && v.options) {
    return (
      <div className="flex flex-col gap-3">
        <ShhBanner />
        <div className="flex items-end justify-between gap-2">
          <h2 className="text-2xl leading-tight">Pick what your team draws</h2>
          <Countdown deadline={deadline} variant="badge" />
        </div>
        <p className="-mt-1 text-sm text-ink-soft">Any drawer can tap. First tap wins. Point at it, don’t say it.</p>
        <div className="flex flex-col gap-3">
          {v.options.map((o, i) => (
            <OptionCard key={o.index} o={o} tilt={i === 1 ? 'right' : i === 2 ? 'left' : 'none'} busy={picked === o.index}
              onPick={() => { setPicked(o.index); send('pick', { round: v.round, index: o.index }) }} />
          ))}
        </div>
        <ModifierCard {...props} />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {v.role === 'seer' ? (
        <Card color="grape" tilt="left" padding="lg" className="text-center">
          <div className="text-6xl" aria-hidden>🙈</div>
          <BigText color="white" size="md">You’re the Seer!</BigText>
          <p className="mt-2 font-semibold">Your team is about to draw something. You don’t know what. Type it before the rivals steal it.</p>
          <p className="mt-2 text-sm font-bold">No peeking at their phones 👀</p>
        </Card>
      ) : (
        <Card color={team?.color ?? 'sun'} soft tilt="right" padding="lg" className="text-center">
          <div className="text-6xl" aria-hidden>{v.role === 'rival' ? '🦝' : '👀'}</div>
          <BigText color="white" size="md">{v.role === 'rival' ? 'Get ready to steal' : 'Sit tight'}</BigText>
          <p className="mt-2 font-semibold">
            {team ? `${team.emoji} ${team.name}` : 'The other team'} is secretly picking a prompt. Watch their canvas and type the answer first.
          </p>
        </Card>
      )}
      <div className="flex justify-center"><Countdown deadline={deadline} variant="badge" /></div>
      <ModifierCard {...props} />
      <Card color="white" padding="sm" tilt="none" className="flex flex-col gap-1.5 text-sm font-semibold">
        <span className="font-display text-xs font-extrabold uppercase tracking-wide text-ink-soft">How this round scores</span>
        <span>🙈 The drawing team’s Seer guesses it → <b>they</b> score.</span>
        <span>🦝 A rival types it first → <b>stolen</b>, rivals score.</span>
        <span>✏️ Every stroke used shrinks the prize. Hard prompts pay most.</span>
      </Card>
    </div>
  )
}

function OptionCard({ o, onPick, tilt, busy }: { o: OptionView; onPick: () => void; tilt: 'left' | 'right' | 'none'; busy: boolean }) {
  const d = DIFF[o.difficulty]
  return (
    <button
      type="button"
      data-testid={`sr-option-${o.index}`}
      disabled={busy}
      onClick={() => { haptic('tap'); onPick() }}
      className={cn(
        'flex min-h-20 w-full items-center gap-3 rounded-3xl border-3 border-ink bg-white p-4 text-left shadow-hard transition-transform active:translate-x-1 active:translate-y-1 active:shadow-none',
        tilt === 'left' && '-rotate-1', tilt === 'right' && 'rotate-1',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-display text-xl font-extrabold leading-tight">{o.text}</span>
        <span className="mt-1 flex items-center gap-2"><Badge color={d.color}>{d.stars} {d.label}</Badge></span>
      </span>
      <span className="shrink-0 text-right font-display font-extrabold leading-none">
        <span className="block text-3xl">{o.points}</span>
        <span className="text-xs uppercase">pts max</span>
      </span>
    </button>
  )
}

function ModifierCard({ view: v }: Props) {
  if (!v.modifier) return null
  return (
    <Card color="grape" soft padding="sm" className="flex items-center gap-3">
      <span className="text-4xl" aria-hidden>{v.modifier.emoji}</span>
      <span className="min-w-0">
        <span className="block font-display text-lg font-extrabold">Chaos card: {v.modifier.name}</span>
        <span className="text-sm">{v.modifier.blurb}</span>
      </span>
    </Card>
  )
}

function ShhBanner() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-2xl border-3 border-ink bg-ink py-2 font-chunky text-lg text-sun">
      <span aria-hidden className="animate-wiggle-loop">🤫</span> SHH! NO TALKING <span aria-hidden className="animate-wiggle-loop">🤫</span>
    </div>
  )
}

// ------------------------------------------------------------------ draw

function DrawPhase(props: Props & { dteam: TeamInfo | undefined }) {
  const { view: v, me, send, player } = props
  const turn = v.turn
  const myTurn = !!turn && turn.drawerId === me.id && v.role === 'drawer'
  const [size, setSize] = useState<BrushSize>('m')
  const [ink, setInk] = useState(0)
  const [done, setDone] = useState(false)
  useEffect(() => { setInk(0); setDone(false) }, [turn?.id])

  const fat = v.modifier?.id === 'fat'
  const input: DrawInput | null = useMemo(() => {
    if (!myTurn || !turn) return null
    return {
      turn: turn.id,
      inkMax: turn.inkMax,
      color: v.myColor ?? '#16130f',
      width: fat ? BRUSH.xl : BRUSH[size],
      flipped: turn.flipped,
      send: (c) => send('ink', { round: v.round, turn: turn.id, seq: c.seq, pts: c.pts, end: c.end, size }),
      onInk: setInk,
      onDone: () => setDone(true),
    }
  }, [myTurn, turn, v.myColor, v.round, fat, size, send])

  const drawer = turn ? player(turn.drawerId) : undefined
  const queuePos = turn && v.role === 'drawer' && !myTurn ? turnsUntil(v, me.id) : null

  return (
    <div className="flex flex-col gap-3">
      <RoleBanner {...props} />
      {v.modifier && (
        <div className="-mb-1 flex items-center gap-2 text-sm font-semibold">
          <span className="min-w-0 flex-1 truncate">{v.modifier.blurb}</span>
          <ModifierChip m={v.modifier} />
        </div>
      )}
      <TurnStrip {...props} />
      <SketchCanvas strokes={v.strokes} live={v.live} input={input}>
        {myTurn && !done && ink === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span className="animate-pop rounded-2xl border-3 border-ink bg-sun px-4 py-1 font-chunky text-lg shadow-hard">YOUR STROKE!</span>
          </div>
        )}
        {myTurn && turn?.flipped && (
          <div className="pointer-events-none absolute bottom-3 left-3"><Badge color="grape" size="md">🙃 You’re upside down</Badge></div>
        )}
        {v.fogHidden > 0 && (
          <div className="pointer-events-none absolute top-3 right-3"><Badge color="white" size="md">🌫️ {v.fogHidden} hidden in fog</Badge></div>
        )}
        {v.phase === 'lastCall' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <span className="animate-pulse-soft rounded-2xl border-3 border-ink bg-tomato px-4 py-1 font-chunky text-base shadow-hard">⏰ LAST CALL</span>
          </div>
        )}
        {v.strokes.length === 0 && !v.live && !myTurn && v.fogHidden === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center font-display text-lg font-bold text-ink/30">
            {drawer ? `${drawer.name} is about to draw…` : 'Waiting for ink…'}
          </div>
        )}
      </SketchCanvas>


      {myTurn && turn && !done && (
        <div className="flex flex-col gap-2">
          <InkMeter used={ink} max={turn.inkMax} color={v.myColor ?? '#16130f'} />
          <div className="flex items-center gap-2">
            {fat ? (
              <Badge color="grape" size="md">🖍️ Fat marker forced</Badge>
            ) : (
              <Segmented<BrushSize>
                label="Brush size"
                value={size}
                onChange={setSize}
                options={[
                  { value: 's', label: <BrushDot w={6} c={v.myColor} /> },
                  { value: 'm', label: <BrushDot w={11} c={v.myColor} /> },
                  { value: 'l', label: <BrushDot w={18} c={v.myColor} /> },
                ]}
              />
            )}
            <Button variant="secondary" size="sm" className="ml-auto" data-testid="sr-pass"
              onClick={() => send('pass', { round: v.round, turn: turn.id })}>✋ Pass</Button>
          </div>
          <p className="text-center text-sm font-semibold text-ink-soft">One stroke: put your finger down, draw, lift. That’s it.</p>
        </div>
      )}
      {v.role === 'drawer' && (!myTurn || done) && (
        <Card color="paper" padding="sm" className="text-center text-sm font-semibold">
          {v.phase === 'lastCall'
            ? 'Pens down. Stare at your Seer. Intensely. Silently.'
            : queuePos === 0 || queuePos === null
              ? 'Stroke sent! Now watch in silence. 🤐'
              : `You’re up in ${queuePos} turn${queuePos === 1 ? '' : 's'}. Plan your stroke. Say nothing.`}
        </Card>
      )}
      {v.canGuess && <GuessBox {...props} />}
      <GuessFeed {...props} />
    </div>
  )
}

function turnsUntil(v: SketchView, me: string): number | null {
  const order = v.drawerOrder
  const cur = v.turn ? order.indexOf(v.turn.drawerId) : -1
  const mine = order.indexOf(me)
  if (cur < 0 || mine < 0) return null
  return (mine - cur + order.length) % order.length
}

function BrushDot({ w, c }: { w: number; c: string | null }) {
  return (
    <span className="grid size-6 place-items-center" aria-label={`${w}px brush`}>
      <span className="block rounded-full border border-ink" style={{ width: w, height: w, background: c ?? '#16130f' }} />
    </span>
  )
}

function InkMeter({ used, max, color }: { used: number; max: number; color: string }) {
  const left = Math.max(0, 1 - used / max)
  return (
    <div className="flex items-center gap-2" aria-label="Ink left">
      <span className="font-display text-xs font-extrabold uppercase">Ink</span>
      <div className="relative h-4 flex-1 overflow-hidden rounded-full border-3 border-ink bg-white">
        <div className="h-full transition-[width] duration-100" style={{ width: `${left * 100}%`, background: color }} />
      </div>
    </div>
  )
}

function RoleBanner({ view: v, dteam: team }: Props & { dteam: TeamInfo | undefined }) {
  if (v.role === 'drawer') {
    return (
      <Card color="ink" padding="sm" className="flex items-center gap-3">
        <span className="shrink-0 rounded-xl bg-sun px-2 py-1 font-chunky text-xs text-ink">DRAW</span>
        <span className="min-w-0 flex-1 font-display text-xl font-extrabold leading-tight text-sun" data-testid="sr-prompt">{v.prompt}</span>
        <span className="shrink-0 rounded-xl border-2 border-sun px-1.5 py-0.5 font-chunky text-[10px] text-sun" title="No talking">🤫 SHH</span>
      </Card>
    )
  }
  const seer = v.role === 'seer'
  return (
    <Card color={seer ? 'grape' : 'sky'} soft padding="sm" className="flex items-center gap-3">
      <span className="text-3xl leading-none" aria-hidden>{seer ? '🙈' : v.role === 'rival' ? '🦝' : '👀'}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-lg font-extrabold leading-tight">
          {seer ? 'You’re the Seer. What is it?' : v.role === 'rival' ? 'Steal it!' : 'Watching'}
        </span>
        <span className="block text-sm leading-snug">
          {seer ? 'Beat the rivals to it. Type fast.' : 'Type it — don’t shout, they can hear you 👂'}
        </span>
      </span>
      {v.difficulty && <Badge color={DIFF[v.difficulty].color}>{DIFF[v.difficulty].stars}</Badge>}
    </Card>
  )
}

function TurnStrip({ view: v, player, me }: Props) {
  return (
    <div className="flex items-center gap-2">
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1.5 pl-1">
        {v.drawerOrder.map((id) => {
          const p = player(id)
          const active = v.turn?.drawerId === id
          return (
            <span key={id} className={cn('relative shrink-0 transition-transform', active && '-translate-y-0.5')}>
              <Avatar emoji={p?.avatar ?? '🙂'} size={active ? 'md' : 'sm'} active={active} connected={p?.connected ?? false} />
              <span className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-ink" style={{ background: v.colors[id] }} aria-hidden />
            </span>
          )
        })}
        {v.turn && (
          <span className="ml-1 min-w-0 truncate text-sm font-bold">{v.turn.drawerId === me.id ? 'Your stroke!' : `${player(v.turn.drawerId)?.name ?? '…'} is drawing`}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Badge color="white" size="md" data-testid="sr-strokes" title="Strokes used">✏️ {Math.min(v.strokesUsed + (v.turn ? 1 : 0), v.strokesMax)}/{v.strokesMax}</Badge>
        <Badge color="sun" size="md" title="Points if guessed now">🏆 {v.pointsNow}</Badge>
      </div>
    </div>
  )
}

function GuessBox({ view: v, send }: Props) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    send('guess', { round: v.round, text: t })
    setText('')
    ref.current?.focus()
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        ref={ref}
        data-testid="sr-guess"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={60}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        enterKeyHint="send"
        aria-label="Your guess"
        placeholder={v.role === 'seer' ? 'Your guess, Seer…' : 'Steal it… type a guess'}
        className="min-h-13 min-w-0 flex-1 rounded-2xl border-3 border-ink bg-white px-4 text-lg font-semibold shadow-hard-sm placeholder:font-normal placeholder:text-ink/40 focus:shadow-hard focus:outline-none"
      />
      <Button type="submit" size="md" variant={v.role === 'seer' ? 'primary' : 'danger'} data-testid="sr-guess-send" disabled={!text.trim()}>
        Guess
      </Button>
    </form>
  )
}

function GuessFeed({ view: v, player, team, me }: Props) {
  const recent = [...v.guesses].reverse().slice(0, 10)
  if (recent.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <span className="font-display text-xs font-extrabold uppercase tracking-wide text-ink-soft">Wrong guesses</span>
      <div className="flex flex-wrap gap-1.5">
        {recent.map((g: GuessView, i) => {
          const p = player(g.playerId)
          const t = team(g.teamId)
          return (
            <span
              key={g.id}
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-full border-2 border-ink px-2.5 py-1 text-sm font-semibold',
                i === 0 && 'animate-pop',
                g.playerId === me.id ? 'bg-sun-soft' : 'bg-white',
              )}
              style={{ boxShadow: `2px 2px 0 0 ${t ? `var(--color-${t.color})` : 'var(--color-ink)'}` }}
            >
              <span aria-hidden>{p?.avatar ?? '🙂'}</span>
              <span className="truncate line-through decoration-tomato/70 decoration-2">{g.text}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ reveal

function RevealPhase(props: Props & { dteam: TeamInfo | undefined }) {
  const { view: v, player, dteam: team, me } = props
  const r = v.result
  if (!r) return null
  const winTeam = r.winnerTeamId ? props.team(r.winnerTeamId) : undefined
  const winner = r.winnerPlayerId ? player(r.winnerPlayerId) : undefined
  const mineWon = r.winnerTeamId === me.teamId
  return (
    <div className="flex flex-col gap-3" data-testid="sr-result">
      <Card color={r.steal ? 'tomato' : r.winnerTeamId ? 'lime' : 'paper'} tilt="left" padding="md" className="text-center">
        <p className="font-display text-sm font-extrabold uppercase tracking-widest">It was…</p>
        <BigText color="white" size="md" className="break-words">{r.prompt}</BigText>
        <div className="mt-3 flex flex-col items-center gap-1 font-semibold">
          {r.winnerTeamId && winTeam ? (
            <>
              <span className="text-lg font-bold">
                {r.steal ? '🦝 STOLEN by ' : '🎉 Cracked by '}
                {winner?.name ?? 'someone'}
                {r.steal ? '' : ' the Seer'}!
              </span>
              <span className="flex items-center gap-2">
                <TeamPill team={winTeam} size="sm" /> <span className="font-display text-xl font-extrabold">+{r.points}</span>
              </span>
              {r.winningGuess && <span className="text-sm">with “{r.winningGuess}” after {r.strokesUsed} stroke{r.strokesUsed === 1 ? '' : 's'}</span>}
              {mineWon && <span className="text-sm font-bold">That’s your team! 🙌</span>}
            </>
          ) : (
            <span className="text-lg font-bold">🤷 Nobody got it. Art is subjective.</span>
          )}
        </div>
      </Card>
      <SketchCanvas strokes={v.strokes} live={null} input={null} label={`Drawing of ${r.prompt}`} />
      <p className="text-center text-sm font-semibold text-ink-soft">
        {team ? `${team.emoji} ${team.name}` : 'The team'} can talk again. Explain yourselves.
      </p>
    </div>
  )
}

export const sketchRelayWeb: WebGame = {
  id: 'sketch-relay',
  Screen,
}
