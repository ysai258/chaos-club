/** Bomb casing pieces: the timer, strikes, serial/batteries/stickers, module chips, answer stickers. */
import { useEffect, useRef } from 'react'
import type { BombView, Edgework, ModuleView, Solution } from '../../../games/bomb-squad/shared.ts'
import { cn, playSound, useNow } from '../../ui/index.ts'
import { Glyph } from './glyphs.tsx'
import { MODULE_EMOJI, timerText } from './util.ts'

/** ms left on the fuse, as everyone should see it right now. */
export function useFuse(bomb: BombView | null): number {
  const now = useNow(100)
  if (!bomb) return 0
  if (bomb.timeLeftMs !== null) return bomb.timeLeftMs
  if (bomb.explodeAt === null) return bomb.fuseMs
  return Math.max(0, bomb.explodeAt - now)
}

export function TimerPanel({ bomb, ticking, size = 'lg' }: { bomb: BombView; ticking?: boolean; size?: 'lg' | 'sm' }) {
  const ms = useFuse(bomb)
  const text = timerText(ms)
  const live = bomb.explodeAt !== null && bomb.timeLeftMs === null
  const danger = live && ms < 15_000
  const last = useRef(text)
  useEffect(() => {
    if (ticking && live && text !== last.current && ms < 10_000) playSound('tick')
    last.current = text
  }, [text, ticking, live, ms])
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border-3 border-ink bg-ink px-3 shadow-hard', size === 'lg' ? 'py-2' : 'py-1.5')}>
      <div
        role="timer"
        aria-label={`${text} left`}
        data-testid="bomb-timer"
        className={cn(
          'min-w-0 flex-1 rounded-lg bg-[#2a0c08] px-2 text-center font-chunky tabular-nums tracking-wider text-[#ff5a36] [text-shadow:0_0_12px_#ff5a36]',
          size === 'lg' ? 'text-5xl leading-[1.15]' : 'text-3xl leading-tight',
          danger && 'animate-pulse-soft',
        )}
      >
        {text}
      </div>
      <Strikes n={bomb.strikes} max={bomb.maxStrikes} />
    </div>
  )
}

export function Strikes({ n, max }: { n: number; max: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5" aria-label={`${n} of ${max} strikes`} data-testid="strikes">
      <span className="font-display text-[10px] font-bold uppercase tracking-wider text-paper/70">strikes</span>
      <div className="flex gap-1">
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={cn('grid size-6 place-items-center rounded-md border-2 font-black leading-none', i < n ? 'border-tomato bg-tomato text-ink animate-pop' : 'border-paper/30 text-paper/30')}>
            ✕
          </span>
        ))}
      </div>
    </div>
  )
}

export function Casing({ e }: { e: Edgework }) {
  return (
    <div className="flex flex-wrap items-stretch gap-2" data-testid="casing">
      <div className="flex flex-col justify-center rounded-xl border-3 border-ink bg-white px-2.5 py-1 shadow-hard-sm">
        <span className="font-display text-[10px] font-bold uppercase leading-none tracking-wider text-ink-soft">Serial no.</span>
        <span className="font-mono text-xl font-black leading-tight tracking-[0.12em]" data-testid="serial">{e.serial}</span>
      </div>
      <div className="flex flex-col justify-center rounded-xl border-3 border-ink bg-white px-2.5 py-1 shadow-hard-sm" aria-label={`${e.batteries} batteries`}>
        <span className="font-display text-[10px] font-bold uppercase leading-none tracking-wider text-ink-soft">Batteries · {e.batteries}</span>
        <span className="flex h-7 items-center gap-1">
          {e.batteries === 0 ? <span className="font-display text-sm font-bold text-ink-soft">none</span> : Array.from({ length: e.batteries }, (_, i) => (
            <span key={i} className="relative h-4 w-7 rounded-[3px] border-2 border-ink bg-lime after:absolute after:-right-1.5 after:top-1 after:h-1.5 after:w-1 after:rounded-r-sm after:bg-ink" />
          ))}
        </span>
      </div>
      {e.stickers.length === 0 ? (
        <div className="flex items-center rounded-xl border-3 border-dashed border-ink/40 px-2.5 font-display text-sm font-bold text-ink-soft">no stickers</div>
      ) : e.stickers.map((s) => (
        <div key={s.label} className={cn('flex items-center gap-1.5 rounded-xl border-3 border-ink px-2 py-1 shadow-hard-sm', s.lit ? 'bg-sun' : 'bg-paper-deep')}>
          <span className={cn('size-3.5 rounded-full border-2 border-ink', s.lit ? 'bg-lime shadow-[0_0_8px_2px_#9be15d]' : 'bg-ink/25')} aria-hidden />
          <span className="font-chunky text-sm leading-none">{s.label}</span>
          <span className="sr-only">{s.lit ? 'lit' : 'unlit'}</span>
        </div>
      ))}
    </div>
  )
}

export function ModuleChips({ modules, current, onPick }: { modules: ModuleView[]; current?: number; onPick?: (i: number) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role={onPick ? 'tablist' : undefined}>
      {modules.map((m, i) => {
        const on = current === i
        return (
          <button
            key={m.id}
            type="button"
            role={onPick ? 'tab' : undefined}
            aria-selected={onPick ? on : undefined}
            disabled={!onPick}
            data-testid={`module-tab-${i}`}
            onClick={() => onPick?.(i)}
            className={cn(
              'flex min-h-11 items-center gap-1.5 rounded-2xl border-3 border-ink px-2.5 font-display text-sm font-extrabold disabled:cursor-default',
              m.solved ? 'bg-lime' : on ? 'bg-ink text-paper' : 'bg-white',
              onPick && !on && 'shadow-hard-sm',
            )}
          >
            <span aria-hidden>{m.solved ? '✅' : MODULE_EMOJI[m.kind]}</span>
            {m.name}
          </button>
        )
      })}
    </div>
  )
}

export function AnswerSticker({ s }: { s: Solution }) {
  return (
    <div className="-rotate-1 rounded-2xl border-3 border-ink bg-bubblegum px-3 py-2 shadow-hard-sm" data-testid="answer">
      <div className="font-display text-[11px] font-black uppercase tracking-wider">🤫 Answer</div>
      <div className="font-display text-lg font-extrabold leading-tight">{s.text}</div>
      {s.glyphs && (
        <div className="mt-1 flex items-center gap-1">
          {s.glyphs.map((g, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="font-black">→</span>}
              <span className="grid place-items-center rounded-lg border-2 border-ink bg-white" data-glyph={g}><Glyph id={g} size={36} /></span>
            </span>
          ))}
        </div>
      )}
      {s.why && <div className="mt-1 text-[13px] leading-snug">{s.why}</div>}
    </div>
  )
}
