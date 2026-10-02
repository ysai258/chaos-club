import { useLocation } from 'wouter'
import { BigText, Button, Card } from '../ui/index.ts'

export function NotFound() {
  const [, navigate] = useLocation()
  return (
    <main className="safe-x safe-top safe-bottom mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 text-center">
      <div className="animate-float text-8xl" aria-hidden>🛸</div>
      <BigText size="xl" color="bubblegum" font="chunky" as="h1">404</BigText>
      <Card tilt="left" className="max-w-xs">
        <p className="font-display text-lg font-bold">This page got abducted.</p>
        <p className="mt-1 text-ink-soft">Nothing lives here. The party is back at home base.</p>
      </Card>
      <Button size="lg" icon="🏠" onClick={() => navigate('/')}>Take me home</Button>
    </main>
  )
}
