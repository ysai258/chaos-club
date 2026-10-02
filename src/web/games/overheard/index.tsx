import { useEffect, useRef, useState } from 'react'
import type { WebGame, GameScreenProps } from '../types.ts'
import type { TeamColor } from '../../../shared/protocol.ts'
import type { Digit, OverheardView, TeamPublic } from '../../../games/overheard/shared.ts'
import { Badge, Button, COLOR, Card, Countdown, Input, celebrate, cn, haptic, playSound, toast } from '../../ui/index.ts'
import { CodeChips, GuessPicker, IntelSheet, StatusPills, Tabs, TokenBar, columnsOf } from './parts.tsx'

type Props = GameScreenProps<OverheardView>

function Screen(props: Props) {
  const { view: v, onEvent, team } = props
  // The sheet follows the action: their intel while intercepting or in sudden death, our words otherwise.
  const activeTeam = v.phase === 'transmit' || v.phase === 'guess' || v.phase === 'reveal' ? v.order[v.active] : null
  const autoTab: 'ours' | 'theirs' = v.phase === 'tiebreak' || (activeTeam && activeTeam !== v.myTeamId) ? 'theirs' : 'ours'
  const [picked, setPicked] = useState<{ tab: 'ours' | 'theirs'; turn: number } | null>(null)
  const tab = picked && picked.turn === v.turn ? picked.tab : autoTab
  const setTab = (t: 'ours' | 'theirs') => setPicked({ tab: t, turn: v.turn })

  useEffect(
    () =>
      onEvent((type, data) => {
        const mine = data.teamId === v.myTeamId
        switch (type) {
          case 'clue':
            playSound('pop')
            haptic('tap')
            break
          case 'sandtimer':
            if (!mine) {
              toast('The other encryptor is done. 30 seconds left!', { emoji: '⏳' })
              playSound('tick')
            }
            break
          case 'transmit':
            playSound('whoosh')
            break
          case 'reveal': {
            const good = mine ? data.decoded !== false && !data.intercepted : !!data.intercepted
            const bad = mine ? data.decoded === false || !!data.intercepted : false
            if (bad) {
              playSound('buzz')
              haptic('buzz')
            } else if (good) {
              playSound('success')
              haptic('success')
            } else playSound('ding')
            if (!mine && data.intercepted) void celebrate('small')
            break
          }
          case 'gameover':
            if (data.winner === v.myTeamId) {
              playSound('win')
              void celebrate('big')
            }
            break
        }
      }),
    [onEvent, v.myTeamId],
  )

  const myColor: TeamColor = (v.myTeamId && team(v.myTeamId)?.color) || 'sun'
  const rivalColor: TeamColor = (v.rivalTeamId && team(v.rivalTeamId)?.color) || 'grape'
  const myPub = v.teams.find((t) => t.id === v.myTeamId)
  const rivalPub = v.teams.find((t) => t.id === v.rivalTeamId)

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-3 pb-6" data-testid="overheard" data-phase={v.phase}>
      <div className="flex items-center justify-between gap-2">
        <Badge color="ink" size="md">
          Round {v.round}/{v.maxRounds}
        </Badge>
        <span className="truncate font-display text-sm font-bold text-ink-soft">{phaseLabel(v)}</span>
        <Countdown deadline={props.deadline} variant="badge" warnAt={10} tickSound />
      </div>
      <TokenBar teams={v.teams} info={team} myTeamId={v.myTeamId} />

      <PhasePanel {...props} myColor={myColor} rivalColor={rivalColor} />

      {v.phase !== 'over' && v.myTeamId && myPub && rivalPub && (
        <Card padding="sm" className="flex flex-col gap-3">
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: 'ours', label: '🔐 Our words', color: myColor },
              { value: 'theirs', label: '🕵️ Their intel', color: rivalColor },
            ]}
          />
          {tab === 'ours' ? (
            <IntelSheet
              history={myPub.history}
              keywords={v.myKeywords}
              notes={null}
              color={myColor}
              empty="Every clue your team gives lands under its number. The rivals see this sheet too, without the words."
            />
          ) : (
            <IntelSheet
              history={rivalPub.history}
              keywords={null}
              notes={v.notes}
              onNote={(index, text) => props.send('note:set', { index, text })}
              color={rivalColor}
              empty="Their clues pile up here. Type your team's guesses for their words at the top. Only your team sees them."
            />
          )}
        </Card>
      )}
      {v.phase !== 'over' && !v.myTeamId && (
        <Card padding="sm" color="paper" className="text-center text-sm">
          👀 You're spectating this one. You'll be in the next game.
        </Card>
      )}
    </div>
  )
}

