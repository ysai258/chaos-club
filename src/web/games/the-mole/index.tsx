import { useEffect, useState } from 'react'
import type { GameScreenProps, WebGame } from '../types.ts'
import type { AccusationResult, MoleView, UnmaskTeam } from '../../../games/the-mole/shared.ts'
import {
  Avatar, BigText, Button, Card, Countdown, Sheet, TeamPill, celebrate, cn, haptic, playSound,
} from '../../ui/index.ts'
import {
  BoardCard, EvidenceCard, FactRows, InputPanel, IntelCard, ObjectiveCard, PointsBadge, RoleBanner,
  SectionTitle, WaitingRow, Who, type Lookup, type TeamLookup,
} from './parts.tsx'

type P = GameScreenProps<MoleView>

function Screen(props: P) {
  const { view, onEvent, player, me } = props
  const [caseOpen, setCaseOpen] = useState(false)

  useEffect(() => onEvent((type, data) => {
    if (type === 'go') { playSound('ding'); haptic('tap') }
    if (type === 'success') { playSound('success'); haptic('success') }
    if (type === 'fail') { playSound('buzz'); haptic('error') }
    if (type === 'wiretap') playSound('whoosh')
    if (type === 'caught') {
      playSound('boom'); haptic('heavy')
      if (data.teamId === me.teamId) celebrate('small')
    }
    if (type === 'cleared') { playSound('error'); haptic('buzz') }
    if (type === 'unmask') playSound('whoosh')
  }), [onEvent, me.teamId])

  if (!view || typeof view !== 'object' || !('phase' in view)) return <p className="p-6 text-center">Loading…</p>

  return (
    <div className="grid gap-4 pb-28" data-testid="mole-screen" data-phase={view.phase}>
      <RoleBanner role={view.role} team={props.team} onCaseFile={() => setCaseOpen(true)} round={view.round} total={view.totalRounds} caseCount={view.caseFile.length} />
      {view.phase === 'briefing' && <Briefing {...props} />}
      {view.phase === 'challenge' && <Challenge {...props} />}
      {view.phase === 'debrief' && <Debrief {...props} />}
      {view.phase === 'verdict' && <Verdict {...props} />}
      {view.phase === 'finalHunt' && <FinalHunt {...props} />}
      {view.phase === 'unmasking' && <Unmasking {...props} />}
      {view.team && view.phase !== 'unmasking' && <TeamStrip {...props} />}
      <CaseFile open={caseOpen} onClose={() => setCaseOpen(false)} view={view} player={player} team={props.team} />
    </div>
  )
}

// ---------- briefing ----------

function Briefing({ view, deadline, player, team }: P) {
  const play = view.play
  if (!play) return <Card><p>Get ready…</p></Card>
  return (
    <>
      <Card color="grape" soft tilt="left" padding="lg" className="text-center animate-pop" key={view.round}>
        <div className="text-xs font-extrabold uppercase tracking-widest text-ink-soft">Challenge {view.round} of {view.totalRounds}</div>
        <div className="my-1 text-6xl animate-wiggle">{play.emoji}</div>
        <BigText color="sun" size="lg">{play.name}</BigText>
        <ul className="mt-3 grid gap-1.5 text-left">
          {play.rules.map((r, i) => (
            <li key={i} className="flex gap-2 text-[15px] font-medium leading-snug"><span className="font-display font-black">{i + 1}.</span><span>{r}</span></li>
          ))}
        </ul>
        <div className="mt-4 flex justify-center"><Countdown deadline={deadline} variant="badge" /></div>
      </Card>
      {play.objective && <ObjectiveCard text={play.objective} />}
      <IntelCard intel={play.intel} player={player} team={team} />
    </>
  )
}

// ---------- challenge ----------

