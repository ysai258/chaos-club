import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn.ts'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode
  hint?: ReactNode
  /** Error text; also shakes the field. */
  error?: ReactNode
  /** Extra classes for the wrapping label. */
  wrapperClassName?: string
}

/** Big chunky text field. Font size is ≥16px so iOS never zooms. */
export function Input({ label, hint, error, className, wrapperClassName, id, ...rest }: InputProps) {
  const auto = useId()
  const inputId = id ?? auto
  return (
    <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
      {label && (
        <label htmlFor={inputId} className="font-display text-sm font-bold uppercase tracking-wide">
          {label}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={cn(
          'min-h-13 w-full min-w-0 rounded-2xl border-3 border-ink bg-white px-4 text-lg font-semibold text-ink shadow-hard-sm',
          'placeholder:font-normal placeholder:text-ink/40 focus:shadow-hard focus:outline-none',
          !!error && 'animate-shake border-tomato',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p className="text-sm font-bold text-tomato">{error}</p>
      ) : hint ? (
        <p className="text-sm text-ink-soft">{hint}</p>
      ) : null}
    </div>
  )
}
