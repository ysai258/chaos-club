import { useEffect, useState, type ReactNode } from 'react'
import type { PlayerId, PlayerInfo, TeamInfo } from '../../../shared/protocol.ts'
import type { CardView, CourtRole, RecordEntry, Side, SpeechSlotView } from '../../../games/friend-court/shared.ts'
import { Avatar, Badge, cn, COLOR } from '../../ui/index.ts'

export type PlayerFn = (id: PlayerId) => PlayerInfo | undefined
export type TeamFn = (id: string) => TeamInfo | undefined

export const SIDE_META: Record<Side, { label: string; emoji: string; short: string }> = {
  prosecution: { label: 'Prosecution', emoji: '🔥', short: 'PROS' },
  defence: { label: 'Defence', emoji: '🛡️', short: 'DEF' },
}

export const ROLE_META: Record<CourtRole, { label: string; emoji: string; tip: string }> = {
  judge: { label: 'You are the Judge', emoji: '👩‍⚖️', tip: 'You sit this one out. Rule on objections, then deliver the verdict. Bribes accepted in chai only.' },
  prosecution: { label: 'You are the Prosecution', emoji: '🔥', tip: 'Prove they did it. Your cards are your “evidence” — make them fit.' },
  defence: { label: 'You are the Defence', emoji: '🛡️', tip: 'Your client is innocent (probably). Twist every card into an alibi.' },
  jury: { label: 'You are the Jury', emoji: '🪑', tip: 'Neutral and all-powerful. Listen, react, and vote at the end.' },
  watcher: { label: 'You are in the gallery', emoji: '🍿', tip: 'You joined mid-game — enjoy the show, you play from the next one.' },
}

/** Short display name, never empty. */
export function nm(player: PlayerFn, id: PlayerId | null | undefined): string {
  if (!id) return 'Nobody'
  return player(id)?.name ?? 'Someone'
}

export function Who({ id, player, team, size = 'sm', suffix }: { id: PlayerId | null; player: PlayerFn; team: TeamFn; size?: 'xs' | 'sm' | 'md'; suffix?: ReactNode }) {
  const p = id ? player(id) : undefined
  const t = p?.teamId ? team(p.teamId) : undefined
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar emoji={p?.avatar ?? '🤖'} color={t?.color} size={size} connected={p?.connected ?? true} />
      <span className="truncate font-bold">{p?.name ?? 'Robot Judge'}</span>
      {suffix}
    </span>
  )
}

