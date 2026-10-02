/** Building blocks for the Overheard screen: token tracker, intel sheet, code chips, guess picker. */
import { useEffect, useRef, useState } from 'react'
import type { TeamInfo } from '../../../shared/protocol.ts'
import type { Digit, GuessDraft, HistoryRow, TeamPublic } from '../../../games/overheard/shared.ts'
import { Badge, Button, COLOR, cn, haptic } from '../../ui/index.ts'

export const DIGITS: Digit[] = [1, 2, 3, 4]

// ---------------------------------------------------------------- tokens

function Pips({ n, kind }: { n: number; kind: 'tap' | 'static' }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${n} ${kind === 'tap' ? 'wiretaps' : 'static'}`}>
      <span aria-hidden className="text-sm leading-none">{kind === 'tap' ? '🎧' : '📵'}</span>
      {[0, 1].map((i) => (
        <span
          key={i}
          className={cn(
            'size-3 rounded-full border-2 border-ink',
            i < n ? (kind === 'tap' ? 'bg-lime' : 'bg-tomato') : 'bg-white',
            i < n && 'animate-pop',
          )}
        />
      ))}
    </span>
  )
}

/** Both teams' wiretap/static tokens, side by side. */
export function TokenBar({ teams, info, myTeamId }: { teams: TeamPublic[]; info: (id: string) => TeamInfo | undefined; myTeamId: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {teams.map((t) => {
        const ti = info(t.id)
        const color = ti?.color ?? 'sky'
        return (
          <div
            key={t.id}
            className={cn('flex min-w-0 flex-col gap-1 rounded-2xl border-3 border-ink px-2.5 py-1.5 shadow-hard-sm', COLOR[color].soft)}
          >
            <div className="flex min-w-0 items-center gap-1 font-display text-sm font-extrabold">
              <span aria-hidden>{ti?.emoji}</span>
              <span className="truncate">{ti?.name ?? 'Team'}</span>
              {t.id === myTeamId && <span className="ml-auto shrink-0 rounded-full bg-ink px-1.5 text-[10px] text-paper">YOU</span>}
            </div>
            <div className="flex items-center gap-2.5">
              <Pips n={t.wiretaps} kind="tap" />
              <Pips n={t.static} kind="static" />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- code chips

export function CodeChips({ code, color = 'sun', size = 'lg', flip, colors }: { code: (Digit | null)[]; color?: TeamInfo['color']; size?: 'sm' | 'lg'; flip?: boolean; colors?: TeamInfo['color'][] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {code.map((d, i) => (
        <span
          key={`${i}-${d}`}
          style={flip ? { animationDelay: `${i * 160}ms` } : undefined}
          className={cn(
            'grid place-items-center rounded-xl border-3 border-ink font-chunky leading-none shadow-hard-sm',
            size === 'lg' ? 'size-14 text-3xl' : 'size-8 text-base',
            d === null ? 'bg-white text-ink/30' : COLOR[colors?.[i] ?? color].bg,
            flip && 'animate-pop',
            i % 2 === 0 ? '-rotate-3' : 'rotate-2',
          )}
        >
          {d ?? '?'}
        </span>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------- intel sheet

/** Clues grouped by the keyword number they pointed at. */
export function columnsOf(history: HistoryRow[]): { clue: string; round: number }[][] {
  const cols: { clue: string; round: number }[][] = [[], [], [], []]
  for (const row of history) {
    row.code.forEach((d, i) => {
      const clue = row.clues[i]
      if (clue !== undefined) cols[d - 1]!.push({ clue, round: row.round })
    })
  }
  return cols
}

/**
 * Four columns, one per keyword number, with every clue ever given for it.
 * Own team: the header is the keyword. Rival: the header is the team's shared note.
 */
export function IntelSheet({
  history, keywords, notes, onNote, color, empty,
}: {
  history: HistoryRow[]
  keywords: string[] | null
  notes: string[] | null
  onNote?: (i: number, text: string) => void
  color: TeamInfo['color']
  empty: string
}) {
  const cols = columnsOf(history)
  const total = cols.reduce((n, c) => n + c.length, 0)
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-1.5">
        {cols.map((col, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-1.5">
            <div className={cn('flex min-w-0 flex-col items-center gap-1 rounded-xl border-3 border-ink px-1 py-1.5 shadow-hard-sm', COLOR[color].bg)}>
              <span className="grid size-6 place-items-center rounded-full border-2 border-ink bg-white font-chunky text-xs">{i + 1}</span>
              {keywords ? (
                <span
                  lang="en"
                  className={cn('w-full hyphens-auto text-center font-display font-extrabold leading-tight [overflow-wrap:anywhere]', fit(keywords[i] ?? ''))}
                  data-testid={`kw-${i + 1}`}
                >
                  {keywords[i]}
                </span>
              ) : notes && onNote ? (
                <NoteInput value={notes[i] ?? ''} onCommit={(t) => onNote(i, t)} label={`Our guess for their word ${i + 1}`} />
              ) : (
                <span className="font-display text-[13px] font-extrabold text-ink/50">???</span>
              )}
            </div>
            <ul className="flex min-h-10 flex-col gap-2 pt-1">
              {col.map((c, k) => (
                <li
                  key={k}
                  lang="en"
                  className={cn('relative min-w-0 hyphens-auto rounded-lg border-2 border-ink bg-white px-1 pt-1.5 pb-1 text-center font-semibold leading-tight [overflow-wrap:anywhere]', clueFit(c.clue))}
                >
                  <span className="absolute -top-2 -left-1 rounded-full border-2 border-ink bg-paper px-1 text-[9px] leading-none font-bold" aria-label={`round ${c.round}`}>
                    {c.round}
                  </span>
                  {c.clue}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {total === 0 && <p className="text-center text-sm text-ink-soft">{empty}</p>}
    </div>
  )
}

/** Font size that keeps a keyword inside a quarter of a 360px screen. */
function fit(word: string): string {
  const longest = Math.max(...word.split(/[\s-]/).map((w) => w.length))
  return longest > 10 ? 'text-[10px]' : longest > 8 ? 'text-[11px]' : longest > 6 ? 'text-xs' : 'text-[13px]'
}

function clueFit(clue: string): string {
  const longest = Math.max(...clue.split(/\s/).map((w) => w.length))
  return longest > 8 ? 'text-[10px]' : longest > 6 ? 'text-[11px]' : 'text-xs'
}

/** Two big equal tabs. */
export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; color: TeamInfo['color'] }[] }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-2xl border-3 border-ink bg-paper-deep p-1" role="tablist">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => !on && (haptic('tap'), onChange(o.value))}
            className={cn(
              'min-h-11 rounded-xl px-2 font-display text-sm font-extrabold transition-transform',
              on ? cn(COLOR[o.color].bg, 'border-2 border-ink shadow-hard-sm') : 'text-ink/60',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function NoteInput({ value, onCommit, label }: { value: string; onCommit: (t: string) => void; label: string }) {
  const [text, setText] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value)
  }, [value])
  return (
    <input
      aria-label={label}
      value={text}
      maxLength={40}
      placeholder="guess?"
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        if (text.trim() !== value) onCommit(text)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onChange={(e) => setText(e.target.value)}
      className="h-8 w-full min-w-0 rounded-lg border-2 border-ink bg-white px-1 text-center font-display !text-base font-bold leading-none placeholder:font-normal placeholder:text-ink/35 focus:outline-none"
    />
  )
}

// ---------------------------------------------------------------- guess picker

export function GuessPicker({
  clues, guess, labels, color, onChange, onLock, disabled, who, meId,
}: {
  meId: string
  clues: string[]
  guess: GuessDraft
  /** Small label under each digit (keyword or note). */
  labels: string[]
  color: TeamInfo['color']
  onChange: (slots: (Digit | null)[]) => void
  onLock: (slots: Digit[]) => void
  disabled?: boolean
  who: (id: string | null) => string
}) {
  const [slots, setSlots] = useState(guess.slots)
  const [confirm, setConfirm] = useState(false)
  const key = `${guess.slots.join(',')}|${guess.editedBy}|${guess.locked}`
  // My own taps win for a moment: echoes of my earlier taps must not undo newer ones.
  const lastLocal = useRef(0)
  useEffect(() => {
    if (!guess.locked && guess.editedBy === meId && Date.now() - lastLocal.current < 2000) return
    setSlots(guess.slots)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => setConfirm(false), 3000)
    return () => clearTimeout(t)
  }, [confirm])

  const locked = guess.locked
  const complete = slots.every((d) => d !== null) && new Set(slots).size === 3

  const pick = (row: number, d: Digit) => {
    if (locked || disabled) return
    haptic('tap')
    const next = slots.map((s, i) => (i === row ? (s === d ? null : d) : s === d ? null : s))
    lastLocal.current = Date.now()
    setSlots(next)
    setConfirm(false)
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-2.5">
      {clues.map((clue, row) => (
        <div key={row} className="rounded-2xl border-3 border-ink bg-white p-2 shadow-hard-sm">
          <div className="mb-1.5 flex items-baseline gap-2 px-1">
            <span className="font-chunky text-xs text-ink/40">#{row + 1}</span>
            <span className="min-w-0 flex-1 break-words font-display text-lg font-extrabold leading-tight">“{clue}”</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={`Number for clue ${row + 1}`}>
            {DIGITS.map((d) => {
              const on = slots[row] === d
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`Clue ${row + 1} is ${d}`}
                  disabled={locked || disabled}
                  onClick={() => pick(row, d)}
                  className={cn(
                    'flex min-h-12 min-w-0 flex-col items-center justify-center rounded-xl border-3 border-ink px-0.5 py-1 transition-transform duration-100',
                    on ? cn(COLOR[color].bg, 'translate-x-0.5 translate-y-0.5 shadow-none') : 'bg-paper shadow-hard-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none',
                    (locked || disabled) && !on && 'opacity-50',
                  )}
                >
                  <span className="font-chunky text-lg leading-none">{d}</span>
                  {labels[d - 1] && <span className="mt-0.5 w-full truncate text-center text-[10px] font-bold leading-tight text-ink/70">{labels[d - 1]}</span>}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {locked ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border-3 border-ink bg-ink px-3 py-3 font-display font-extrabold text-paper">
          🔒 Locked by {who(guess.lockedBy)}
        </div>
      ) : (
        <Button
          size="lg"
          block
          color={confirm ? 'tomato' : color}
          disabled={!complete || disabled}
          className={confirm ? 'animate-wiggle' : ''}
          onClick={() => {
            if (!complete) return
            if (!confirm) return setConfirm(true)
            setConfirm(false)
            onLock(slots as Digit[])
          }}
        >
          {!complete ? 'Pick a number for every clue' : confirm ? `Sure? Lock ${slots.join('-')} 🔒` : `Lock in ${slots.join('-')}`}
        </Button>
      )}
      {!locked && guess.editedBy && <p className="text-center text-xs text-ink-soft">Last change by {who(guess.editedBy)}. Anyone on your team can edit.</p>}
    </div>
  )
}

export function StatusPills({ items }: { items: { label: string; done: boolean; color: TeamInfo['color']; idle?: string; doneText?: string }[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {items.map((it, i) => (
        <Badge key={i} color={it.done ? it.color : 'white'} size="md">
          {it.done ? (it.doneText ?? '🔒') : (it.idle ?? '🤔')} {it.label}
        </Badge>
      ))}
    </div>
  )
}
