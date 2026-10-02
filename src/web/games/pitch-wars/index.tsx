import { useEffect, useState } from 'react'
import type { WebGame } from '../types.ts'
import { BigText, haptic, playSound } from '../../ui/index.ts'
import { Invest, Pitch, Stage } from './Live.tsx'
import { Prep } from './Prep.tsx'
import { Gallery, Reveal } from './Reveal.tsx'
import type { Props } from './util.tsx'

function Screen(props: Props) {
  const { view, onEvent } = props
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => onEvent((type) => {
    if (type === 'pw/fire') { playSound('buzz'); haptic('buzz') }
    if (type === 'pw/curveball') { playSound('boom'); haptic('heavy'); setFlash('CURVEBALL!') }
    if (type === 'pw/stage') playSound('whoosh')
    if (type === 'pw/pitch') playSound('ding')
    if (type === 'pw/invest') playSound('pop')
  }), [onEvent])
  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), 1400)
    return () => clearTimeout(id)
  }, [flash])

  return (
    <div className="mx-auto w-full max-w-[520px]" data-testid="pw-root" data-phase={view.phase}>
      {flash && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-tomato/30">
          <BigText color="tomato" size="xl" font="chunky" className="-rotate-6">{flash}</BigText>
        </div>
      )}
      {view.phase === 'prep' && <Prep {...props} />}
      {view.phase === 'stage' && <Stage {...props} />}
      {view.phase === 'pitch' && <Pitch {...props} />}
      {view.phase === 'invest' && <Invest {...props} />}
      {view.phase === 'reveal' && <Reveal {...props} />}
      {view.phase === 'over' && <Gallery {...props} />}
      {view.phase === 'prep' && <div className="mt-6"><Gallery {...props} /></div>}
    </div>
  )
}

export const pitchWarsWeb: WebGame = {
  id: 'pitch-wars',
  Screen,
}
