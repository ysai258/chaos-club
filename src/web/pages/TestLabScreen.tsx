/**
 * Screen for the platform's own "Test Lab" game (src/server/test-game.ts),
 * only registered on the server when CHAOS_TEST_GAME=1. Also a compact
 * example of a game screen built from the UI kit.
 */
import { useEffect, useState } from 'react'
import type { GameScreenProps, WebGame } from '../games/types.ts'
import { Badge, BigText, Button, Card, Countdown, haptic, playSound, toast } from '../ui/index.ts'

interface TestView {
  round: number
  rounds: number
  secret: string | null
  myTaps: number
  gone: string[]
  spectator: boolean
}

function TestLab({ view, me, deadline, send, onEvent, player }: GameScreenProps<TestView>) {
  const [lastEvent, setLastEvent] = useState<string>('none yet')
  useEffect(
    () =>
      onEvent((type, data) => {
        setLastEvent(type)
        if (type === 'point') playSound('pop')
        if (type === 'whisper') toast('Psst… only you got this', { emoji: '🤫' })
        if (type === 'shout') toast(`${player(String(data.by))?.name ?? 'Someone'} shouted!`, { emoji: '📢' })
        if (type === 'round') haptic('success')
      }),
    [onEvent, player],
  )

  return (
    <div className="flex flex-col gap-5" data-testid="test-lab">
      <div className="flex items-center justify-between gap-3">
        <BigText key={view.round} size="md" color="grape">Round {view.round}/{view.rounds}</BigText>
        <Countdown deadline={deadline} variant="badge" />
      </div>
      {view.spectator ? (
        <Card color="sky" soft>You&apos;re spectating this one.</Card>
      ) : (
        <Card color="grape" soft tilt="left">
          <p className="text-sm font-bold uppercase tracking-wide text-ink-soft">Your team&apos;s secret</p>
          <p className="font-chunky text-3xl" data-testid="secret">{view.secret}</p>
        </Card>
      )}
      <div className="flex flex-wrap gap-2">
        <Badge size="md" data-testid="my-taps">👆 {view.myTaps} taps</Badge>
        <Badge size="md" data-testid="last-event">⚡ {lastEvent}</Badge>
        {view.gone.length > 0 && <Badge size="md" color="tomato">💨 {view.gone.length} gone</Badge>}
      </div>
      <Button size="xl" block icon="👆" onClick={() => send('point', { round: view.round })}>Score a point</Button>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" icon="🤫" onClick={() => send('whisper')}>Whisper</Button>
        <Button variant="secondary" icon="📢" onClick={() => send('shout')}>Shout</Button>
        <Button variant="secondary" icon="⏭️" onClick={() => send('skip')}>Skip round</Button>
        <Button variant="danger" icon="💥" onClick={() => send('explode')}>Explode</Button>
      </div>
      {me.isHost && (
        <Button variant="dark" block icon="🏁" onClick={() => send('finish')}>Finish game</Button>
      )}
    </div>
  )
}

export const platformGames: Record<string, WebGame> = {
  'test-lab': { id: 'test-lab', Screen: TestLab },
}