/** An evidence card from your hand. */
export function EvidenceCard({ card, player, action, tilt = 0, dim }: { card: CardView; player: PlayerFn; action?: ReactNode; tilt?: number; dim?: boolean }) {
  const witness = card.kind === 'witness'
  return (
    <div
      data-testid="fc-card"
      className={cn(
        'relative flex flex-col rounded-2xl border-3 border-ink p-3 shadow-hard transition-transform',
        witness ? 'bg-bubblegum-soft' : 'bg-white',
        dim && 'opacity-60',
      )}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <div className="flex items-start gap-2">
        <span className="text-3xl leading-none" aria-hidden>{card.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-widest text-ink-soft">{witness ? 'Witness — do the voice' : 'Exhibit'}</div>
          <div className="font-display text-[15px] font-extrabold leading-snug">{card.text}</div>
        </div>
      </div>
      {card.fromId && (
        <div className="mt-1.5 self-start -rotate-2 rounded-md border-2 border-ink bg-sun px-1.5 py-0.5 text-[11px] font-black">
          📝 note from {nm(player, card.fromId)} — use it!
        </div>
      )}
      {action && <div className="mt-auto pt-2">{action}</div>}
    </div>
  )
}

/** The court record: exhibits played this case. */
export function Record({ record, player }: { record: RecordEntry[]; player: PlayerFn }) {
  if (record.length === 0) {
    return <p className="rounded-2xl border-3 border-dashed border-ink/30 p-3 text-center text-sm font-semibold text-ink-soft">No exhibits yet. The court is waiting for evidence…</p>
  }
  return (
    <ul className="flex flex-col gap-2">
      {record.map((e) => (
        <li
          key={e.letter}
          className={cn(
            'relative flex items-center gap-2.5 rounded-2xl border-3 border-ink p-2.5 shadow-hard-sm animate-pop',
            e.side === 'prosecution' ? 'bg-tomato-soft' : 'bg-sky-soft',
          )}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border-2 border-ink bg-white font-chunky text-sm">{e.letter}</span>
          <span className="text-2xl" aria-hidden>{e.emoji}</span>
          <div className={cn('min-w-0 flex-1', e.struck && 'pr-16')}>
            <div className={cn('font-display text-sm font-extrabold leading-tight', e.struck && 'line-through decoration-tomato decoration-[3px]')}>{e.text}</div>
            <div className="text-[11px] font-semibold text-ink-soft">
              {SIDE_META[e.side].emoji} {nm(player, e.byId)}
              {e.viaNoteFromId && ` · 📝 via ${nm(player, e.viaNoteFromId)}`}
            </div>
          </div>
          {e.struck && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 -rotate-12 rounded-md border-3 border-tomato bg-white/90 px-1.5 font-chunky text-[11px] text-tomato">STRUCK</span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** The running order of speeches with whoever gives each one. */
export function Docket({ speeches, player, team }: { speeches: SpeechSlotView[]; player: PlayerFn; team: TeamFn }) {
  return (
    <ol className="grid grid-cols-4 gap-1.5">
      {speeches.map((s, i) => {
        const p = s.speakerId ? player(s.speakerId) : undefined
        const t = p?.teamId ? team(p.teamId) : undefined
        return (
          <li
            key={i}
            className={cn(
              'flex min-w-0 flex-col items-center gap-0.5 rounded-xl border-2 border-ink px-1 py-1.5 text-center',
              s.status === 'live' ? `${s.side === 'prosecution' ? 'bg-tomato' : 'bg-sky'} -translate-y-0.5 shadow-hard-sm` : 'bg-white',
              (s.status === 'done' || s.status === 'skipped') && 'opacity-50',
            )}
            aria-current={s.status === 'live' ? 'step' : undefined}
          >
            <Avatar emoji={p?.avatar ?? '❔'} color={t?.color} size="xs" connected={p?.connected ?? true} />
            <span className="w-full truncate text-[10px] font-black">{p?.name ?? '—'}</span>
            <span className="text-[9px] font-bold uppercase leading-none text-ink/70">
              {SIDE_META[s.side].short} {s.kind.endsWith('open') ? 'open' : s.kind === 'd-close' ? 'last' : 'close'}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function SideChip({ side, team }: { side: Side; team: TeamInfo | undefined }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1 rounded-full border-2 border-ink px-2 py-1 text-xs font-black', team ? COLOR[team.color].bg : 'bg-white')}>
      <span aria-hidden>{SIDE_META[side].emoji}</span>
      <span className="truncate">{team?.name ?? SIDE_META[side].label}</span>
    </span>
  )
}

/** Ticking seconds badge for a frozen or running clock. */
export function FrozenClock({ ms }: { ms: number }) {
  return (
    <Badge color="white" size="md" className="tabular-nums">⏸ {Math.ceil(ms / 1000)}s</Badge>
  )
}

/** Big transient overlays: OBJECTION!, EXHIBIT B, ALL RISE. */
export interface Flash { id: number; kind: 'objection' | 'exhibit' | 'ruling' | 'allRise'; title: string; sub?: string; emoji?: string; good?: boolean }

export function FlashOverlay({ flash }: { flash: Flash | null }) {
  if (!flash) return null
  const bg = flash.kind === 'objection' ? 'bg-tomato' : flash.kind === 'exhibit' ? 'bg-sun' : flash.kind === 'allRise' ? 'bg-grape' : flash.good ? 'bg-lime' : 'bg-white'
  return (
    <div key={flash.id} className="pointer-events-none fixed inset-x-0 top-1/3 z-[80] flex justify-center px-4" aria-live="assertive">
      <div className={cn('max-w-sm -rotate-3 rounded-3xl border-4 border-ink px-5 py-4 text-center shadow-hard-xl', bg, flash.kind === 'objection' ? 'animate-shake' : 'animate-pop')}>
        {flash.emoji && <div className="text-5xl leading-none">{flash.emoji}</div>}
        <div className="font-chunky text-3xl leading-none text-white text-outline [text-shadow:3px_3px_0_var(--color-ink)]">{flash.title}</div>
        {flash.sub && <div className="mt-2 font-display text-base font-extrabold leading-snug">{flash.sub}</div>}
      </div>
    </div>
  )
}

/** Emojis floating up from the bottom when people react. */
export function Reactions({ items }: { items: { id: number; emoji: string; x: number; name: string }[] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] h-0" aria-hidden>
      <style>{`@keyframes fc-rise{0%{transform:translateY(0) scale(.6);opacity:0}15%{opacity:1;transform:translateY(-20px) scale(1.1)}100%{transform:translateY(-260px) scale(1);opacity:0}}`}</style>
      {items.map((r) => (
        <div key={r.id} className="absolute flex flex-col items-center" style={{ left: `${r.x}%`, animation: 'fc-rise 2.2s ease-out forwards' }}>
          <span className="text-4xl drop-shadow-[2px_2px_0_var(--color-ink)]">{r.emoji}</span>
          <span className="rounded-full border-2 border-ink bg-white px-1.5 text-[10px] font-black">{r.name}</span>
        </div>
      ))}
    </div>
  )
}

/** Remembers a value only for `ms` after it last changed. */
export function useTransient<T>(ms: number): [T | null, (v: T) => void] {
  const [v, setV] = useState<{ v: T; at: number } | null>(null)
  useEffect(() => {
    if (!v) return
    const id = setTimeout(() => setV(null), ms)
    return () => clearTimeout(id)
  }, [v, ms])
  return [v?.v ?? null, (next: T) => setV({ v: next, at: Date.now() })]
}
