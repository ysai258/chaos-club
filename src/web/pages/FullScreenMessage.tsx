import type { ReactNode } from 'react'
import { BigText, Card } from '../ui/index.ts'

/** Centered emoji + headline + body + actions. For loading/fatal states. */
export function FullScreenMessage({ emoji, title, children, actions, color = 'sun' }: {
  emoji: string
  title: ReactNode
  children?: ReactNode
  actions?: ReactNode
  color?: 'sun' | 'tomato' | 'sky' | 'bubblegum' | 'lime' | 'grape'
}) {
  return (
    <main className="safe-x safe-top safe-bottom mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 text-center">
      <div className="animate-float text-7xl" aria-hidden>{emoji}</div>
      <BigText size="lg" color={color} as="h1">{title}</BigText>
      {children && <Card tilt="right" className="w-full max-w-sm text-lg">{children}</Card>}
      {actions && <div className="flex w-full max-w-sm flex-col gap-3">{actions}</div>}
    </main>
  )
}
