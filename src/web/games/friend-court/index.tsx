import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { WebGame, GameScreenProps } from '../types.ts'
import type { FriendCourtView, Side } from '../../../games/friend-court/shared.ts'
import { REACTIONS } from '../../../games/friend-court/shared.ts'
import { Avatar, BigText, Button, Card, Countdown, cn, haptic, playSound, toast, celebrate } from '../../ui/index.ts'
import {
  Docket, EvidenceCard, FlashOverlay, FrozenClock, Reactions, Record, ROLE_META, SIDE_META, SideChip, Who, nm,
  useTransient, type Flash,
} from './parts.tsx'

type Props = GameScreenProps<FriendCourtView>

function Screen(props: Props) {
  const { view, onEvent, player, me } = props
  const [flash, setFlash] = useTransient<Flash>(1700)
  const [reactions, setReactions] = useState<{ id: number; emoji: string; x: number; name: string }[]>([])
  const counter = useRef(0)

  useEffect(() => onEvent((type, data) => {
    const id = ++counter.current
    const who = (k: string) => nm(player, data[k] as string)
    switch (type) {
      case 'objection':
        haptic('buzz'); playSound('buzz')
        setFlash({ id, kind: 'objection', title: 'OBJECTION!', sub: `${String(data.reason)} — ${who('byId')}`, emoji: '✋' })
        break
      case 'exhibit':
        playSound('pop')
        setFlash({ id, kind: 'exhibit', title: `EXHIBIT ${String(data.letter)}`, sub: String(data.text), emoji: String(data.emoji) })
        break
      case 'ruling': {
        const sustained = data.sustained === true
        playSound(sustained ? 'success' : 'whoosh')
        setFlash({
          id, kind: 'ruling', good: sustained, emoji: data.auto ? '😴' : '🔨',
          title: sustained ? 'SUSTAINED' : 'OVERRULED',
          sub: data.auto ? 'The judge dozed off. Overruled by default.' : data.struck ? `Exhibit ${String(data.struck)} is struck from the record!` : undefined,
        })
        break
      }
      case 'allRise':
        playSound('ding')
        setFlash({ id, kind: 'allRise', title: 'ALL RISE', emoji: '🔨', sub: 'Court is now in session' })
        break
      case 'floor':
        if (data.speakerId === me.id) {
          haptic('heavy'); playSound('ding')
          toast(data.takeover ? 'Grab the mic — your teammate dropped!' : 'You have the floor — unmute and talk!', { emoji: '🎤', kind: 'success' })
        }
        break
      case 'note':
        if (data.toId === me.id) { haptic('success'); toast(`${who('fromId')} slipped you a note — check your cards!`, { emoji: '📝' }) }
        else toast(`${who('fromId')} passed a note to ${who('toId')}`, { emoji: '📝' })
        break
      case 'fled':
        toast(`${who('fromId')} fled the court! ${who('toId')} now stands accused.`, { emoji: '🏃' })
        break
      case 'newJudge':
        toast(data.judgeId ? `${who('judgeId')} takes the bench.` : 'The judge left. The Robot Judge 🤖 takes over.', { emoji: '👩‍⚖️' })
        break
      case 'timeUp':
        playSound('tick')
        break
      case 'verdict':
        haptic('heavy'); playSound(data.guilty ? 'boom' : 'win')
        break
      case 'react': {
        const name = who('byId')
        setReactions((r) => [...r.slice(-14), { id, emoji: String(data.emoji), x: 8 + Math.random() * 78, name }])
        setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 2300)
        break
      }
    }
  }), [onEvent, player, me.id, setFlash])

  if (view.phase === 'over' || !view.case) return <Adjourned {...props} />

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-3 pb-24" data-testid="fc-screen" data-phase={view.phase}>
      <CaseHeader {...props} />
      {view.phase === 'reveal' && <Reveal {...props} />}
      {view.phase === 'speech' && <Speech {...props} />}
      {view.phase === 'deliberation' && <Deliberation {...props} />}
      {view.phase === 'verdict' && <Verdict {...props} />}
      {view.you.role !== 'watcher' && <ReactionBar {...props} />}
      <FlashOverlay flash={flash} />
      <Reactions items={reactions} />
    </div>
  )
}

