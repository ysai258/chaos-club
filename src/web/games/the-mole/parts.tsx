import { useState, type ReactNode } from 'react'
import type { PlayerId, PlayerInfo, TeamInfo } from '../../../shared/protocol.ts'
import type { Evidence, Fact, InputSpec, PlayView, RoleView } from '../../../games/the-mole/shared.ts'
import { Avatar, Badge, Button, Card, Input, cn, COLOR, haptic } from '../../ui/index.ts'

export type Lookup = (id: PlayerId) => PlayerInfo | undefined
export type TeamLookup = (id: string) => TeamInfo | undefined

/** Small avatar + name sticker. */
export function Who({ id, player, team, size = 'xs', bold = true }: { id: PlayerId; player: Lookup; team: TeamLookup; size?: 'xs' | 'sm'; bold?: boolean }) {
  const p = player(id)
  const t = p?.teamId ? team(p.teamId) : undefined
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle">
      <Avatar emoji={p?.avatar ?? '❔'} color={t?.color} size={size} connected={p?.connected ?? true} />
      <span className={cn('min-w-0 truncate', bold && 'font-bold')}>{p?.name ?? 'Someone'}</span>
    </span>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="font-display text-sm font-extrabold uppercase tracking-wide text-ink-soft">{children}</h3>
      {right}
    </div>
  )
}