function phaseLabel(v: OverheardView): string {
  switch (v.phase) {
    case 'encrypt': return 'Writing clues'
    case 'transmit': return 'On air'
    case 'guess': return 'Decoding'
    case 'reveal': return 'The reveal'
    case 'tiebreak': return 'Sudden death'
    case 'over': return 'Game over'
  }
}

type PanelProps = Props & { myColor: TeamColor; rivalColor: TeamColor }

function PhasePanel(p: PanelProps) {
  switch (p.view.phase) {
    case 'encrypt': return <EncryptPanel {...p} />
    case 'transmit':
    case 'guess': return <TransmissionPanel {...p} />
    case 'reveal': return <RevealPanel {...p} />
    case 'tiebreak': return <TiebreakPanel {...p} />
    case 'over': return <OverPanel {...p} />
  }
}

const name = (p: Props, id: string | null | undefined) => (id && p.player(id)?.name) || 'Someone'

// ---------------------------------------------------------------- encrypt

function EncryptPanel(p: PanelProps) {
  const v = p.view
  const me = v.teams.find((t) => t.id === v.myTeamId)
  const rival = v.teams.find((t) => t.id === v.rivalTeamId)
  const amEncryptor = !!v.myCode
  if (amEncryptor && me && !me.submitted) return <ClueWriter {...p} />

  const status = (
    <StatusPills
      items={v.teams.map((t) => ({
        label: `${name(p, t.encryptorId)} (${p.team(t.id)?.name ?? 'team'})`,
        done: t.submitted,
        color: p.team(t.id)?.color ?? 'sun',
        idle: '✍️',
        doneText: '✅',
      }))}
    />
  )
  return (
    <Card color={p.myColor} soft tilt="left" className="flex flex-col items-center gap-3 text-center">
      {amEncryptor ? (
        <>
          <div className="text-5xl" aria-hidden>📨</div>
          <h2 className="text-2xl">Clues locked and loaded</h2>
          <p className="text-sm">Your code is <CodeChips code={v.myCode!} size="sm" color={p.myColor} />. Keep a poker face.</p>
          {rival && !rival.submitted && <p className="text-sm font-semibold">Waiting for {name(p, rival.encryptorId)}…</p>}
        </>
      ) : v.myTeamId ? (
        <>
          <div className="animate-wiggle-loop text-5xl" aria-hidden>🤫</div>
          <h2 className="text-2xl leading-tight">{name(p, me?.encryptorId)} is cooking up your clues</h2>
          <p className="text-sm">Study both sheets below. Next you'll hear three clues and crack the code together in team chat.</p>
        </>
      ) : (
        <h2 className="text-2xl">Encryptors are writing clues…</h2>
      )}
      {status}
    </Card>
  )
}

