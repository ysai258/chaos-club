import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { TeamColor } from '../../shared/protocol.ts'
import { cn } from './cn.ts'
import { COLOR } from './colors.ts'
import { haptic, playSound } from './feedback.ts'
import { Spinner } from './Spinner.tsx'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'dark'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** Paint the button in a palette colour instead of the variant's colour. */
  color?: TeamColor
  size?: ButtonSize
  /** Full width. */
  block?: boolean
  /** Shows a spinner and disables the button. */
  loading?: boolean
  /** Emoji or icon before the label. */
  icon?: ReactNode
  /** Haptic + click sound on press. Default true. */
  feedback?: boolean
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-sun text-ink',
  secondary: 'bg-white text-ink',
  danger: 'bg-tomato text-ink',
  success: 'bg-lime text-ink',
  dark: 'bg-ink text-paper',
  ghost: 'bg-transparent text-ink border-transparent shadow-none',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3.5 text-sm rounded-xl gap-1.5',
  md: 'min-h-12 px-5 text-base rounded-2xl gap-2',
  lg: 'min-h-14 px-6 text-lg rounded-2xl gap-2',
  xl: 'min-h-16 px-7 text-xl rounded-3xl gap-2.5',
}

/** Chunky sticker button that squishes into its shadow when pressed. */
export function Button({
  variant = 'primary',
  color,
  size = 'md',
  block,
  loading,
  icon,
  feedback = true,
  className,
  children,
  disabled,
  onClick,
  type = 'button',
  ...rest
}: ButtonProps) {
  const ghost = variant === 'ghost'
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={(e) => {
        if (feedback) {
          haptic('tap')
          playSound('tap')
        }
        onClick?.(e)
      }}
      className={cn(
        'relative inline-flex select-none items-center justify-center font-display font-extrabold leading-tight',
        'border-3 border-ink transition-[transform,box-shadow] duration-100 ease-out',
        !ghost && 'shadow-hard hover:-translate-x-px hover:-translate-y-px hover:shadow-hard-lg',
        !ghost && 'active:translate-x-[4px] active:translate-y-[4px] active:shadow-none',
        ghost && 'active:scale-95 hover:bg-ink/5',
        'disabled:translate-x-0 disabled:translate-y-0 disabled:opacity-55 disabled:shadow-hard-sm disabled:saturate-50',
        color ? `${COLOR[color].bg} text-ink` : VARIANT[variant],
        SIZE[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : icon ? <span className="text-[1.2em] leading-none" aria-hidden>{icon}</span> : null}
      {children !== undefined && <span className="min-w-0">{children}</span>}
    </button>
  )
}

/** Square icon-only button (mute toggle, close, menu). Always 44px+. */
export function IconButton({
  label,
  className,
  size = 'md',
  ...rest
}: Omit<ButtonProps, 'children' | 'icon' | 'size'> & { label: string; size?: 'sm' | 'md'; children: ReactNode }) {
  return (
    <Button
      aria-label={label}
      title={label}
      variant={rest.variant ?? 'secondary'}
      className={cn(size === 'sm' ? 'size-11 !px-0 !rounded-xl' : 'size-12 !px-0', 'text-xl', className)}
      {...rest}
    />
  )
}
