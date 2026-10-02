import { Component, type ReactNode } from 'react'
import { Button, Card } from '../ui/index.ts'

/** Keeps a crashing game screen from taking the whole room UI down. */
export class GameErrorBoundary extends Component<{ children: ReactNode; gameName: string }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error) {
    console.error('game screen crashed', error)
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <Card color="tomato" soft tilt="left" className="flex flex-col items-center gap-3 text-center">
        <span className="text-5xl" aria-hidden>🫠</span>
        <p className="font-display text-xl font-extrabold">{this.props.gameName} tripped over its own feet.</p>
        <p className="text-ink-soft">The game is still running on the server.</p>
        <Button icon="🔄" onClick={() => this.setState({ error: null })}>Try again</Button>
      </Card>
    )
  }
}
