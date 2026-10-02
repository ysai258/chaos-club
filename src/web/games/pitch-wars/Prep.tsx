import { Avatar, Badge, Button, Card, cn, COLOR, Input, Segmented } from '../../ui/index.ts'
import { Poster } from './Poster.tsx'
import { money, teamColor, useSyncedText, type Props } from './util.tsx'

const PRICE_IDEAS = ['₹99/month', '₹4,999 only', 'Free* (*T&C)', '₹1 crore', '3 cutting chais', 'EMI available']

export function Prep(props: Props) {
  const { view, send, player, team, me } = props
  const mt = view.myTeam
  if (!mt) return <Waiting {...props} />
  const color = teamColor(team(mt.teamId))
  const d = mt.draft
  const stage = view.stage
  const set = (patch: Record<string, unknown>) => send('draft', { stage, ...patch })
  const pitcher = mt.pitcherId ? player(mt.pitcherId) : undefined
  const iPitch = mt.pitcherId === me.id
  const pitcherAway = pitcher && !pitcher.connected

  return (
    <div className="flex flex-col gap-4 pb-28" data-testid="pw-prep">
      <RoundHeader {...props} />

      <Card color={iPitch ? 'sun' : 'white'} padding="sm" className="flex items-center gap-3">
        <Avatar emoji={pitcher?.avatar ?? '🎤'} color={color} size="md" connected={pitcher?.connected ?? true} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-extrabold leading-tight" data-testid="pw-pitcher-line">
            {iPitch ? '🎤 YOU are pitching this round!' : `🎤 ${pitcher?.name ?? 'Someone'} pitches this round`}
          </p>
          <p className="text-sm text-ink-soft">
            {iPitch ? 'Your team preps with you — plot in team chat 💬' : 'Help them out — plot in team chat 💬'}
          </p>
        </div>
        {pitcherAway && !iPitch && (
          <Button size="sm" color="tomato" onClick={() => send('takeMic', { stage })}>Take mic</Button>
        )}
      </Card>

      {/* The cards you were dealt */}
      <div className="grid grid-cols-1 gap-3">
        <Card tilt="left" padding="sm" className="relative">
          <p className="font-display text-xs font-black uppercase tracking-widest text-ink-soft">Your product</p>
          <p className="font-display text-2xl font-black leading-tight" data-testid="pw-product">{mt.product.title}</p>
          <p className="text-sm leading-snug">{mt.product.blurb}</p>
          <RedrawBtn left={mt.redraws.product} disabled={mt.ready} onClick={() => send('redraw', { stage, card: 'product' })} />
        </Card>
        <Card tilt="right" color="sun" padding="sm" className="relative">
          <p className="font-display text-xs font-black uppercase tracking-widest text-ink/70">Twist — you MUST use it</p>
          <p className="pr-2 font-display text-xl font-black leading-tight" data-testid="pw-twist">{mt.twist}</p>
          <RedrawBtn left={mt.redraws.twist} disabled={mt.ready} onClick={() => send('redraw', { stage, card: 'twist' })} />
        </Card>
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="font-display text-xl font-black">Build the poster 🛠️</h3>
        <TextField label="Startup name" placeholder={mt.product.title} max={32} server={d.name} onSend={(v) => set({ name: v })} testId="pw-name" />
        <TextField label="Slogan" placeholder="Ab har ghar mein…" max={70} server={d.slogan} onSend={(v) => set({ slogan: v })} testId="pw-slogan" />
        <div className="flex flex-col gap-2">
          <TextField label="Price" placeholder="₹99/month" max={22} server={d.price} onSend={(v) => set({ price: v })} testId="pw-price" />
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {PRICE_IDEAS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set({ price: p })}
                className="min-h-11 shrink-0 rounded-xl border-2 border-ink bg-white px-3 text-sm font-bold active:translate-y-0.5"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 font-display text-sm font-bold uppercase tracking-wide">Mascot</p>
          <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Mascot">
            {view.mascots.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={d.mascot === m}
                onClick={() => set({ mascot: m })}
                className={cn(
                  'grid aspect-square min-h-11 place-items-center rounded-xl border-2 border-ink text-2xl transition-transform',
                  d.mascot === m ? 'scale-110 bg-sun shadow-hard-sm' : 'bg-white',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <Card color="ink" padding="sm" className="flex flex-col gap-2">
          <p className="font-display text-lg font-black text-sun">💰 The Ask</p>
          <p className="text-sm text-paper/80">
            Hit it and it's a <b className="text-lime">DEAL</b>: you bank every rupee + half your Ask as bonus. Miss it and the sharks only half-fund you.
          </p>
          <div className="text-ink"><Segmented
            label="Ask"
            value={String(d.ask)}
            options={view.askOptions.map((a) => ({ value: String(a), label: money(a) }))}
            onChange={(v) => set({ ask: Number(v) })}
          /></div>
          <p className="font-display text-sm font-bold text-paper">…for how much equity?</p>
          <div className="text-ink"><Segmented
            label="Equity"
            color="bubblegum"
            value={String(d.equity)}
            options={view.equityOptions.map((e) => ({ value: String(e), label: `${e}%` }))}
            onChange={(v) => set({ equity: Number(v) })}
          /></div>
        </Card>
      </section>

      <section>
        <h3 className="mb-2 font-display text-xl font-black">Live preview 👀</h3>
        <Poster draft={d} product={mt.product} twist={mt.twist} color={color} />
        <p className="mt-2 text-center text-xs text-ink-soft">🔒 Only your team can see this until you pitch.</p>
      </section>

      <OtherTeams {...props} />

      <div className="fixed inset-x-0 bottom-0 z-20 border-t-3 border-ink bg-paper/95 px-4 pt-3 safe-bottom backdrop-blur">
        <div className="mx-auto max-w-[520px] pr-[76px]">
          <Button
            block
            size="lg"
            variant={mt.ready ? 'secondary' : 'success'}
            onClick={() => send('ready', { stage, ready: !mt.ready })}
            data-testid="pw-ready"
          >
            {mt.ready ? '✋ Wait, un-ready us' : '✅ We’re ready to pitch'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function TextField({ label, placeholder, max, server, onSend, testId }: {
  label: string; placeholder: string; max: number; server: string; onSend: (v: string) => void; testId: string
}) {
  const f = useSyncedText(server, onSend)
  return (
    <Input
      label={label}
      placeholder={placeholder}
      maxLength={max}
      value={f.value}
      onChange={(e) => f.onChange(e.target.value)}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
      data-testid={testId}
      autoComplete="off"
      enterKeyHint="done"
    />
  )
}

function RedrawBtn({ left, disabled, onClick }: { left: number; disabled: boolean; onClick: () => void }) {
  return (
    <div className="mt-2 flex justify-end">
      <Button size="sm" variant="secondary" disabled={disabled || left <= 0} onClick={onClick} icon="🔄">
        {left > 0 ? 'Redraw' : 'No redraws'}
      </Button>
    </div>
  )
}

export function RoundHeader({ view, team }: Props) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Badge color="ink" size="md">Round {view.round + 1}/{view.rounds}</Badge>
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        {view.order.map((id, i) => {
          const t = team(id)
          const st = view.teams.find((x) => x.id === id)
          const now = view.currentTeamId === id
          return (
            <span key={id} className="flex items-center gap-1">
              {i > 0 && <span className="text-ink/40">›</span>}
              <span
                title={t?.name}
                className={cn(
                  'grid size-9 place-items-center rounded-full border-2 border-ink text-lg',
                  t ? COLOR[t.color].bg : 'bg-white',
                  now && 'animate-pulse-soft shadow-hard-sm',
                  (st?.pitchedThisRound || st?.folded) && !now && 'opacity-40',
                )}
              >
                {st?.folded ? '👻' : t?.emoji ?? '?'}
              </span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

function OtherTeams({ view, team, me }: Props) {
  const others = view.teams.filter((t) => t.id !== me.teamId && !t.folded)
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-display text-sm font-bold uppercase tracking-wide text-ink-soft">Rivals</h3>
      {others.map((t) => {
        const info = team(t.id)
        return (
          <div key={t.id} className="flex items-center justify-between gap-2 rounded-2xl border-3 border-ink bg-white px-3 py-2">
            <span className="min-w-0 truncate font-display font-extrabold">{info?.emoji} {info?.name}</span>
            <Badge color={t.ready ? 'lime' : 'white'}>{t.ready ? 'READY ✅' : 'cooking… 🍳'}</Badge>
          </div>
        )
      })}
    </section>
  )
}

function Waiting(props: Props) {
  return (
    <div className="flex flex-col gap-4">
      <RoundHeader {...props} />
      <Card padding="lg" className="text-center">
        <p className="text-5xl">🍿</p>
        <p className="mt-2 font-display text-xl font-black">Teams are cooking up startups…</p>
        <p className="text-ink-soft">You'll see the pitches when they go live.</p>
      </Card>
    </div>
  )
}