function ClueWriter(p: PanelProps) {
  const v = p.view
  const code = v.myCode!
  const [clues, setClues] = useState<string[]>(() => v.myClueDraft ?? ['', '', ''])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const turn = v.turn
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const mine = v.teams.find((t) => t.id === v.myTeamId)
  const past = mine ? pastByNumber(mine) : [[], [], [], []]

  const update = (i: number, text: string) => {
    const next = clues.map((c, k) => (k === i ? text : c))
    setClues(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => p.send('clue:draft', { turn, clues: next }), 350)
  }
  const ready = clues.every((c) => c.trim().length > 0)

  return (
    <Card color={p.myColor} soft className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="font-display text-sm font-extrabold uppercase tracking-widest">Your secret code</span>
        <span data-testid="my-code" data-code={code.join('-')}><CodeChips code={code} color={p.myColor} flip /></span>
        <p className="text-sm">One clue per number. Obvious to your team, baffling to the rivals. You'll read them aloud next.</p>
      </div>
      {code.map((d, i) => (
        <div key={i} className="flex flex-col gap-1">
          <Input
            label={
              <span className="flex items-center gap-1.5 normal-case tracking-normal">
                <span className="grid size-6 place-items-center rounded-full border-2 border-ink bg-white font-chunky text-xs">{d}</span>
                <span className="text-base">{v.myKeywords?.[d - 1]}</span>
              </span>
            }
            value={clues[i] ?? ''}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="none"
            enterKeyHint={i < 2 ? 'next' : 'send'}
            placeholder={`Clue for ${d}`}
            data-testid={`clue-${i}`}
            onChange={(e) => update(i, e.target.value)}
          />
          {past[d - 1]!.length > 0 && (
            <p className="truncate pl-1 text-xs text-ink-soft">Before: {past[d - 1]!.join(' · ')}</p>
          )}
        </div>
      ))}
      <Button size="lg" block color={p.myColor} icon="📡" disabled={!ready} onClick={() => p.send('clue:submit', { turn, clues })}>
        Send clues
      </Button>
      <p className="text-center text-xs text-ink-soft">No saying your own words. No repeating an old clue. When time's up, whatever you typed goes out.</p>
    </Card>
  )
}

function pastByNumber(t: TeamPublic): string[][] {
  const out: string[][] = [[], [], [], []]
  for (const row of t.history) row.code.forEach((d, i) => out[d - 1]!.push(row.clues[i] ?? ''))
  return out
}

// ---------------------------------------------------------------- transmit + guess

