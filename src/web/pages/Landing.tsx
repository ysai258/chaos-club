import { useState, type FormEvent } from 'react'
import { useLocation } from 'wouter'
import { createRoom } from '../lib/api.ts'
import { useGames } from '../lib/useGames.ts'
import { GameCard } from '../components/GameCard.tsx'
import { Button, Card, Input, MuteToggle, Spinner, haptic, playSound, toast } from '../ui/index.ts'

const FLOATERS: { e: string; cls: string; delay: string }[] = [
  { e: '💣', cls: 'left-[2%] top-[4%] -rotate-12', delay: '0s' },
  { e: '🎤', cls: 'right-[4%] top-[0%] rotate-12', delay: '0.6s' },
  { e: '⚖️', cls: 'left-[0%] bottom-[0%] rotate-6', delay: '1.2s' },
  { e: '🦈', cls: 'right-[0%] bottom-[10%] -rotate-6', delay: '0.3s' },
  { e: '🕵️', cls: 'left-[46%] -top-[18%] rotate-3', delay: '0.9s' },
]

export function Landing() {
  const [, navigate] = useLocation()
  const games = useGames()
  const [creating, setCreating] = useState(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)

  const create = async () => {
    setCreating(true)
    try {
      const c = await createRoom()
      playSound('pop')
      navigate(`/r/${c}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't create a room", { kind: 'error' })
      setCreating(false)
    }
  }

  const join = (e: FormEvent) => {
    e.preventDefault()
    const c = code.trim().toUpperCase()
    if (!/^[A-Z]{5}$/.test(c)) {
      setCodeError('Room codes are 5 letters, like QBKXZ')
      haptic('error')
      return
    }
    navigate(`/r/${c}`)
  }

  return (
    <div className="safe-x safe-top safe-bottom mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-10">
      <header className="flex items-center justify-between">
        <span className="-rotate-2 rounded-xl border-3 border-ink bg-ink px-2.5 py-1 font-chunky text-xs text-sun shadow-hard-sm">CC</span>
        <MuteToggle />
      </header>

      {/* Hero */}
      <section className="relative px-2 pt-4 pb-2 text-center">
        <h1 className="relative flex flex-col items-center gap-1 font-chunky leading-[0.9]">
          <span className="inline-block -rotate-3 rounded-2xl border-4 border-ink bg-tomato px-4 pt-2 pb-1 text-[3.4rem] text-paper shadow-hard-lg text-outline sm:text-7xl">
            CHAOS
          </span>
          <span className="inline-block rotate-2 rounded-2xl border-4 border-ink bg-sky px-4 pt-2 pb-1 text-[3.4rem] text-paper shadow-hard-lg text-outline sm:text-7xl">
            CLUB
          </span>
          {FLOATERS.map((f) => (
            <span
              key={f.e}
              aria-hidden
              className={`pointer-events-none absolute font-body text-3xl sm:text-4xl ${f.cls} animate-float`}
              style={{ animationDelay: f.delay }}
            >
              {f.e}
            </span>
          ))}
        </h1>
        <p className="relative mx-auto mt-8 max-w-sm font-display text-xl leading-snug font-bold">
          Party games for your Meet call.
          <br />
          <span className="rounded-md bg-sun px-1 box-decoration-clone">Phones out, teams up, friendships tested.</span>
        </p>
      </section>

      {/* Create / join */}
      <Card padding="lg" className="flex flex-col gap-5">
        <Button size="xl" block icon="🎉" loading={creating} onClick={create} className="animate-wiggle">
          Create a room
        </Button>
        <div className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-ink-soft" aria-hidden>
          <span className="h-[3px] flex-1 rounded bg-ink/15" /> or join one <span className="h-[3px] flex-1 rounded bg-ink/15" />
        </div>
        <form onSubmit={join} className="flex items-start gap-2" noValidate>
          <Input
            aria-label="Room code"
            placeholder="CODE"
            value={code}
            maxLength={5}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            error={codeError}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))
              setCodeError(null)
            }}
            wrapperClassName="flex-1 min-w-0"
            className="text-center font-chunky !text-xl tracking-[0.25em] uppercase"
          />
          <Button type="submit" size="lg" variant="dark" className="shrink-0 !min-h-13">
            Join →
          </Button>
        </form>
      </Card>

      {/* Games */}
      <section className="flex flex-col gap-5">
        <h2 className="text-3xl">
          Tonight&apos;s lineup <span aria-hidden>🍿</span>
        </h2>
        {games === null ? (
          <div className="grid place-items-center py-8"><Spinner size="lg" label="Loading games" /></div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {games.filter((g) => !g.testOnly).map((g, i) => (
              <GameCard key={g.id} game={g} index={i} />
            ))}
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="flex flex-col gap-4">
        <h2 className="text-3xl">How it works <span aria-hidden>🤙</span></h2>
        {[
          ['📞', 'Hop on a Google Meet', 'Voice happens there. Chaos happens here.'],
          ['📲', 'Everyone opens the link', 'On their phone. No apps, no sign-ups.'],
          ['🧨', 'Pick teams, pick a game', 'Then try to stay friends.'],
        ].map(([emoji, title, body], i) => (
          <Card key={title} color={(['sun', 'bubblegum', 'lime'] as const)[i]} soft tilt={i % 2 ? 'right' : 'left'} className="flex items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-full border-3 border-ink bg-white font-chunky text-lg">{i + 1}</span>
            <div className="min-w-0">
              <p className="font-display text-lg font-extrabold">{title} <span aria-hidden>{emoji}</span></p>
              <p className="text-ink-soft">{body}</p>
            </div>
          </Card>
        ))}
      </section>

      <footer className="pb-4 text-center text-sm font-medium text-ink-soft">
        Made for loud friends. No sign-ups, no ads, no mercy. <span aria-hidden>💥</span>
      </footer>
    </div>
  )
}
