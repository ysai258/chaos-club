import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'wouter'
import { fetchRoom, type RoomSummary } from '../lib/api.ts'
import { AVATARS, randomAvatar } from '../lib/avatars.ts'
import { loadProfile, type Profile } from '../lib/storage.ts'
import { Badge, Button, Card, Input, MuteToggle, Spinner, cn, haptic, playSound } from '../ui/index.ts'
import { FullScreenMessage } from './FullScreenMessage.tsx'

export function JoinForm({ code, onJoin }: { code: string; onJoin: (p: Profile) => void }) {
  const [, navigate] = useLocation()
  const saved = loadProfile()
  const [name, setName] = useState(saved?.name ?? '')
  const [avatar, setAvatar] = useState(saved?.avatar ?? randomAvatar())
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<RoomSummary | null | 'loading' | 'error'>('loading')

  useEffect(() => {
    let alive = true
    fetchRoom(code).then(
      (s) => alive && setSummary(s),
      () => alive && setSummary('error'),
    )
    return () => {
      alive = false
    }
  }, [code])

  if (summary === null) {
    return (
      <FullScreenMessage
        emoji="🕳️"
        title="No such room"
        color="tomato"
        actions={<Button size="lg" block icon="🏠" onClick={() => navigate('/')}>Back home</Button>}
      >
        Room <b className="font-chunky">{code}</b> doesn&apos;t exist (or it closed). Double-check the code with whoever sent it.
      </FullScreenMessage>
    )
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) {
      setError('Everyone needs a name. Even you.')
      haptic('error')
      return
    }
    playSound('pop')
    onJoin({ name: n.slice(0, 20), avatar })
  }

  return (
    <main className="safe-x safe-top safe-bottom mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6">
      <header className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => navigate('/')} className="min-h-11 font-display font-extrabold underline decoration-3 underline-offset-4">
          ← Chaos Club
        </button>
        <MuteToggle />
      </header>

      <div className="flex flex-col items-center gap-3 text-center">
        <p className="font-display text-lg font-bold">You&apos;re joining room</p>
        <span className="-rotate-2 rounded-2xl border-4 border-ink bg-sun px-5 py-2 font-chunky text-4xl tracking-widest shadow-hard-lg">{code}</span>
        <div className="flex min-h-7 flex-wrap justify-center gap-2">
          {summary === 'loading' ? (
            <Spinner size="sm" />
          ) : summary === 'error' ? null : (
            <>
              <Badge size="md">
                {summary.players === 0 ? "👑 First in — you'll be the host" : `👥 ${summary.players} ${summary.players === 1 ? 'player' : 'players'} inside`}
              </Badge>
              {summary.phase !== 'lobby' && <Badge size="md" color="bubblegum">🎮 game in progress</Badge>}
            </>
          )}
        </div>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
        <Card padding="lg" className="flex flex-col gap-5">
          <div className="flex items-end gap-3">
            <button
              type="button"
              onClick={() => {
                setAvatar(randomAvatar())
                playSound('pop')
              }}
              aria-label="Random avatar"
              className="grid size-16 shrink-0 animate-pop place-items-center rounded-full border-3 border-ink bg-sun-soft text-4xl shadow-hard-sm active:scale-90"
              key={avatar}
            >
              {avatar}
            </button>
            <Input
              label="Your name"
              placeholder="e.g. Chintu"
              value={name}
              maxLength={20}
              autoComplete="nickname"
              enterKeyHint="go"
              error={error}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              wrapperClassName="flex-1 min-w-0"
            />
          </div>
          <fieldset>
            <legend className="mb-2 font-display text-sm font-bold uppercase tracking-wide">Pick your face</legend>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-label={`Avatar ${a}`}
                  aria-pressed={a === avatar}
                  onClick={() => {
                    setAvatar(a)
                    haptic('tap')
                  }}
                  className={cn(
                    'grid aspect-square min-h-11 place-items-center rounded-xl border-2 text-2xl transition-transform',
                    a === avatar ? 'scale-110 border-ink bg-sun shadow-hard-sm' : 'border-transparent hover:bg-ink/5 active:scale-90',
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          </fieldset>
        </Card>
        {summary !== 'loading' && summary !== 'error' && summary.phase !== 'lobby' && (
          <p className="text-center font-medium text-ink-soft">A game is on — you&apos;ll watch this round and play the next.</p>
        )}
        <div className="sticky bottom-0 -mx-1 bg-gradient-to-t from-paper via-paper/90 to-transparent px-1 pt-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="submit" size="xl" block icon="🚪">
            Let me in!
          </Button>
        </div>
      </form>
    </main>
  )
}
