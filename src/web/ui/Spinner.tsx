import { cn } from './cn.ts'

/** Three bouncing blobs. `label` is read to screen readers. */
export function Spinner({ size = 'md', label = 'Loading', className }: { size?: 'sm' | 'md' | 'lg'; label?: string; className?: string }) {
  const dot = size === 'sm' ? 'size-1.5' : size === 'lg' ? 'size-4' : 'size-2.5'
  const colors = ['bg-tomato', 'bg-sun', 'bg-sky']
  return (
    <span role="status" aria-label={label} className={cn('inline-flex items-center gap-1', className)}>
      {colors.map((c, i) => (
        <span
          key={c}
          className={cn(dot, c, 'animate-bounce-dot rounded-full border-2 border-ink')}
          style={{ animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </span>
  )
}
