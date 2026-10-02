import type { ReactNode } from 'react'
import type { TeamColor } from '../../shared/protocol.ts'
import { cn } from './cn.ts'
import { COLOR } from './colors.ts'
import { haptic, playSound, useMuted } from './feedback.ts'

const press = () => {
  haptic('tap')
  playSound('tap')
}

export interface StepperProps {
  value: number
  onChange: (next: number) => void
  min: number
  max: number
  step?: number
  disabled?: boolean
  /** Rendered after the number, e.g. "s" or " rounds". */
  suffix?: ReactNode
  label?: string
}

/** − value + for numbers. */
export function Stepper({ value, onChange, min, max, step = 1, disabled, suffix, label }: StepperProps) {
  const set = (n: number) => {
    const clamped = Math.min(max, Math.max(min, Math.round(n / step) * step))
    if (clamped !== value) {
      press()
      onChange(clamped)
    }
  }
  const btn =
    'grid size-11 shrink-0 place-items-center rounded-xl border-3 border-ink bg-white font-display text-2xl font-black shadow-hard-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-40 disabled:active:translate-0 disabled:active:shadow-hard-sm'
  return (
    <div className="inline-flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" className={btn} disabled={disabled || value <= min} onClick={() => set(value - step)} aria-label={`Decrease ${label ?? ''}`}>
        −
      </button>
      <span className="min-w-12 text-center font-display text-xl font-extrabold tabular-nums" aria-live="polite">
        {value}
        {suffix}
      </span>
      <button type="button" className={btn} disabled={disabled || value >= max} onClick={() => set(value + step)} aria-label={`Increase ${label ?? ''}`}>
        +
      </button>
    </div>
  )
}

export interface SegmentedProps<T extends string> {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (next: T) => void
  disabled?: boolean
  color?: TeamColor
  label?: string
}

/** Pick one of a few options, as chunky chips that wrap. */
export function Segmented<T extends string>({ value, options, onChange, disabled, color = 'sun', label }: SegmentedProps<T>) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => {
              if (!on) {
                press()
                onChange(o.value)
              }
            }}
            className={cn(
              'min-h-11 rounded-xl border-3 border-ink px-3 font-display text-sm font-bold transition-transform',
              on ? `${COLOR[color].bg} -translate-y-0.5 shadow-hard-sm` : 'bg-white',
              disabled && !on && 'opacity-50',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label?: string
}

/** On/off switch. */
export function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        press()
        onChange(!checked)
      }}
      className={cn(
        'relative h-11 w-[4.5rem] shrink-0 rounded-full border-3 border-ink transition-colors disabled:opacity-50',
        checked ? 'bg-lime' : 'bg-white',
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 size-7 -translate-y-1/2 rounded-full border-3 border-ink bg-white shadow-hard-sm transition-[left] duration-150',
          checked ? 'left-[calc(100%-2.0rem)] bg-sun' : 'left-1',
        )}
      />
    </button>
  )
}

/** 🔊 / 🔇 button wired to the persisted mute setting. */
export function MuteToggle({ className }: { className?: string }) {
  const [muted, setMuted] = useMuted()
  return (
    <button
      type="button"
      onClick={() => {
        setMuted(!muted)
        if (muted) playSound('pop')
      }}
      aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
      aria-pressed={muted}
      title={muted ? 'Unmute' : 'Mute'}
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-xl border-3 border-ink bg-white text-xl shadow-hard-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none',
        className,
      )}
    >
      <span aria-hidden>{muted ? '🔇' : '🔊'}</span>
    </button>
  )
}