function TransmissionPanel(p: PanelProps) {
  const v = p.view
  const tx = v.transmission!
  const txTeam = p.team(tx.teamId)
  const txColor: TeamColor = txTeam?.color ?? 'sky'
  const onAir = v.phase === 'transmit'
  const role = tx.role

  if (onAir && role === 'encryptor') return <OnAir {...p} />

  const header = (
    <div className="flex items-center gap-2">
      <span className={cn('text-3xl', onAir && 'animate-pulse-soft')} aria-hidden>{onAir ? '📡' : '🧩'}</span>
      <div className="min-w-0">
        <p className="font-display text-xs font-extrabold uppercase tracking-widest text-ink/60">{txTeam?.emoji} {txTeam?.name} transmission</p>
        <h2 className="text-xl leading-tight">
          {onAir ? `${name(p, tx.encryptorId)} is on air. Listen!` : headline(role)}
        </h2>
      </div>
    </div>
  )

  const clueList = (
    <ol className="flex flex-col gap-1.5">
      {[0, 1, 2].map((i) => {
        const c = tx.clues[i]
        return (
          <li
            key={`${i}-${c ?? ''}`}
            className={cn(
              'flex items-center gap-2 rounded-xl border-3 border-ink px-3 py-2 font-display text-lg font-extrabold',
              c !== undefined ? 'animate-pop bg-white shadow-hard-sm' : 'border-dashed bg-transparent text-ink/30',
            )}
          >
            <span className="font-chunky text-xs text-ink/40">#{i + 1}</span>
            <span className="min-w-0 break-words" data-testid={`heard-${i}`}>{c ?? '…'}</span>
          </li>
        )
      })}
    </ol>
  )

  const statuses = (
    <StatusPills
      items={v.teams
        .filter((t) => tx.guessing[t.id])
        .map((t) => ({
          label: t.id === tx.teamId ? `${p.team(t.id)?.name} decoding` : `${p.team(t.id)?.name} intercepting`,
          done: tx.locked[t.id] ?? false,
          color: p.team(t.id)?.color ?? 'sun',
        }))}
    />
  )

  if (onAir) {
    return (
      <Card color={txColor} soft className="flex flex-col gap-3">
        {header}
        {clueList}
      </Card>
    )
  }

  // guessing
  const mine = tx.teamId === v.myTeamId
  // Under each number: our keyword, or for the rivals our note, else their latest clue for it.
  const rivalCols = columnsOf(v.teams.find((t) => t.id === tx.teamId)?.history ?? [])
  const labels = mine ? (v.myKeywords ?? []) : [0, 1, 2, 3].map((i) => v.notes?.[i] || rivalCols[i]!.at(-1)?.clue || '')
  return (
    <Card color={txColor} soft className="flex flex-col gap-3">
      {header}
      {(role === 'decoder' || role === 'interceptor') && tx.myGuess ? (
        <>
          <p className="rounded-xl border-2 border-dashed border-ink bg-white/70 px-2 py-1.5 text-center text-xs font-semibold">
            {role === 'decoder' ? '🤐 Talk in team chat. The rivals can hear the call!' : '🎧 Use their old clues in the intel sheet below. Plot in team chat.'}
          </p>
          <GuessPicker
            clues={tx.clues}
            guess={tx.myGuess}
            labels={labels}
            color={p.myColor}
            who={(id) => name(p, id)}
            meId={p.me.id}
            onChange={(slots) => p.send('guess:set', { turn: v.turn, slots })}
            onLock={(slots) => p.send('guess:lock', { turn: v.turn, slots })}
          />
        </>
      ) : (
        <>
          {clueList}
          {role === 'encryptor' && (
            <p className="text-center text-sm">
              Your code was <CodeChips code={v.myCode ?? [null, null, null]} size="sm" color={p.myColor} />. Not a word. Not a smirk. 😐
            </p>
          )}
          {role === 'listener' && (
            <p className="text-center text-sm">Interception opens in round {v.interceptFromRound}. Remember these clues: they point at their secret words.</p>
          )}
        </>
      )}
      {statuses}
    </Card>
  )
}

function headline(role: string): string {
  switch (role) {
    case 'decoder': return 'Crack your own code'
    case 'interceptor': return 'Intercept their code!'
    case 'encryptor': return 'Your team is decoding'
    case 'listener': return 'Just listen this round'
    default: return 'Teams are decoding'
  }
}