function Challenge({ view, deadline, player, team, send, me }: P) {
  const play = view.play
  if (!play) return null
  const submit = (value: unknown) => send('play', { round: view.round, stage: play.stage, value })
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-extrabold uppercase tracking-widest text-ink-soft">{play.emoji} {play.name}</div>
          <h2 className="font-display text-2xl font-black leading-tight">{play.stageLabel}</h2>
        </div>
        <Countdown deadline={deadline} variant="badge" />
      </div>
      {play.objective && <ObjectiveCard text={play.objective} />}
      {play.facts.length > 0 && (
        <Card padding="sm" data-testid="mole-facts">
          <FactRows facts={play.facts} player={player} team={team} />
        </Card>
      )}
      <IntelCard intel={play.intel} player={player} team={team} />
      {play.board && <BoardCard board={play.board} player={player} team={team} />}
      {play.input && (
        <Card color="paper" padding="md" key={`${view.round}-${play.stage}`} className="animate-slide-up">
          <InputPanel spec={play.input} onSubmit={submit} color={view.role.kind === 'mole' ? 'lime' : 'sun'} player={player} team={team} />
        </Card>
      )}
      {play.mine && (
        <div className="rounded-2xl border-3 border-ink bg-lime px-4 py-3 font-display text-lg font-extrabold shadow-hard-sm animate-pop" data-testid="mole-mine">
          ✅ {play.mine}
        </div>
      )}
      <WaitingRow ids={play.waitingOn} player={player} team={team} meId={me.id} />
      {play.note && <p className="rounded-2xl border-2 border-dashed border-ink/40 px-3 py-2 text-sm text-ink-soft">💡 {play.note}</p>}
      <RivalsRow view={view} team={team} />
    </>
  )
}

function RivalsRow({ view, team }: { view: MoleView; team: TeamLookup }) {
  if (!view.rivals.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="mole-rivals">
      {view.rivals.map((r) => {
        const t = team(r.teamId)
        if (!t) return null
        return (
          <span key={r.teamId} className="inline-flex items-center gap-1.5">
            <TeamPill team={t} size="sm" />
            <span className="text-sm font-bold">
              {r.success === null ? (r.done ? 'done ✔' : 'working…') : r.success ? `✅ ${r.points! >= 0 ? '+' : ''}${r.points}` : `❌ ${r.points}`}
            </span>
          </span>
        )
      })}
    </div>
  )
}

// ---------- debrief ----------

