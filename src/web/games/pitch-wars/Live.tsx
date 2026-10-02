import { useState } from 'react'
import { Avatar, BigText, Button, Card, cn, Countdown } from '../../ui/index.ts'
import { Poster } from './Poster.tsx'
import { RoundHeader } from './Prep.tsx'
import { money, teamColor, type Props } from './util.tsx'

/** "Next up" — 7 seconds to unmute on Meet. */
export function Stage(props: Props) {
  const { view, team, player, me, send, deadline } = props
  const os = view.onStage
  if (!os) return null
  const t = team(os.teamId)
  const pitcher = os.pitcherId ? player(os.pitcherId) : undefined
  const iPitch = os.pitcherId === me.id
  const myTeamPitching = me.teamId === os.teamId
  const pitcherAway = pitcher && !pitcher.connected
  return (
    <div className="flex flex-col items-center gap-5 text-center" data-testid="pw-stage">
      <div className="w-full"><RoundHeader {...props} /></div>
      <p className="font-display text-sm font-black uppercase tracking-[0.3em] text-ink-soft">Lights · Camera · Pitch</p>
      <BigText color={teamColor(t)} size="lg">{t?.emoji} {t?.name}</BigText>
      <div className="flex flex-col items-center gap-1">
        <Avatar emoji={pitcher?.avatar ?? '🎤'} color={teamColor(t)} size="xl" active connected={pitcher?.connected ?? true} />
        <p className="font-display text-2xl font-black">🎤 {iPitch ? 'YOU' : pitcher?.name ?? '???'}</p>
      </div>
      <Card color={iPitch ? 'tomato' : 'white'} className="w-full">
        <p className="font-display text-lg font-extrabold">
          {iPitch ? 'Unmute on Meet. Deep breath. Sell it.' : myTeamPitching ? 'Your pitcher is up — cheer (quietly).' : '🦈 You are the Sharks. Get your questions ready.'}
        </p>
      </Card>
      <Countdown deadline={deadline} variant="big" />
      {(iPitch || (myTeamPitching && pitcherAway)) && (
        <Button size="xl" block color="lime" onClick={() => send(iPitch ? 'start' : 'takeMic', { stage: view.stage })} data-testid="pw-start">
          {iPitch ? "🎬 I'm ready — start the clock" : '🎤 Pitcher vanished — take the mic'}
        </Button>
      )}
    </div>
  )
}