function OnAir(p: PanelProps) {
  const v = p.view
  const tx = v.transmission!
  const clues = v.myClues ?? []
  const next = tx.clues.length
  const nextClue = clues[next] ?? '…'
  const nextDigit = v.myCode?.[next]
  return (
    <Card color={p.myColor} className="flex flex-col items-center gap-3 text-center">
      <span className="animate-pulse-soft rounded-full border-3 border-ink bg-tomato px-3 py-1 font-chunky text-sm text-white shadow-hard-sm">● ON AIR</span>
      <h2 className="text-2xl leading-tight">Read clue {next + 1} out loud</h2>
      <div className="w-full rotate-1 rounded-2xl border-3 border-ink bg-white px-3 py-4 shadow-hard">
        <p className="break-words font-display text-3xl font-extrabold leading-tight" data-testid="onair-clue">“{nextClue}”</p>
        {nextDigit && <p className="mt-1 text-xs text-ink-soft">(that's your {nextDigit}: {v.myKeywords?.[nextDigit - 1]})</p>}
      </div>
      <Button size="xl" block color="sun" icon="🎙️" onClick={() => p.send('clue:reveal', { turn: v.turn, index: next })}>
        I said it, show everyone
      </Button>
      <p className="text-xs">Say it clearly, once. Then tap. Everyone sees it pop up.</p>
      <div className="flex w-full flex-col gap-1">
        {tx.clues.map((c, i) => (
          <div key={i} className="rounded-lg border-2 border-ink bg-white/70 px-2 py-1 text-left text-sm font-semibold">✅ {c}</div>
        ))}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- reveal

function RevealPanel(p: PanelProps) {
  const v = p.view
  const r = v.reveal
  if (!r) return null
  const txTeam = p.team(r.teamId)
  const rivalId = v.teams.find((t) => t.id !== r.teamId)?.id
  const rivalTeam = rivalId ? p.team(rivalId) : undefined
  const color: TeamColor = txTeam?.color ?? 'sky'
  const mine = r.teamId === v.myTeamId
  const stamp = r.intercepted ? { text: 'WIRETAPPED!', bg: 'bg-tomato', emoji: '🎧' } : r.decoded === false ? { text: 'STATIC!', bg: 'bg-grape', emoji: '📵' } : { text: 'DECODED', bg: 'bg-lime', emoji: '✅' }

  return (
    <Card color={color} soft className={cn('relative flex flex-col gap-3 overflow-hidden', (r.intercepted || r.decoded === false) && 'animate-shake')}>
      <p className="font-display text-xs font-extrabold uppercase tracking-widest text-ink/60">{txTeam?.emoji} {txTeam?.name} · {name(p, r.encryptorId)}'s code was</p>
      <div className="flex justify-center"><CodeChips code={r.code} color={color} flip /></div>
      <ol className="flex flex-col gap-1">
        {r.clues.map((c, i) => (
          <li key={i} className="flex items-center gap-2 rounded-xl border-2 border-ink bg-white px-2 py-1.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg border-2 border-ink bg-sun font-chunky text-sm">{r.code[i]}</span>
            <span className="min-w-0 flex-1 break-words font-display font-extrabold">{c}</span>
            {mine && v.myKeywords && <span className="shrink-0 text-xs text-ink-soft">→ {v.myKeywords[r.code[i]! - 1]}</span>}
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-1 gap-1.5 text-sm">
        <GuessLine kind="Decode" team={txTeam?.name ?? 'Team'} guess={r.decodeGuess} code={r.code} ok={r.decoded} absent="nobody left to decode" />
        <GuessLine kind="Intercept" team={rivalTeam?.name ?? 'Rivals'} guess={r.interceptGuess} code={r.code} ok={r.intercepted} absent="closed in round 1" interception />
      </div>
      <div
        className={cn('mx-auto -rotate-6 animate-pop whitespace-nowrap rounded-2xl border-4 border-ink px-4 py-2 font-chunky text-lg shadow-hard-lg min-[380px]:text-xl', stamp.bg)}
        style={{ animationDelay: '500ms' }}
        data-testid="stamp"
      >
        {stamp.emoji} {stamp.text}
      </div>
      {v.isHost && (
        <Button variant="secondary" size="sm" className="self-end" onClick={() => p.send('reveal:next', { turn: v.turn })}>
          Next ▶
        </Button>
      )}
    </Card>
  )
}

function GuessLine({ kind, team, guess, code, ok, absent, interception }: { kind: string; team: string; guess: Digit[] | null; code: Digit[]; ok: boolean | null; absent: string; interception?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border-2 border-ink bg-white px-2 py-1.5">
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="font-display text-[10px] font-extrabold uppercase tracking-widest text-ink/50">{kind}</span>
        <span className="truncate font-semibold">{team}</span>
      </span>
      {ok === null ? (
        <span className="text-xs text-ink-soft">{absent}</span>
      ) : (
        <>
          {guess ? <CodeChips code={guess} size="sm" colors={guess.map((d, i) => (d === code[i] ? 'lime' : 'tomato'))} /> : <span className="text-xs text-ink-soft">no guess</span>}
          <span className="text-xl" aria-label={ok ? 'right' : 'wrong'}>{ok ? (interception ? '🎧' : '✅') : '❌'}</span>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- tiebreak

function TiebreakPanel(p: PanelProps) {
  const v = p.view
  const tb = v.tiebreak!
  const [words, setWords] = useState<string[]>(() =>
    tb.myDraft && tb.myDraft.some(Boolean) ? tb.myDraft : (v.notes ?? ['', '', '', '']),
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftKey = tb.myDraft?.join('|') ?? ''
  const typing = useRef(false)
  useEffect(() => {
    if (!typing.current && tb.myDraft && tb.myDraft.some(Boolean)) setWords(tb.myDraft)
  }, [draftKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (i: number, text: string) => {
    const next = words.map((w, k) => (k === i ? text : w))
    setWords(next)
    typing.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      typing.current = false
      p.send('tiebreak:set', { turn: v.turn, words: next })
    }, 400)
  }
  const rival = v.teams.find((t) => t.id === v.rivalTeamId)
  const hints = rival ? columnsOf(rival.history).map((col) => col.map((c) => c.clue)) : []
  if (!v.myTeamId) return <Card className="text-center"><h2 className="text-2xl">Sudden death! Teams are naming each other's words.</h2></Card>
  return (
    <Card color="sun" soft className="flex flex-col gap-3">
      <div className="text-center">
        <div className="text-4xl" aria-hidden>⚔️</div>
        <h2 className="text-2xl leading-tight">Dead even. Name their words!</h2>
        <p className="text-sm">The team that names more of the rival's four secret words wins. Close spelling counts.</p>
      </div>
      {[0, 1, 2, 3].map((i) => (
        <Input
          key={i}
          label={`Their word ${i + 1}`}
          hint={hints[i]?.length ? `Clues: ${hints[i]!.join(' · ')}` : 'No clues for this one. Wild guess!'}
          value={words[i] ?? ''}
          maxLength={30}
          disabled={tb.myLocked}
          autoComplete="off"
          data-testid={`tb-${i}`}
          onChange={(e) => update(i, e.target.value)}
        />
      ))}
      {tb.myLocked ? (
        <div className="rounded-2xl border-3 border-ink bg-ink px-3 py-3 text-center font-display font-extrabold text-paper">🔒 Locked. Waiting for the other team…</div>
      ) : (
        <Button size="lg" block color={p.myColor} onClick={() => p.send('tiebreak:lock', { turn: v.turn, words })}>Lock our answers</Button>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- over

function OverPanel(p: PanelProps) {
  const v = p.view
  const o = v.outcome
  if (!o) return null
  const winner = o.winner ? p.team(o.winner) : undefined
  const won = o.winner && o.winner === v.myTeamId
  return (
    <div className="flex flex-col gap-3">
      <Card color={winner?.color ?? 'sun'} tilt="left" shadow="lg" className="text-center">
        <div className="text-5xl" aria-hidden>{winner ? (won ? '🏆' : '🎧') : '🤝'}</div>
        <h2 className="text-3xl leading-tight">{winner ? `${winner.emoji} ${winner.name} win!` : "It's a draw!"}</h2>
        <p className="mt-1 font-semibold">{o.reason}</p>
      </Card>
      {v.teams.map((t) => {
        const ti = p.team(t.id)
        const tb = o.tiebreak?.find((x) => x.teamId !== t.id)
        return (
          <Card key={t.id} padding="sm" className="flex flex-col gap-2">
            <p className="font-display font-extrabold">{ti?.emoji} {possessive(ti?.name ?? 'Team')} secret words</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(o.keywords[t.id] ?? []).map((w, i) => (
                <div key={i} className={cn('flex items-center gap-1.5 rounded-xl border-2 border-ink px-2 py-1.5 font-display font-extrabold', ti ? COLOR[ti.color].soft : 'bg-white')}>
                  <span className="font-chunky text-xs">{i + 1}</span>
                  <span className="min-w-0 truncate">{w}</span>
                  {tb && <span className="ml-auto text-sm" title={tb.guesses[i]}>{tb.correct[i] ? '✅' : '❌'}</span>}
                </div>
              ))}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function possessive(n: string): string {
  return n.endsWith('s') ? `${n}'` : `${n}'s`
}

export const overheardWeb: WebGame = {
  id: 'overheard',
  Screen,
}