function Debrief({ view, player, team, send, me, deadline }: P) {
  const db = view.debrief
  const entry = view.caseFile[view.caseFile.length - 1]
  const [tapOpen, setTapOpen] = useState(false)
  if (!db) return <Card><p className="font-bold">Teams are reviewing the evidence…</p></Card>
  const ev = db.evidence
  const myVote = db.votes.find((v) => v.voter === me.id)?.target ?? null
  const countFor = (id: string) => db.votes.filter((v) => v.target === id).length
  const vote = (target: string) => { haptic('tap'); send('vote', { round: view.round, target }) }
  const tappable = (view.team?.members ?? []).filter((m) => m.id !== me.id && !m.gone)
  return (
    <>
      {ev && (
        <Card color={ev.success ? 'lime' : 'tomato'} soft tilt="right" padding="md" key={`ev-${view.round}`} className="animate-pop">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-extrabold uppercase tracking-widest text-ink-soft">{entry?.emoji} {entry?.name} · evidence</div>
            <PointsBadge points={ev.points} />
          </div>
          <BigText color={ev.success ? 'lime' : 'tomato'} size="lg" className="my-1">{ev.success ? 'NAILED IT' : 'BOTCHED'}</BigText>
          <p className="mb-3 font-display text-lg font-bold leading-snug">{ev.headline}</p>
          <EvidenceCard ev={ev} player={player} team={team} />
        </Card>
      )}
      <RivalsRow view={view} team={team} />

      {db.wiretap ? (
        <Card color="sky" soft padding="sm" data-testid="mole-wiretap-result">
          <SectionTitle>📞 Wiretap</SectionTitle>
          <p className="text-[15px]"><Who id={db.wiretap.by} player={player} team={team} /> tapped <Who id={db.wiretap.target} player={player} team={team} />:</p>
          <p className="mt-1 font-display text-xl font-black">{db.wiretap.text}</p>
        </Card>
      ) : db.canWiretap ? (
        <Button variant="secondary" block icon="📞" onClick={() => setTapOpen(true)} data-testid="mole-wiretap">Wiretap a teammate (−{db.wiretapCost} pts)</Button>
      ) : null}

      <Card padding="md" data-testid="mole-accuse">
        <SectionTitle right={<span className="flex items-center gap-2"><span className="text-sm font-black" title="Accusations left">{'🔍'.repeat(view.team?.badges ?? 0) || '—'}</span><Countdown deadline={deadline} variant="badge" /></span>}>
          {db.canAccuse ? 'Accuse someone?' : view.team?.moleCaught ? 'Mole caught ✔' : 'No accusations left'}
        </SectionTitle>
        {db.canAccuse && (
          <p className="mb-3 text-sm text-ink-soft">A majority of <b>everyone else</b> convicts. Right: <b>+{view.scoring.catch}</b>. Wrong: <b>{view.scoring.wrong}</b> and they're cleared. Votes are public to your team.</p>
        )}
        {db.canAccuse && (
          <div className="mb-3 grid gap-2">
            {db.needed.filter((n) => n.playerId !== me.id).map((n) => {
              const c = countFor(n.playerId)
              const mine = myVote === n.playerId
              const voters = db.votes.filter((v) => v.target === n.playerId).map((v) => v.voter)
              return (
                <button
                  key={n.playerId}
                  type="button"
                  data-testid={`mole-accuse-${n.playerId}`}
                  onClick={() => vote(n.playerId)}
                  className={cn(
                    'flex min-h-14 min-w-0 items-center gap-2 rounded-2xl border-3 border-ink px-2.5 py-1.5 text-left transition-transform',
                    mine ? 'bg-tomato -translate-y-0.5 shadow-hard' : 'bg-white shadow-hard-sm',
                  )}
                >
                  <span className="min-w-0 flex-1"><Who id={n.playerId} player={player} team={team} size="sm" /></span>
                  <span className="flex shrink-0 -space-x-2">
                    {voters.map((v) => <Avatar key={v} emoji={player(v)?.avatar ?? '❔'} size="xs" />)}
                  </span>
                  <span className={cn('shrink-0 rounded-lg border-2 border-ink px-1.5 font-display text-sm font-black', c >= n.needed ? 'bg-tomato' : 'bg-paper')}>{c}/{n.needed}</span>
                </button>
              )
            })}
          </div>
        )}
        <Button block size="md" variant={myVote === 'pass' ? 'success' : 'secondary'} icon={db.canAccuse ? '🤐' : '👍'} onClick={() => vote('pass')} data-testid="mole-pass">
          {db.canAccuse ? (myVote === 'pass' ? 'No accusation (voted)' : 'No accusation this round') : myVote === 'pass' ? 'Ready ✔' : "I'm ready"}
        </Button>
        <p className="mt-2 text-center text-xs font-bold text-ink-soft">{db.votes.length}/{db.voters.length} of your team decided</p>
      </Card>

      <Sheet open={tapOpen} onClose={() => setTapOpen(false)} title="📞 Wiretap who?">
        <p className="mb-3 text-sm text-ink-soft">Your whole team sees exactly what they did this round — and that it was you who asked.</p>
        <div className="grid gap-2">
          {tappable.map((m) => (
            <Button key={m.id} variant="secondary" block onClick={() => { send('wiretap', { round: view.round, target: m.id }); setTapOpen(false) }} data-testid={`mole-tap-${m.id}`}>
              <Who id={m.id} player={player} team={team} size="sm" />
            </Button>
          ))}
        </div>
      </Sheet>
    </>
  )
}

// ---------- verdict ----------