// ---------------------------------------------------------------- header

function CaseHeader({ view, team }: Props) {
  const c = view.case!
  const compact = view.phase !== 'reveal'
  return (
    <Card color="paper" padding="sm" className="relative overflow-hidden">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
        <span className="rounded-full border-2 border-ink bg-ink px-2 py-1 font-display text-[11px] font-black uppercase tracking-wider text-paper">
          ⚖️ Case {c.no} of {view.caseCount}
        </span>
        <div className="flex min-w-0 items-center gap-1">
          <SideChip side="prosecution" team={team(c.prosecutionTeamId)} />
          <span className="text-[10px] font-black">vs</span>
          <SideChip side="defence" team={team(c.defenceTeamId)} />
        </div>
      </div>
      <h2 className={cn('font-display font-extrabold leading-tight', compact ? 'text-lg' : 'text-2xl')} data-testid="fc-title">{c.title}</h2>
      <p className={cn('mt-0.5 font-semibold leading-snug', compact ? 'text-[13px]' : 'text-[15px]')}>{c.charge}</p>
    </Card>
  )
}

function RoleBanner({ view }: Props) {
  const r = ROLE_META[view.you.role]
  const color = view.you.role === 'prosecution' ? 'bg-tomato' : view.you.role === 'defence' ? 'bg-sky' : view.you.role === 'judge' ? 'bg-grape' : 'bg-lime'
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border-3 border-ink p-3 shadow-hard', color)} data-testid="fc-role" data-role={view.you.role}>
      <span className="text-4xl leading-none" aria-hidden>{r.emoji}</span>
      <div className="min-w-0">
        <div className="font-display text-lg font-extrabold leading-tight">{r.label}</div>
        <div className="text-[13px] font-semibold leading-snug">{r.tip}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- reveal

function Reveal(props: Props) {
  const { view, send, player, team, deadline } = props
  const c = view.case!
  return (
    <>
      <RoleBanner {...props} />
      <Card padding="sm" className="flex flex-col gap-1.5">
        <div className="text-xs font-black uppercase tracking-widest text-ink-soft">Today in court</div>
        <Row label="👩‍⚖️ Judge"><Who id={c.judgeId} player={player} team={team} /></Row>
        <Row label="🙇 Accused"><Who id={c.accusedId} player={player} team={team} /></Row>
        {c.victimId && <Row label="😤 Complainant"><Who id={c.victimId} player={player} team={team} /></Row>}
        <Row label="📜 Order"><span className="text-sm font-bold">Pros → Def → Pros → Accused</span></Row>
      </Card>
      {view.you.canBegin ? (
        <Button size="xl" block color="grape" icon="🔨" onClick={() => send('begin', { seq: view.seq })} data-testid="fc-begin">
          All rise! Start the trial
        </Button>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm font-bold">
          Court opens in <Countdown deadline={deadline} variant="badge" />
          {c.judgeId && <span>or when {nm(player, c.judgeId)} bangs the gavel</span>}
        </div>
      )}
      {view.you.hand.length > 0 && (
        <section>
          <h3 className="mb-2 text-lg">Your secret evidence 🤫</h3>
          <div className="grid grid-cols-1 gap-2.5">
            {view.you.hand.map((k, i) => <EvidenceCard key={k.uid} card={k} player={player} tilt={i % 2 ? 0.8 : -0.8} />)}
          </div>
          <p className="mt-2 text-[13px] font-semibold text-ink-soft">Plan how to twist these. When you hold the floor, tap a card to enter it as an exhibit.</p>
        </section>
      )}
    </>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-2 border-b-2 border-dashed border-ink/15 pb-1.5 last:border-0 last:pb-0">
      <span className="shrink-0 text-sm font-bold text-ink-soft">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  )
}

// ---------------------------------------------------------------- speech

function Speech(props: Props) {
  const { view, send, player, team, deadline, me } = props
  const sp = view.speeches[view.speechIdx]!
  const speaker = sp.speakerId ? player(sp.speakerId) : undefined
  const isMe = sp.speakerId === me.id
  const obj = view.objection
  const speakerSide = sp.side
  const sideBg = speakerSide === 'prosecution' ? 'bg-tomato' : 'bg-sky'

  return (
    <>
      <div className={cn('relative rounded-3xl border-3 border-ink p-3 shadow-hard-lg', sideBg)} data-testid="fc-floor" data-speaker={sp.speakerId ?? ''}>
        <div className="flex items-center gap-3">
          <Avatar emoji={speaker?.avatar ?? '🎤'} size="lg" active connected={speaker?.connected ?? true} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-black uppercase tracking-wider">{SIDE_META[speakerSide].emoji} {sp.label}</div>
            <div className="font-display text-lg font-extrabold leading-tight">{isMe ? '🎤 YOU have the floor' : `${speaker?.name ?? '…'} has the floor`}</div>
            <div className="text-[13px] font-bold leading-snug">{obj ? 'Paused for an objection' : isMe ? 'Unmute and argue! Everyone else: shh.' : 'Mics off, popcorn on.'}</div>
          </div>
          {obj && view.speechRemainingMs !== null ? <FrozenClock ms={view.speechRemainingMs} /> : <Countdown deadline={deadline} variant="badge" warnAt={10} tickSound={isMe} />}
        </div>
      </div>

      {obj && <ObjectionPanel {...props} />}

      {isMe && !obj && (
        <section className="flex flex-col gap-2.5" data-testid="fc-speaker">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-lg">Present evidence</h3>
            <span className="text-xs font-black">{view.you.playedThisSpeech}/{view.rules.maxPerSpeech} used · +{view.rules.exhibitPoints} each</span>
          </div>
          {[...view.you.hand].sort((a, b) => Number(!!b.fromId) - Number(!!a.fromId)).map((k, i) => (
            <EvidenceCard
              key={k.uid} card={k} player={player} tilt={i % 2 ? 0.6 : -0.6}
              action={<Button size="sm" block color={speakerSide === 'prosecution' ? 'tomato' : 'sky'} disabled={!view.you.canPlay} onClick={() => send('play', { seq: view.seq, uid: k.uid })} data-testid="fc-play">{k.kind === 'witness' ? '🗣️ Call this witness' : '📢 Present as exhibit'}</Button>}
            />
          ))}
          <Button variant="dark" block onClick={() => send('rest', { seq: view.seq })} data-testid="fc-rest">🙇 I rest my case</Button>
        </section>
      )}

      {!isMe && view.you.side === speakerSide && !obj && (
        <section className="flex flex-col gap-2.5">
          <h3 className="text-lg">{view.you.canPassNote ? `📝 Slip ${nm(player, sp.speakerId)} a note` : '📣 Your side has the floor'}</h3>
          {view.you.canPassNote && <p className="-mt-1.5 text-[13px] font-semibold text-ink-soft">One per case. It lands in their hand and they'll have to work it in. Mid-sentence. Live.</p>}
          {view.you.canPassNote && view.you.hand.map((k) => (
            <EvidenceCard
              key={k.uid} card={k} player={player}
              action={<Button size="sm" block variant="secondary" onClick={() => send('note', { seq: view.seq, uid: k.uid })} data-testid="fc-note">📝 Pass to {nm(player, sp.speakerId)}</Button>}
            />
          ))}
        </section>
      )}

      {view.you.side && view.you.side !== speakerSide && !obj && <ObjectButton {...props} side={view.you.side} />}

      {view.you.role === 'judge' && !obj && (
        <p className="rounded-2xl border-3 border-ink bg-grape-soft p-3 text-sm font-bold">👩‍⚖️ Listen closely, Your Honour. If someone objects, you rule on it right here.</p>
      )}

      <section>
        <h3 className="mb-2 text-lg">Court record</h3>
        <Record record={view.record} player={player} />
      </section>

      <Docket speeches={view.speeches} player={player} team={team} />

      {!isMe && !(view.you.side === speakerSide && view.you.canPassNote) && view.you.hand.length > 0 && (
        <details className="rounded-2xl border-3 border-ink bg-white px-3 py-1">
          <summary className="flex min-h-11 cursor-pointer items-center font-display font-extrabold">🤫 Your cards ({view.you.hand.length})</summary>
          <div className="mb-2 mt-1 flex flex-col gap-2">{view.you.hand.map((k) => <EvidenceCard key={k.uid} card={k} player={player} />)}</div>
        </details>
      )}
    </>
  )
}

function ObjectButton({ view, send, side }: Props & { side: Side }) {
  const left = view.case!.objectionsLeft[side]
  const noJudge = !view.case!.judgeId
  return (
    <div className="flex flex-col items-center gap-1.5 py-1">
      <button
        type="button"
        disabled={!view.you.canObject}
        onClick={() => send('object', { seq: view.seq })}
        data-testid="fc-object"
        className={cn(
          'w-full -rotate-1 rounded-[28px] border-4 border-ink bg-tomato px-4 py-5 font-chunky text-[32px] leading-none text-white shadow-hard-xl',
          'text-outline [text-shadow:3px_3px_0_var(--color-ink)] transition-transform active:translate-x-[6px] active:translate-y-[6px] active:shadow-none',
          'disabled:rotate-0 disabled:opacity-45 disabled:shadow-hard-sm disabled:saturate-50',
        )}
      >
        OBJECTION!
      </button>
      <span className="text-xs font-black">
        {noJudge ? 'No judge on the bench — objections are off' : left > 0 ? `${left} objection${left === 1 ? '' : 's'} left for your side this case` : 'Your side is out of objections'}
      </span>
    </div>
  )
}

function ObjectionPanel({ view, send, player, team, deadline, me }: Props) {
  const obj = view.objection!
  const objector = obj.byId === me.id
  return (
    <div className="animate-shake rounded-3xl border-4 border-ink bg-tomato p-4 shadow-hard-lg" data-testid="fc-objection">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-chunky text-2xl leading-none text-white text-outline">OBJECTION!</div>
          <div className="mt-1 font-display text-xl font-extrabold leading-tight">“{obj.reason}”</div>
        </div>
        <Countdown deadline={deadline} variant="badge" />
      </div>
      <div className="mt-2 rounded-2xl border-2 border-ink bg-white p-2.5 text-sm font-bold">
        <Who id={obj.byId} player={player} team={team} size="xs" />
        <div className="mt-1">{objector ? 'Say it out loud! Convince the judge — you have 15 seconds.' : 'Explaining the objection out loud. Quiet in the court!'}</div>
      </div>
      {view.you.canRule ? (
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <Button size="lg" color="lime" onClick={() => send('rule', { seq: view.seq, sustained: true })} data-testid="fc-sustain">Sustained</Button>
          <Button size="lg" variant="secondary" onClick={() => send('rule', { seq: view.seq, sustained: false })} data-testid="fc-overrule">Overruled</Button>
          <p className="col-span-2 text-center text-[12px] font-bold leading-snug">Sustained: +1 to the objectors and the last exhibit is struck. Overruled: +1 to the speaker.</p>
        </div>
      ) : (
        <p className="mt-2 text-center text-sm font-black">Waiting for {nm(player, view.case!.judgeId)} to rule…</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- deliberation

function Deliberation(props: Props) {
  const { view, send, player, team, deadline } = props
  const c = view.case!
  const [guilty, setGuilty] = useState<boolean | null>(null)
  const you = view.you
  const waiting = view.deliberation?.waitingIds ?? []

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <BigText size="md" color="grape">Deliberation</BigText>
        <Countdown deadline={deadline} variant="badge" warnAt={8} />
      </div>

      {you.mustVote === 'verdict' && you.role === 'judge' && (
        <Card color="grape" soft padding="sm" className="flex flex-col gap-2.5" data-testid="fc-judge-verdict">
          <h3 className="text-lg leading-tight">👩‍⚖️ Your verdict, Your Honour{c.verdictBy === 'jury' ? ' (breaks a jury tie)' : ''}</h3>
          <div className="grid grid-cols-2 gap-2.5">
            <Button size="lg" color="tomato" className={cn(guilty === true && 'ring-4 ring-ink ring-offset-2')} onClick={() => setGuilty(true)} data-testid="fc-guilty">GUILTY</Button>
            <Button size="lg" color="lime" className={cn(guilty === false && 'ring-4 ring-ink ring-offset-2')} onClick={() => setGuilty(false)} data-testid="fc-not-guilty">NOT GUILTY</Button>
          </div>
          {guilty === null && <p className="text-center text-xs font-bold">Then pick the {`sentence`} — that seals it.</p>}
          {guilty !== null && you.sentenceOptions && (
            <div className="flex animate-pop flex-col gap-2">
              <div className="text-sm font-black">{guilty ? 'Pick the sentence:' : 'Pick the compensation:'}</div>
              {(guilty ? you.sentenceOptions.guilty : you.sentenceOptions.notGuilty).map((line, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { haptic('heavy'); send('verdict', { seq: view.seq, guilty, sentence: i }) }}
                  data-testid="fc-sentence"
                  className="min-h-11 rounded-2xl border-3 border-ink bg-white p-3 text-left text-[14px] font-bold leading-snug shadow-hard-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                >
                  🔨 {line}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {you.mustVote === 'verdict' && you.role !== 'judge' && (
        <Card color="lime" soft padding="sm" className="flex flex-col gap-2.5" data-testid="fc-jury-verdict">
          <h3 className="text-lg leading-tight">🪑 Jury: is {nm(player, c.accusedId)} guilty?</h3>
          <div className="grid grid-cols-2 gap-2.5">
            <Button size="lg" color="tomato" onClick={() => send('verdict', { seq: view.seq, guilty: true })} data-testid="fc-guilty">GUILTY</Button>
            <Button size="lg" color="lime" onClick={() => send('verdict', { seq: view.seq, guilty: false })} data-testid="fc-not-guilty">NOT GUILTY</Button>
          </div>
        </Card>
      )}

      {you.mustVote === 'respect' && you.respectTargets && (
        <Card padding="sm" className="flex flex-col gap-2" data-testid="fc-respect">
          <h3 className="text-lg leading-tight">🫡 Respect where it's due</h3>
          <p className="-mt-1 text-[13px] font-semibold text-ink-soft">Who on the OTHER side argued best? Bragging rights only, so be honest.</p>
          {you.respectTargets.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => send('respect', { seq: view.seq, playerId: id })}
              data-testid="fc-respect-target"
              className="flex min-h-12 items-center rounded-2xl border-3 border-ink bg-white px-3 py-2 shadow-hard-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
            >
              <Who id={id} player={player} team={team} />
            </button>
          ))}
        </Card>
      )}

      {you.mustVote === null && (
        <Card color="paper" padding="sm" className="text-center" data-testid="fc-waiting">
          <div className="text-4xl">🤔</div>
          <div className="font-display text-lg font-extrabold">
            {c.verdictBy === 'jury' ? 'The jury is out…' : c.judgeId ? `${nm(player, c.judgeId)} is deciding…` : 'The Robot Judge 🤖 is counting exhibits…'}
          </div>
          {waiting.length > 0 && (
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {waiting.map((id) => <Avatar key={id} emoji={player(id)?.avatar ?? '❔'} size="sm" name={player(id)?.name} />)}
            </div>
          )}
          <p className="mt-1 text-xs font-bold text-ink-soft">{waiting.length > 0 ? 'Still voting' : 'Everyone has voted'}</p>
        </Card>
      )}

      <section>
        <h3 className="mb-2 text-lg">Evidence on record</h3>
        <Record record={view.record} player={player} />
      </section>
    </>
  )
}

// ---------------------------------------------------------------- verdict

function Verdict({ view, player, team, me }: Props) {
  const v = view.verdict!
  const c = view.case!
  const winnerTeamId = v.guilty ? c.prosecutionTeamId : c.defenceTeamId
  useEffect(() => {
    if (!v.mistrial && me.teamId === winnerTeamId) void celebrate('small')
  }, [v.mistrial, me.teamId, winnerTeamId])
  const accused = player(c.accusedId)
  return (
    <div className="flex flex-col items-center gap-3 pt-1 text-center" data-testid="fc-verdict" data-guilty={String(v.guilty)}>
      <Avatar emoji={accused?.avatar ?? '🙇'} size="xl" name={accused?.name} />
      <div className={cn('animate-pop -rotate-6 rounded-2xl border-[5px] bg-white px-4 py-1.5 font-chunky text-4xl leading-none shadow-hard', v.mistrial ? 'border-ink text-ink' : v.guilty ? 'border-tomato text-tomato' : 'border-lime text-lime')}>
        {v.mistrial ? 'MISTRIAL' : v.guilty ? 'GUILTY!' : 'NOT GUILTY'}
      </div>
      <Card padding="md" tilt="right" className="w-full">
        <p className="font-display text-lg font-extrabold leading-snug" data-testid="fc-sentence-text">{v.sentence}</p>
        <p className="mt-2 text-xs font-bold text-ink-soft">
          {v.decidedBy === 'judge' ? `Ruled by ${nm(player, c.judgeId)}` : v.decidedBy === 'jury' ? `Jury: ${v.tally?.guilty ?? 0} guilty · ${v.tally?.notGuilty ?? 0} not guilty` : 'Decided by the Robot Judge 🤖 (more evidence wins, ties walk free)'}
        </p>
      </Card>
      {!v.mistrial && (
        <div className="flex w-full flex-wrap justify-center gap-2">
          {Object.entries(v.points).filter(([, n]) => n !== 0).map(([tid, n]) => {
            const t = team(tid)
            return (
              <span key={tid} className="rounded-full border-3 border-ink bg-white px-3 py-1 font-display text-sm font-extrabold shadow-hard-sm">
                {t?.emoji} {t?.name} {n > 0 ? '+' : ''}{n}
              </span>
            )
          })}
        </div>
      )}
      {v.respected.length > 0 && <p className="text-sm font-bold">🫡 Most respected by the enemy: {v.respected.map((id) => nm(player, id)).join(' & ')}</p>}
      <p className="text-xs font-bold text-ink-soft">{view.caseNo < view.caseCount ? 'Next case in a moment…' : 'Court adjourns…'}</p>
    </div>
  )
}

// ---------------------------------------------------------------- reactions & end

function ReactionBar({ view, send }: Props) {
  return (
    <div className="fixed bottom-0 left-0 right-[84px] z-[40] flex justify-start pl-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:pl-0" data-testid="fc-reactions">
      <div className="flex w-full max-w-[300px] justify-between rounded-2xl border-3 border-ink bg-white/95 p-0.5 shadow-hard backdrop-blur">
        {REACTIONS.map((e) => (
          <button
            key={e}
            type="button"
            aria-label={`React ${e}`}
            onClick={() => { haptic('tap'); send('react', { seq: view.seq, emoji: e }) }}
            className="grid size-11 place-items-center rounded-xl text-2xl transition-transform active:scale-90"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}

function Adjourned({ view, player }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-3" data-testid="fc-screen" data-phase="over">
      <BigText color="grape">Court adjourned</BigText>
      {view.history.map((h) => (
        <Card key={h.no} padding="sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-display font-extrabold">{h.title}</span>
            <span className={cn('rounded-md border-2 px-1.5 font-chunky text-xs', h.guilty ? 'border-tomato text-tomato' : 'border-lime text-lime')}>{h.mistrial ? 'MISTRIAL' : h.guilty ? 'GUILTY' : 'FREE'}</span>
          </div>
          <p className="text-sm font-semibold">{nm(player, h.accusedId)} — {h.sentence}</p>
        </Card>
      ))}
    </div>
  )
}

export const friendCourtWeb: WebGame = {
  id: 'friend-court',
  Screen,
}
