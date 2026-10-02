/**
 * The six bomb modules as the defuser sees them. Read-only for spectators.
 * These render the `face` from the server and send intents; they know no rules.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import type { ModuleFace, DiscoColor } from '../../../games/bomb-squad/shared.ts'
import { Button, cn, haptic, playSound } from '../../ui/index.ts'
import { Glyph } from './glyphs.tsx'
import { HEX, cap } from './util.ts'

export type Act = (type: string, payload?: Record<string, unknown>) => void

export interface FaceProps<K extends ModuleFace['kind']> {
  face: Extract<ModuleFace, { kind: K }>
  /** Null = read-only (spectators, aftermath). */
  act: Act | null
  solved: boolean
}

const panel = 'rounded-2xl border-3 border-ink shadow-hard-sm'

// ---------------------------------------------------------------- wires

const WIRE_PATHS = [
  'M14 22 C 70 6, 120 38, 170 20 S 260 8, 306 22',
  'M14 22 C 60 34, 110 8, 160 24 S 250 36, 306 22',
  'M14 22 C 90 10, 130 10, 180 26 S 270 30, 306 22',
  'M14 22 C 50 8, 140 36, 200 18 S 280 14, 306 22',
  'M14 22 C 80 36, 150 4, 210 22 S 290 30, 306 22',
  'M14 22 C 70 14, 100 32, 160 20 S 240 6, 306 22',
]