/** The live pitch. Pitching team gets a teleprompter, sharks get weapons. */
export function Pitch(props: Props) {
  const { view, team, player, me, send, deadline } = props
  const os = view.onStage
  if (!os) return null
  const t = team(os.teamId)
  const pitcher = os.pitcherId ? player(os.pitcherId) : undefined
  const iPitch = os.pitcherId === me.id
  const pitching = me.teamId === os.teamId
  const canDrive = iPitch || (pitching && !!pitcher && !pitcher.connected)
  const feed = [...os.questions].reverse()

  return (
    <div className={cn('flex flex-col gap-4', canDrive && 'pb-28')} data-testid="pw-pitch">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-display text-lg font-black">
          🎤 {iPitch ? 'You’re live!' : `${pitcher?.name ?? '???'} is pitching`}
        </p>
        <Countdown deadline={deadline} variant="badge" warnAt={10} tickSound={iPitch} />
      </div>

      {os.curveball && (
        <div key={os.curveball.id} className="animate-shake rounded-3xl border-3 border-ink bg-ink p-4 shadow-hard-lg" data-testid="pw-curveball-banner">
          <p className="font-display text-xs font-black uppercase tracking-widest text-sun">⚾ Curveball from {team(os.curveball.byTeamId)?.name}! (+15s)</p>
          <p className="mt-1 font-display text-2xl font-black leading-tight text-paper">{os.curveball.text}</p>
        </div>
      )}

      <Poster draft={os.draft} product={os.product} twist={os.twist} color={teamColor(t)} compact={!pitching && feed.length > 0} />

      {feed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-display text-sm font-black uppercase tracking-wide text-ink-soft">🔥 Shark questions — answer out loud!</h3>
          {feed.map((q, i) => (
            <div
              key={q.id}
              className={cn('rounded-2xl border-3 border-ink bg-white p-3', i === 0 && 'animate-pop shadow-hard')}
              data-testid="pw-fired"
            >
              <p className="font-display text-lg font-extrabold leading-snug">“{q.text}”</p>
              <p className="text-xs text-ink-soft">— {player(q.byPlayerId)?.name ?? 'a shark'}, {team(q.byTeamId)?.name}</p>
            </div>
          ))}
        </section>
      )}

      {view.role === 'shark' && <SharkTools {...props} />}

      {pitching && !iPitch && (
        <Card color="paper" padding="sm" className="text-center text-sm">
          Your teammate has the mic. Drop lifelines in team chat 💬
        </Card>
      )}

      {canDrive && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t-3 border-ink bg-paper/95 px-4 pt-3 safe-bottom backdrop-blur">
          <div className="mx-auto max-w-[520px] pr-[76px]">
            <Button block size="lg" color="sun" onClick={() => send('done', { stage: view.stage })} data-testid="pw-done">
              🤑 Done — show me the money
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function SharkTools({ view, send }: Props) {
  const hand = view.sharkHand
  const [aim, setAim] = useState<string | null>(null)
  if (!hand) return null
  return (
    <section className="flex flex-col gap-3" data-testid="pw-shark-tools">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-xl font-black">🦈 Grill them</h3>
        <span className="font-display text-sm font-bold">{hand.firesLeft} shot{hand.firesLeft === 1 ? '' : 's'} left</span>
      </div>
      <div className="flex flex-col gap-2">
        {hand.questions.map((q) => (
          <button
            key={q.id}
            type="button"
            disabled={q.fired || hand.firesLeft <= 0}
            onClick={() => send('fire', { stage: view.stage, id: q.id })}
            data-testid="pw-question"
            className={cn(
              'flex min-h-14 items-center gap-3 rounded-2xl border-3 border-ink px-3 py-2 text-left font-display font-bold leading-snug transition-transform',
              q.fired ? 'bg-ink/10 line-through opacity-60' : 'bg-white shadow-hard-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none',
              !q.fired && hand.firesLeft <= 0 && 'opacity-50',
            )}
          >
            <span className="text-2xl" aria-hidden>{q.fired ? '✅' : '🎯'}</span>
            <span className="min-w-0 flex-1">{q.text}</span>
          </button>
        ))}
      </div>

      {hand.curveballs.length > 0 && (
        <Card color="tomato" soft padding="sm" className="flex flex-col gap-2">
          <p className="font-display text-lg font-black">⚾ Curveball <span className="text-sm font-bold">(1 per round — use it wisely)</span></p>
          {!hand.canCurveball && <p className="text-sm font-bold">Someone already threw one at this pitch.</p>}
          {hand.curveballs.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={!hand.canCurveball}
              onClick={() => setAim(aim === c.id ? null : c.id)}
              data-testid="pw-curveball"
              className={cn(
                'min-h-12 rounded-2xl border-3 border-ink px-3 py-2 text-left font-display font-bold leading-snug',
                aim === c.id ? 'bg-tomato shadow-hard-sm' : 'bg-white',
                !hand.canCurveball && 'opacity-50',
              )}
            >
              {c.text}
            </button>
          ))}
          {aim && hand.canCurveball && (
            <Button block color="tomato" size="lg" onClick={() => { send('curveball', { stage: view.stage, id: aim }); setAim(null) }} data-testid="pw-throw">
              💥 THROW IT
            </Button>
          )}
        </Card>
      )}
    </section>
  )
}

const CHIPS = [0, 50, 100, 200, 300, 500, 750, 1000]