export function FactRows({ facts, player, team }: { facts: Fact[]; player: Lookup; team: TeamLookup }) {
  if (!facts.length) return null
  return (
    <dl className="grid gap-1.5">
      {facts.map((f, i) => (
        <div key={i} className="flex min-w-0 items-baseline justify-between gap-3">
          <dt className="shrink-0 text-sm font-bold text-ink-soft">{f.label}</dt>
          <dd className={cn(
            'min-w-0 text-right font-display font-extrabold break-words',
            f.tone === 'good' && 'text-[#2f7a12]',
            f.tone === 'bad' && 'text-tomato',
          )}>
            {f.playerId ? <Who id={f.playerId} player={player} team={team} /> : null}
            {f.playerId && f.value ? ' ' : null}
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** The private stuff only this phone sees. */
export function IntelCard({ intel, player, team }: { intel: Fact[]; player: Lookup; team: TeamLookup }) {
  const mine = intel.filter((f) => f.tone !== 'mole')
  const insider = intel.filter((f) => f.tone === 'mole')
  return (
    <>
      {mine.length > 0 && (
        <Card color="sun" soft tilt="right" padding="sm" data-testid="mole-intel">
          <SectionTitle right={<span className="text-xs font-bold text-ink-soft">🔒 only you</span>}>Your intel</SectionTitle>
          <div className="grid gap-2">
            {mine.map((f, i) => (
              <div key={i}>
                <div className="text-xs font-bold text-ink-soft">{f.label}</div>
                <div className="font-display text-2xl font-black leading-tight break-words">{f.value}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {insider.length > 0 && (
        <Card color="ink" padding="sm" data-testid="mole-insider">
          <SectionTitle right={<span className="text-xs">🐀</span>}><span className="text-sun">Insider info</span></SectionTitle>
          <div className="grid gap-1.5">
            {insider.map((f, i) => f.playerId ? (
              <div key={i} className="flex min-w-0 items-center justify-between gap-2 text-paper">
                <span className="min-w-0 text-paper"><Who id={f.playerId} player={player} team={team} /></span>
                <span className="font-display text-lg font-black text-sun">{f.value}</span>
              </div>
            ) : (
              <div key={i} className="font-display text-xl font-black leading-tight text-sun break-words">{f.value}</div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}

export function ObjectiveCard({ text }: { text: string }) {
  return (
    <div className="relative rounded-3xl border-3 border-ink bg-ink p-4 text-paper shadow-hard -rotate-1" data-testid="mole-objective">
      <div className="mb-1 flex items-center gap-2 font-display text-sm font-extrabold uppercase tracking-wide text-bubblegum">
        <span className="text-xl">🐀</span> Secret mission
      </div>
      <p className="font-display text-lg font-bold leading-snug">{text}</p>
    </div>
  )
}

export function RoleBanner({ role, team, onCaseFile, round, total, caseCount }: {
  role: RoleView; team: TeamLookup; onCaseFile: () => void; round: number; total: number; caseCount: number
}) {
  const employer = role.kind === 'mole' || role.kind === 'turned' ? team(role.employerTeamId) : undefined
  const [hidden, setHidden] = useState(false)
  const body = (() => {
    if (hidden) return <span className="font-display font-extrabold">🙈 Role hidden</span>
    switch (role.kind) {
      case 'mole':
        return (
          <span className="min-w-0 leading-tight">
            <span className="block font-display text-lg font-black text-bubblegum">🐀 You are the MOLE</span>
            <span className="block text-sm text-paper/85">
              Secretly working for <b className="text-sun">{employer?.emoji} {employer?.name ?? 'a rival'}</b>
              {role.hits > 0 && <> · {role.hits} sabotage{role.hits === 1 ? '' : 's'} landed</>}
            </span>
          </span>
        )
      case 'turned':
        return (
          <span className="min-w-0 leading-tight">
            <span className="block font-display text-lg font-black">💥 Cover blown</span>
            <span className="block text-sm">No more missions. Play straight with your team now.</span>
          </span>
        )
      case 'spectator':
        return <span className="font-display font-extrabold">👀 Watching — you'll play next game</span>
      default:
        return (
          <span className="min-w-0 leading-tight">
            <span className="block font-display text-lg font-black">🕵️ You are LOYAL</span>
            <span className="block text-sm text-ink-soft">One of your teammates probably isn't.</span>
          </span>
        )
    }
  })()
  const dark = role.kind === 'mole' && !hidden
  return (
    <div className="flex items-stretch gap-2">
      <button
        type="button"
        onClick={() => { haptic('tap'); setHidden(!hidden) }}
        aria-label={hidden ? 'Show my role' : 'Hide my role'}
        data-testid="mole-role"
        data-role={role.kind}
        className={cn(
          'flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-2xl border-3 border-ink px-3 py-2 text-left shadow-hard-sm',
          dark ? 'bg-ink text-paper' : role.kind === 'turned' ? 'bg-tomato-soft' : 'bg-white',
        )}
      >
        {body}
      </button>
      <button
        type="button"
        onClick={() => { haptic('tap'); onCaseFile() }}
        data-testid="mole-casefile-button"
        className="relative grid min-h-14 w-16 shrink-0 place-items-center rounded-2xl border-3 border-ink bg-sky-soft px-1 shadow-hard-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
      >
        <span className="text-xl leading-none">🗂️</span>
        <span className="font-display text-[11px] font-extrabold leading-none">{round}/{total}</span>
        {caseCount > 0 && <span className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full border-2 border-ink bg-sun text-xs font-black">{caseCount}</span>}
      </button>
    </div>
  )
}

export function EvidenceCard({ ev, player, team, compact }: { ev: Evidence; player: Lookup; team: TeamLookup; compact?: boolean }) {
  return (
    <div className="grid gap-3" data-testid="mole-evidence">
      {!compact && <FactRows facts={ev.facts} player={player} team={team} />}
      {compact && ev.facts.length > 0 && <FactRows facts={ev.facts} player={player} team={team} />}
      {ev.anon.map((a, i) => (
        <div key={i}>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft">🎲 {a.title}</div>
          <div className="flex flex-wrap gap-1.5">
            {a.items.length === 0 && <span className="text-sm text-ink-soft">nothing</span>}
            {a.items.map((it, j) => (
              <span key={j} className="rounded-xl border-2 border-ink bg-paper px-2.5 py-1 font-display text-sm font-extrabold shadow-hard-sm">{it}</span>
            ))}
          </div>
        </div>
      ))}
      {ev.named && (
        <div>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft">🔎 {ev.named.title}</div>
          <ul className="grid gap-1.5">
            {ev.named.rows.map((r, j) => (
              <li key={j} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border-2 border-ink bg-white px-2 py-1.5">
                <span className="min-w-0 text-sm"><Who id={r.playerId} player={player} team={team} /></span>
                <span className="shrink-0 text-right font-display text-sm font-extrabold">{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ---------- inputs ----------

export function InputPanel({ spec, onSubmit, color, player, team }: {
  spec: InputSpec; onSubmit: (value: unknown) => void; color: 'sun' | 'lime'; player: Lookup; team: TeamLookup
}) {
  switch (spec.type) {
    case 'number': return spec.big ? <BigNumberInput spec={spec} onSubmit={onSubmit} /> : <NumberPad spec={spec} onSubmit={onSubmit} />
    case 'choice': return <ChoiceInput spec={spec} onSubmit={onSubmit} color={color} />
    case 'multi': return <MultiInput spec={spec} onSubmit={onSubmit} player={player} team={team} />
    case 'text': return <TextInput spec={spec} onSubmit={onSubmit} />
    case 'digits': return <DigitsInput spec={spec} onSubmit={onSubmit} />
  }
}

function LockButton({ disabled, onClick, children = 'Lock it in' }: { disabled: boolean; onClick: () => void; children?: ReactNode }) {
  return <Button size="lg" block variant="dark" icon="🔒" disabled={disabled} onClick={onClick} data-testid="mole-lock">{children}</Button>
}

function NumberPad({ spec, onSubmit }: { spec: Extract<InputSpec, { type: 'number' }>; onSubmit: (v: unknown) => void }) {
  const [v, setV] = useState<number | null>(null)
  const nums = Array.from({ length: spec.max - spec.min + 1 }, (_, i) => spec.min + i)
  const cols = nums.length <= 6 ? 'grid-cols-3' : nums.length <= 8 ? 'grid-cols-4' : 'grid-cols-5'
  return (
    <div className="grid gap-3">
      <div className="font-display font-extrabold">{spec.label}</div>
      <div className={cn('grid gap-2', cols)}>
        {nums.map((n) => (
          <button
            key={n}
            type="button"
            data-testid={`mole-num-${n}`}
            onClick={() => { haptic('tap'); setV(n) }}
            className={cn(
              'min-h-14 rounded-2xl border-3 border-ink font-display text-2xl font-black transition-transform',
              v === n ? 'bg-sun -translate-y-0.5 shadow-hard animate-pop' : 'bg-white shadow-hard-sm',
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <LockButton disabled={v === null} onClick={() => v !== null && onSubmit(v)}>{v === null ? 'Pick a number' : `Lock in ${v}`}</LockButton>
    </div>
  )
}

function BigNumberInput({ spec, onSubmit }: { spec: Extract<InputSpec, { type: 'number' }>; onSubmit: (v: unknown) => void }) {
  const [raw, setRaw] = useState('')
  const n = Number(raw.replace(/[^0-9]/g, ''))
  const ok = raw.trim() !== '' && Number.isInteger(n) && n >= spec.min && n <= spec.max
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(n) }}>
      <Input
        label={spec.label}
        inputMode="numeric"
        enterKeyHint="send"
        autoComplete="off"
        value={raw}
        onChange={(e) => setRaw(e.target.value.replace(/[^0-9,]/g, '').slice(0, 10))}
        placeholder="e.g. 1500"
        data-testid="mole-number-input"
      />
      <LockButton disabled={!ok} onClick={() => ok && onSubmit(n)}>{ok ? `Lock in ${n.toLocaleString('en-IN')}` : 'Type a number'}</LockButton>
    </form>
  )
}

function ChoiceInput({ spec, onSubmit, color }: { spec: Extract<InputSpec, { type: 'choice' }>; onSubmit: (v: unknown) => void; color: 'sun' | 'lime' }) {
  const [v, setV] = useState<string | null>(null)
  const cols = spec.columns === 3 ? 'grid-cols-3' : spec.columns === 1 ? 'grid-cols-1' : 'grid-cols-2'
  const picked = spec.options.find((o) => o.value === v)
  return (
    <div className="grid gap-3">
      <div className="font-display font-extrabold">{spec.label}</div>
      <div className={cn('grid gap-2', cols)}>
        {spec.options.map((o) => (
          <button
            key={o.value}
            type="button"
            data-testid={`mole-choice-${o.value}`}
            onClick={() => { haptic('tap'); setV(o.value) }}
            className={cn(
              'min-h-12 rounded-2xl border-3 border-ink px-2 py-2 font-display text-[15px] font-extrabold leading-tight break-words transition-transform',
              v === o.value ? `${COLOR[color].bg} -translate-y-0.5 shadow-hard animate-pop` : 'bg-white shadow-hard-sm',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <LockButton disabled={v === null} onClick={() => v !== null && onSubmit(v)}>{picked ? `Lock in: ${picked.label}` : 'Pick one'}</LockButton>
    </div>
  )
}

function MultiInput({ spec, onSubmit, player, team }: { spec: Extract<InputSpec, { type: 'multi' }>; onSubmit: (v: unknown) => void; player: Lookup; team: TeamLookup }) {
  const [sel, setSel] = useState<string[]>([])
  const toggle = (v: string) => {
    haptic('tap')
    setSel((s) => (s.includes(v) ? s.filter((x) => x !== v) : s.length >= spec.count ? [...s.slice(1), v] : [...s, v]))
  }
  return (
    <div className="grid gap-3">
      <div className="font-display font-extrabold">{spec.label} <span className="text-ink-soft">({sel.length}/{spec.count})</span></div>
      <div className="grid grid-cols-2 gap-2">
        {spec.options.map((o) => (
          <button
            key={o.value}
            type="button"
            data-testid={`mole-pick-${o.value}`}
            aria-pressed={sel.includes(o.value)}
            onClick={() => toggle(o.value)}
            className={cn(
              'flex min-h-14 min-w-0 items-center gap-2 rounded-2xl border-3 border-ink px-2 text-left transition-transform',
              sel.includes(o.value) ? 'bg-lime -translate-y-0.5 shadow-hard' : 'bg-white shadow-hard-sm',
            )}
          >
            {o.playerId ? <Who id={o.playerId} player={player} team={team} size="sm" /> : <span className="font-bold">{o.label}</span>}
            {sel.includes(o.value) && <span className="ml-auto shrink-0">✅</span>}
          </button>
        ))}
      </div>
      <LockButton disabled={sel.length !== spec.count} onClick={() => onSubmit(sel)}>Send the crew</LockButton>
    </div>
  )
}

function TextInput({ spec, onSubmit }: { spec: Extract<InputSpec, { type: 'text' }>; onSubmit: (v: unknown) => void }) {
  const [v, setV] = useState('')
  const ok = v.trim().length > 0
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(v.trim()) }}>
      <Input label={spec.label} value={v} maxLength={spec.maxLength} placeholder={spec.placeholder} autoComplete="off" enterKeyHint="send" onChange={(e) => setV(e.target.value)} data-testid="mole-text-input" />
      <LockButton disabled={!ok} onClick={() => ok && onSubmit(v.trim())}>Send clue</LockButton>
    </form>
  )
}

function DigitsInput({ spec, onSubmit }: { spec: Extract<InputSpec, { type: 'digits' }>; onSubmit: (v: unknown) => void }) {
  const [v, setV] = useState('')
  const press = (k: string) => {
    haptic('tap')
    if (k === '⌫') setV((s) => s.slice(0, -1))
    else setV((s) => (s.length < spec.length ? s + k : s))
  }
  return (
    <div className="grid gap-3">
      <div className="font-display font-extrabold">{spec.label}</div>
      <div className="flex justify-center gap-2" data-testid="mole-digits">
        {Array.from({ length: spec.length }, (_, i) => (
          <span key={i} className={cn('grid h-16 w-14 place-items-center rounded-2xl border-3 border-ink font-chunky text-3xl', v[i] ? 'bg-sun shadow-hard-sm' : 'bg-white')}>{v[i] ?? ''}</span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0'].map((k) => (
          <button key={k} type="button" data-testid={`mole-key-${k}`} onClick={() => press(k)} className="min-h-13 rounded-2xl border-3 border-ink bg-white font-display text-2xl font-black shadow-hard-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
            {k}
          </button>
        ))}
      </div>
      <LockButton disabled={v.length !== spec.length} onClick={() => onSubmit(v)}>{v.length === spec.length ? `Enter ${v}` : 'Type the code'}</LockButton>
    </div>
  )
}

/** Avatars of people we're still waiting on. */
export function WaitingRow({ ids, player, team, meId }: { ids: PlayerId[]; player: Lookup; team: TeamLookup; meId?: PlayerId }) {
  if (!ids.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink-soft" data-testid="mole-waiting">
      <span>Waiting on</span>
      {ids.map((id) => {
        const p = player(id)
        const t = p?.teamId ? team(p.teamId) : undefined
        return <span key={id} className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-white py-0.5 pr-2 pl-0.5"><Avatar emoji={p?.avatar ?? '❔'} color={t?.color} size="xs" connected={p?.connected ?? true} /><span className="max-w-24 truncate text-ink">{id === meId ? 'you' : p?.name}</span></span>
      })}
    </div>
  )
}

export function BoardCard({ board, player, team }: { board: NonNullable<PlayView['board']>; player: Lookup; team: TeamLookup }) {
  return (
    <Card padding="sm" tilt="left" data-testid="mole-board">
      <SectionTitle>{board.title}</SectionTitle>
      {board.items.length === 0 ? <p className="text-sm text-ink-soft">Empty board…</p> : (
        <div className="flex flex-wrap gap-2">
          {board.items.map((it, i) => (
            <span key={i} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-xl border-2 border-ink bg-paper px-2 py-1 font-display font-extrabold shadow-hard-sm">
              {it.by && <Who id={it.by} player={player} team={team} bold={false} />}
              {it.text && <span className="break-words">{it.by ? `: ${it.text}` : it.text}</span>}
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}

export function PointsBadge({ points }: { points: number }) {
  return <Badge color={points > 0 ? 'lime' : points < 0 ? 'tomato' : 'white'} size="md">{points > 0 ? `+${points}` : points} pts</Badge>
}