export function WiresFace({ face, act, solved }: FaceProps<'wires'>) {
  const [sel, setSel] = useState<number | null>(null)
  const uid = useId().replace(/:/g, '')
  useEffect(() => setSel(null), [face.wires.map((w) => w.cut).join()])
  return (
    <div className="flex flex-col gap-3">
      <div className={cn(panel, 'bg-[#bdb5a6] px-2 py-2')} style={{ backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 10px, rgba(0,0,0,.04) 10px 20px)' }}>
        {face.wires.map((w, i) => {
          const picked = sel === i
          return (
            <button
              key={i}
              type="button"
              disabled={!act || w.cut || solved}
              aria-label={`Wire ${i + 1}, ${w.color}${w.cut ? ', cut' : ''}`}
              data-testid={`wire-${i}`}
              onClick={() => { haptic('tap'); setSel(picked ? null : i) }}
              className={cn(
                'relative flex h-14 w-full items-center gap-1 rounded-xl border-2 border-transparent transition-colors',
                picked && 'border-dashed border-ink bg-sun/60',
                act && !w.cut && !solved && 'active:bg-white/30',
              )}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-ink bg-paper font-display text-sm font-black">{i + 1}</span>
              <svg viewBox="0 0 320 44" className="h-11 min-w-0 flex-1" preserveAspectRatio="none" aria-hidden>
                <rect x="2" y="14" width="14" height="16" rx="3" fill="#7d776c" stroke="#16130f" strokeWidth="2.5" />
                <rect x="304" y="14" width="14" height="16" rx="3" fill="#7d776c" stroke="#16130f" strokeWidth="2.5" />
                {w.cut && (
                  <mask id={`${uid}-${i}`}>
                    <rect width="320" height="44" fill="white" />
                    <polygon points="150,0 172,0 162,44 140,44" fill="black" />
                  </mask>
                )}
                <g mask={w.cut ? `url(#${uid}-${i})` : undefined}>
                  <path d={WIRE_PATHS[i % WIRE_PATHS.length]} fill="none" stroke="#16130f" strokeWidth="13" strokeLinecap="round" />
                  <path d={WIRE_PATHS[i % WIRE_PATHS.length]} fill="none" stroke={HEX[w.color]} strokeWidth="8" strokeLinecap="round" />
                </g>
                {w.cut && <text x="156" y="16" textAnchor="middle" fontSize="16">✂️</text>}
              </svg>
              <span className="w-12 shrink-0 text-left font-display text-[11px] font-bold uppercase text-ink/70">{w.color}</span>
            </button>
          )
        })}
      </div>
      {act && !solved && (
        <Button
          variant="danger"
          size="lg"
          block
          disabled={sel === null}
          data-testid="cut-wire"
          onClick={() => { if (sel !== null) act('cut', { index: sel }); setSel(null) }}
          icon="✂️"
        >
          {sel === null ? 'Tap a wire to pick it' : `Cut wire ${sel + 1} (${face.wires[sel]!.color})`}
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- button

export function ButtonFace({ face, act, solved }: FaceProps<'button'>) {
  const [down, setDown] = useState(false)
  const [since, setSince] = useState<number | null>(null)
  const [, force] = useState(0)
  useEffect(() => {
    if (since === null) return
    const id = setInterval(() => force((n) => n + 1), 100)
    return () => clearInterval(id)
  }, [since])
  const release = () => {
    if (!down && !face.held) return
    setDown(false)
    setSince(null)
    act?.('buttonUp')
  }
  const pressed = down || face.held
  const strip = face.strip
  return (
    <div className="flex items-stretch justify-center gap-4 py-2">
      <button
        type="button"
        data-testid="big-button"
        disabled={!act || solved}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (!act || solved) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setDown(true)
          setSince(Date.now())
          haptic('heavy')
          playSound('pop')
          act('buttonDown')
        }}
        onPointerUp={release}
        onPointerCancel={release}
        style={{ background: HEX[face.color], WebkitTouchCallout: 'none' }}
        className={cn(
          'relative grid size-48 shrink-0 select-none place-items-center rounded-full border-4 border-ink transition-[transform,box-shadow] duration-75',
          pressed ? 'translate-x-1.5 translate-y-1.5 shadow-none' : 'shadow-hard-xl',
          (!act || solved) && 'opacity-90',
        )}
      >
        <span className="pointer-events-none absolute inset-3 rounded-full border-2 border-white/40" />
        <span className={cn('pointer-events-none font-chunky text-2xl', face.color === 'white' || face.color === 'yellow' ? 'text-ink' : 'text-white text-outline')}>
          {face.label}
        </span>
        <span className="pointer-events-none absolute bottom-6 font-display text-[11px] font-bold uppercase text-ink/60">{face.color}</span>
      </button>
      <div className="flex flex-col items-center gap-1">
        <div
          data-testid="strip"
          className={cn('w-8 flex-1 rounded-full border-3 border-ink transition-colors', strip ? 'animate-pulse-soft shadow-[0_0_18px_4px_var(--glow)]' : 'bg-[#8a8478]')}
          style={strip ? ({ background: HEX[strip], '--glow': HEX[strip] } as CSSProperties) : undefined}
        />
        <span className="font-display text-[11px] font-bold uppercase">{strip ?? 'strip'}</span>
      </div>
      {since !== null && <span className="sr-only">holding</span>}
    </div>
  )
}

// ---------------------------------------------------------------- glyphs

export function GlyphsFace({ face, act, solved }: FaceProps<'glyphs'>) {
  return (
    <div className={cn(panel, 'grid grid-cols-2 gap-3 bg-[#bdb5a6] p-3')}>
      {face.glyphs.map((g, i) => (
        <button
          key={i}
          type="button"
          data-testid={`glyph-${i}`}
          data-glyph={g}
          disabled={!act || solved || face.pressed[i]}
          onClick={() => act?.('glyph', { index: i })}
          className={cn(
            'relative grid aspect-square place-items-center rounded-2xl border-3 border-ink bg-paper transition-transform',
            face.pressed[i] ? 'translate-y-1 shadow-none' : 'shadow-hard active:translate-y-1 active:shadow-none',
          )}
        >
          <span className={cn('absolute right-2 top-2 size-3.5 rounded-full border-2 border-ink', face.pressed[i] ? 'bg-lime shadow-[0_0_8px_2px_#9be15d]' : 'bg-ink/20')} />
          <Glyph id={g} size={84} />
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- say what

export function SayFace({ face, act, solved }: FaceProps<'saywhat'>) {
  return (
    <div className="flex flex-col gap-3">
      <div className={cn(panel, 'flex items-center gap-3 bg-ink px-4 py-3')}>
        <div data-testid="say-display" className="flex h-16 min-w-0 flex-1 items-center justify-center rounded-xl bg-[#1d3b1f] px-2 font-chunky text-2xl tracking-wide text-[#9be15d] [text-shadow:0_0_10px_#9be15d]">
          {face.display}
        </div>
        <div className="flex flex-col gap-1.5" aria-label={`Stage ${face.stage + 1} of ${face.stages}`}>
          {Array.from({ length: face.stages }, (_, i) => (
            <span key={i} className={cn('size-3 rounded-full border-2 border-paper', i < face.stage || solved ? 'bg-lime' : 'bg-transparent')} />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {face.buttons.map((w, i) => (
          <Button key={`${face.stage}-${i}`} variant="secondary" size="lg" disabled={!act || solved} data-testid={`say-${i}`} onClick={() => act?.('say', { index: i })} className="font-chunky !text-lg">
            {w}
          </Button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- letter lock

export function WheelsFace({ face, act, solved }: FaceProps<'wheels'>) {
  const arrow = 'grid h-11 w-full place-items-center rounded-xl border-3 border-ink bg-white font-black shadow-hard-sm active:translate-y-0.5 active:shadow-none disabled:opacity-40'
  return (
    <div className="flex flex-col gap-3">
      <div className={cn(panel, 'grid grid-cols-5 gap-1.5 bg-[#bdb5a6] p-2')}>
        {face.slots.map((s, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <button type="button" className={arrow} disabled={!act || solved} aria-label={`Wheel ${i + 1} up`} data-testid={`wheel-${i}-up`} onClick={() => { haptic('tap'); act?.('wheel', { slot: i, dir: -1 }) }}>▲</button>
            <div className="grid h-16 w-full place-items-center rounded-xl border-3 border-ink bg-paper font-chunky text-3xl" data-testid={`wheel-${i}`}>
              {s.letters[s.index]}
            </div>
            <button type="button" className={arrow} disabled={!act || solved} aria-label={`Wheel ${i + 1} down`} data-testid={`wheel-${i}-down`} onClick={() => { haptic('tap'); act?.('wheel', { slot: i, dir: 1 }) }}>▼</button>
          </div>
        ))}
      </div>
      {act && !solved && <Button variant="success" size="lg" block icon="🔓" data-testid="wheels-submit" onClick={() => act('submitWheels')}>Submit word</Button>}
    </div>
  )
}

// ---------------------------------------------------------------- disco

const PADS: DiscoColor[] = ['red', 'blue', 'green', 'yellow']

export function DiscoFace({ face, act, solved }: FaceProps<'disco'>) {
  const [lit, setLit] = useState<DiscoColor | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const seqKey = face.flashes.join(',')
  useEffect(() => {
    if (solved) return
    let alive = true
    let t: ReturnType<typeof setTimeout>
    const run = (i: number) => {
      if (!alive) return
      if (i >= face.flashes.length) { setLit(null); t = setTimeout(() => run(0), 1600); return }
      setLit(face.flashes[i]!)
      t = setTimeout(() => { setLit(null); t = setTimeout(() => run(i + 1), 220) }, 520)
    }
    t = setTimeout(() => run(0), 600)
    return () => { alive = false; clearTimeout(t) }
  }, [seqKey, solved])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between font-display text-sm font-bold">
        <span>Round {Math.min(face.stage, face.stages)} of {face.stages}</span>
        <span className="flex gap-1" aria-label={`${face.entered} pressed`}>
          {Array.from({ length: Math.min(face.stage, face.stages) }, (_, i) => (
            <span key={i} className={cn('size-3 rounded-full border-2 border-ink', i < face.entered ? 'bg-ink' : 'bg-white')} />
          ))}
        </span>
      </div>
      <div className={cn(panel, 'grid grid-cols-2 gap-3 bg-ink p-3')}>
        {PADS.map((c) => {
          const on = lit === c
          return (
            <button
              key={c}
              type="button"
              data-testid={`disco-${c}`}
              disabled={!act || solved}
              aria-label={`${c} light`}
              onClick={() => {
                if (!act) return
                clearTimeout(pressTimer.current)
                setLit(c)
                pressTimer.current = setTimeout(() => setLit(null), 180)
                act('disco', { color: c })
              }}
              className="relative aspect-[4/3] rounded-2xl border-3 border-paper/80 transition-[filter,box-shadow] duration-100"
              style={{
                background: HEX[c],
                filter: on ? 'brightness(1.25) saturate(1.2)' : 'brightness(0.42) saturate(0.7)',
                boxShadow: on ? `0 0 28px 8px ${HEX[c]}` : 'none',
              }}
            >
              <span className="absolute bottom-1.5 left-2 font-display text-xs font-bold uppercase text-white/90">{cap(c)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Face({ face, act, solved }: { face: ModuleFace; act: Act | null; solved: boolean }) {
  switch (face.kind) {
    case 'wires': return <WiresFace face={face} act={act} solved={solved} />
    case 'button': return <ButtonFace face={face} act={act} solved={solved} />
    case 'glyphs': return <GlyphsFace face={face} act={act} solved={solved} />
    case 'saywhat': return <SayFace face={face} act={act} solved={solved} />
    case 'wheels': return <WheelsFace face={face} act={act} solved={solved} />
    case 'disco': return <DiscoFace face={face} act={act} solved={solved} />
  }
}