/** Secret cheques. */
export function Invest(props: Props) {
  const { view, player, team, me, send, deadline } = props
  const os = view.onStage
  const inv = view.invest
  const [amount, setAmount] = useState<number>(200)
  if (!os || !inv) return null
  const t = team(os.teamId)
  const shark = view.role === 'shark'
  const signedCount = inv.lockedIds.length

  const sharks = (
    <div className="flex flex-wrap justify-center gap-3" data-testid="pw-signers">
      {inv.sharkIds.map((id) => {
        const p = player(id)
        const signed = inv.lockedIds.includes(id)
        return (
          <div key={id} className="relative">
            <Avatar emoji={p?.avatar ?? '🦈'} name={p?.name} size="md" color={p?.teamId ? teamColor(team(p.teamId)) : undefined} connected={p?.connected ?? true} />
            <span className={cn('absolute -top-1 -right-1 grid size-6 place-items-center rounded-full border-2 border-ink text-xs', signed ? 'bg-lime' : 'bg-white')}>
              {signed ? '✍️' : '…'}
            </span>
          </div>
        )
      })}
    </div>
  )

  if (!shark) {
    return (
      <div className="flex flex-col items-center gap-4 text-center" data-testid="pw-invest-wait">
        <BigText color="sun" size="md">The sharks are signing cheques…</BigText>
        <Poster draft={os.draft} product={os.product} twist={os.twist} color={teamColor(t)} compact />
        <p className="font-display font-bold">{signedCount}/{inv.sharkIds.length} signed</p>
        {sharks}
        <p className="text-sm text-ink-soft">Your Ask was {money(os.draft.ask)}. Fingers crossed 🤞</p>
      </div>
    )
  }

  const max = inv.wallet
  const amt = Math.min(amount, max)
  return (
    <div className="flex flex-col gap-4" data-testid="pw-invest">
      <div className="flex justify-end"><Countdown deadline={deadline} variant="badge" warnAt={8} /></div>
      <div className="-mt-2 text-center">
        <p className="font-display text-sm font-black uppercase tracking-widest text-ink-soft">How much for</p>
        <p className="font-display text-2xl font-black leading-tight">{os.draft.mascot} {os.draft.name}?</p>
        <p className="text-sm">They asked for <b>{money(os.draft.ask)}</b> for {os.draft.equity}% · your team's average counts</p>
      </div>

      {/* The cheque */}
      <div className="relative rotate-[-1deg] rounded-2xl border-3 border-ink bg-[repeating-linear-gradient(0deg,var(--color-sky-soft)_0_22px,white_22px_24px)] p-4 shadow-hard-lg">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider">
          <span>Bank of Bakwaas 🏦</span>
          <span>Wallet: {money(max)}</span>
        </div>
        <p className="mt-2 text-sm">Pay to: <b>{t?.name}</b></p>
        <p className="mt-1 text-center font-chunky text-5xl tabular-nums" data-testid="pw-amount">{amt === 0 ? "I'M OUT" : money(amt)}</p>
        <p className="mt-2 text-right font-display text-sm italic">signed, {me.name} 🦈</p>
        {inv.mine !== null && (
          <span className="absolute -top-3 -left-2 -rotate-12 rounded-md border-3 border-ink bg-lime px-2 py-0.5 font-display text-sm font-black shadow-hard-sm">
            SIGNED {inv.mine === 0 ? '— OUT' : money(inv.mine)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            disabled={c > max}
            onClick={() => setAmount(c)}
            className={cn(
              'min-h-12 rounded-xl border-3 border-ink font-display text-sm font-extrabold',
              amt === c ? 'bg-sun shadow-hard-sm -translate-y-0.5' : 'bg-white',
              c > max && 'opacity-30',
            )}
          >
            {c === 0 ? 'Out 🙅' : money(c)}
          </button>
        ))}
      </div>

      <Button block size="xl" color={amt === 0 ? 'tomato' : 'lime'} onClick={() => send('invest', { stage: view.stage, amount: amt })} data-testid="pw-sign">
        {inv.mine !== null ? '✍️ Re-sign cheque' : amt === 0 ? "🙅 I'm out" : `✍️ Sign for ${money(amt)}`}
      </Button>
      <p className="text-center text-sm text-ink-soft">{signedCount}/{inv.sharkIds.length} sharks signed · amounts stay secret till the reveal</p>
      {sharks}
    </div>
  )
}