function VerdictCard({ v, player, team, mine }: { v: AccusationResult; player: Lookup; team: TeamLookup; mine: boolean }) {
  const t = team(v.teamId)
  const name = v.accused ? player(v.accused)?.name ?? 'Someone' : ''
  return (
    <Card color={v.correct ? 'lime' : 'tomato'} tilt={v.correct ? 'left' : 'right'} padding="md" className="animate-pop text-center" data-testid="mole-verdict">
      {t && <div className="mb-2 flex justify-center"><TeamPill team={t} size="sm" /></div>}
      {v.accused && <div className="flex justify-center"><Avatar emoji={player(v.accused)?.avatar ?? '❔'} size="xl" className={v.correct ? 'animate-wiggle' : 'animate-shake'} /></div>}
      <BigText color="white" size="lg" className="mt-2">{v.correct ? `${name} WAS THE MOLE!` : `${name} is innocent`}</BigText>
      <div className="mt-2 flex justify-center"><PointsBadge points={v.points} /></div>
      {mine && v.votes.length > 0 && (
        <div className="mt-3 grid gap-1 text-left text-sm">
          {v.votes.map((x) => (
            <div key={x.voter} className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-white/70 px-2 py-1">
              <Who id={x.voter} player={player} team={team} />
              <span className="shrink-0 font-bold">{x.target === 'pass' ? 'abstained' : <>→ {player(x.target)?.name}</>}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function Verdict({ view, player, team }: P) {
  return (
    <>
      <BigText color="sun" size="xl" className="text-center">The verdict</BigText>
      {view.verdicts.map((v) => <VerdictCard key={v.teamId} v={v} player={player} team={team} mine={v.teamId === view.myTeamId} />)}
    </>
  )
}

// ---------- final hunt ----------

function FinalHunt({ view, player, team, send, deadline, me }: P) {
  const fh = view.finalHunt
  if (!fh) return null
  const pickTarget = (target: string) => { haptic('heavy'); send('finalVote', { round: view.round, target }) }
  return (
    <>
      <Card color="ink" padding="lg" className="text-center" data-testid="mole-final">
        <div className="text-5xl animate-wiggle-loop">🔦</div>
        <BigText color="tomato" size="xl">FINAL HUNT</BigText>
        <p className="mt-2 text-paper/90">{fh.required ? 'Last chance. Who is the Mole? Most votes wins — a tie lets them escape.' : 'Your team is done hunting. Watch the others sweat.'}</p>
        <div className="mt-3 flex justify-center"><Countdown deadline={deadline} variant="big" tickSound /></div>
      </Card>
      {fh.required && (
        <div className="grid gap-2">
          {fh.options.map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`mole-final-${id}`}
              onClick={() => pickTarget(id)}
              className={cn(
                'flex min-h-16 min-w-0 items-center gap-3 rounded-2xl border-3 border-ink px-3 text-left transition-transform',
                fh.myVote === id ? 'bg-tomato -translate-y-0.5 shadow-hard animate-pop' : 'bg-white shadow-hard-sm',
              )}
            >
              <span className="min-w-0 flex-1 text-lg"><Who id={id} player={player} team={team} size="sm" /></span>
              {fh.myVote === id && <span className="shrink-0 font-display font-black">🎯 my pick</span>}
            </button>
          ))}
          {fh.allowClean && (
            <Button block size="lg" variant={fh.myVote === 'clean' ? 'success' : 'secondary'} icon="🧼" onClick={() => pickTarget('clean')} data-testid="mole-final-clean">We have no mole</Button>
          )}
          <div className="flex flex-wrap justify-center gap-1.5 text-sm font-bold text-ink-soft">
            {fh.voters.map((id) => (
              <span key={id} className={cn('rounded-full border-2 border-ink px-2 py-0.5', fh.voted.includes(id) ? 'bg-lime text-ink' : 'bg-white')}>
                {id === me.id ? 'you' : player(id)?.name} {fh.voted.includes(id) ? '✔' : '…'}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ---------- unmasking ----------

const FATE: Record<UnmaskTeam['fate'], { label: string; color: 'lime' | 'tomato' | 'sky' }> = {
  caught: { label: 'CAUGHT', color: 'lime' },
  final: { label: 'NAILED IN THE FINAL HUNT', color: 'lime' },
  escaped: { label: 'ESCAPED!', color: 'tomato' },
  clean: { label: 'NO MOLE AT ALL', color: 'sky' },
  'clean-missed': { label: 'NO MOLE — YOU WERE PARANOID', color: 'sky' },
}

function Unmasking({ view, player, team, send }: P) {
  const list = view.unmasking ?? []
  useEffect(() => { celebrate('small') }, [])
  return (
    <>
      <BigText color="bubblegum" size="xl" className="text-center">The unmasking</BigText>
      {list.map((u, i) => {
        const t = team(u.teamId)
        const emp = u.employerTeamId ? team(u.employerTeamId) : undefined
        const mole = u.moleId ? player(u.moleId) : undefined
        const fate = FATE[u.fate]
        return (
          <Card key={u.teamId} color={t?.color ?? 'white'} soft tilt={i % 2 ? 'right' : 'left'} padding="md" className="animate-fade-in" style={{ animationDelay: `${i * 0.5}s`, animationDuration: '0.6s' }} data-testid="mole-unmask">
            <div className="flex items-center justify-between gap-2">
              {t && <TeamPill team={t} size="sm" />}
              <span className={cn('rounded-lg border-2 border-ink px-2 py-0.5 font-display text-xs font-black', fate.color === 'lime' ? 'bg-lime' : fate.color === 'tomato' ? 'bg-tomato' : 'bg-sky')}>{fate.label}</span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Avatar emoji={mole?.avatar ?? '🧼'} size="lg" className="animate-wiggle" />
              <div className="min-w-0">
                <div className="text-xs font-extrabold uppercase tracking-wide text-ink-soft">{u.moleId ? 'Their mole was' : 'Their mole was…'}</div>
                <div className="font-display text-2xl font-black leading-tight break-words">{mole?.name ?? (u.moleId ? 'Someone' : 'nobody!')} {u.moleId && '🐀'}</div>
                {emp && <div className="text-sm">working for <b>{emp.emoji} {emp.name}</b></div>}
              </div>
            </div>
            {u.hits.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="text-sm font-bold">Sabotaged:</span>
                {u.hits.map((h) => <span key={h.round} className="rounded-lg border-2 border-ink bg-white px-1.5 text-sm font-bold">{h.emoji} R{h.round}</span>)}
              </div>
            )}
            {u.moleId && u.hits.length === 0 && <p className="mt-2 text-sm font-bold">Zero sabotages landed. All talk.</p>}
            {u.payouts.length > 0 && (
              <ul className="mt-3 grid gap-1">
                {u.payouts.map((p, j) => {
                  const pt = team(p.teamId)
                  return (
                    <li key={j} className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink bg-white px-2 py-1 text-sm">
                      <span className="min-w-0 truncate font-bold">{p.label} → {pt?.emoji} {pt?.name}</span>
                      <PointsBadge points={p.points} />
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        )
      })}
      {view.isHost ? (
        <Button size="xl" block icon="🏆" className="relative z-10" onClick={() => send('finish', {})} data-testid="mole-finish">Final scores</Button>
      ) : (
        <p className="text-center text-sm font-bold text-ink-soft">Final scores in a moment…</p>
      )}
    </>
  )
}

// ---------- team strip ----------

function TeamStrip({ view, player, team }: P) {
  const tm = view.team
  if (!tm) return null
  const t = view.myTeamId ? team(view.myTeamId) : undefined
  return (
    <div className="rounded-2xl border-3 border-dashed border-ink/30 p-2.5" data-testid="mole-team">
      <div className="mb-1.5 flex items-center justify-between text-xs font-extrabold uppercase tracking-wide text-ink-soft">
        <span>{t ? `${t.emoji} ${t.name}` : 'Your team'}</span>
        <span>{tm.moleCaught ? 'mole caught ✔' : `${tm.badges} accusation${tm.badges === 1 ? '' : 's'} left`}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {tm.members.map((m) => {
          const p = player(m.id)
          return (
            <span key={m.id} className="inline-flex items-center gap-1 text-sm">
              <Avatar emoji={p?.avatar ?? '❔'} size="xs" color={t?.color} connected={!m.gone && (p?.connected ?? true)} />
              <span className={cn('max-w-24 truncate font-bold', m.gone && 'line-through opacity-50')}>{p?.name}</span>
              {m.status === 'cleared' && <span title="cleared">😇</span>}
              {m.status === 'exposed' && <span title="exposed mole">🐀</span>}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ---------- case file ----------

function CaseFile({ open, onClose, view, player, team }: { open: boolean; onClose: () => void; view: MoleView; player: Lookup; team: TeamLookup }) {
  return (
    <Sheet open={open} onClose={onClose} title="🗂️ Case file">
      {view.caseFile.length === 0 ? <p className="text-ink-soft">No evidence yet. Play a challenge first.</p> : (
        <div className="grid gap-3" data-testid="mole-casefile">
          {[...view.caseFile].reverse().map((c) => (
            <Card key={c.round} padding="sm" color={c.evidence.success ? 'lime' : 'tomato'} soft shadow="sm">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-display font-black">R{c.round} · {c.emoji} {c.name}</span>
                {!c.skipped && <PointsBadge points={c.evidence.points} />}
              </div>
              <p className="mb-2 text-sm font-bold">{c.evidence.headline}</p>
              {!c.skipped && <EvidenceCard ev={c.evidence} player={player} team={team} compact />}
              {c.wiretap && <p className="mt-2 text-sm">📞 <b>{player(c.wiretap.by)?.name}</b> tapped <b>{player(c.wiretap.target)?.name}</b>: {c.wiretap.text}</p>}
              {c.accusation && c.accusation.accused && (
                <p className="mt-2 text-sm font-bold">{c.accusation.correct ? '🐀 Caught' : '😇 Wrongly accused'}: {player(c.accusation.accused)?.name}</p>
              )}
            </Card>
          ))}
        </div>
      )}
      {toastHint(view)}
    </Sheet>
  )
}

function toastHint(view: MoleView) {
  if (view.role.kind !== 'mole') return null
  return <p className="mt-3 text-center text-xs text-ink-soft">🐀 Tip: your teammates are reading this too. Have a story ready.</p>
}


export const theMoleWeb: WebGame = { id: 'the-mole', Screen }
