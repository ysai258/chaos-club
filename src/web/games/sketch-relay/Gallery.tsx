import { useState } from 'react'
import type { GameScreenProps } from '../types.ts'
import type { GalleryItem, SketchView } from '../../../games/sketch-relay/shared.ts'
import { Badge, BigText, Button, Card, Countdown, TeamPill, colorVar, toast } from '../../ui/index.ts'
import { SketchCanvas } from './SketchCanvas.tsx'
import { downloadPng, exportPng } from './draw.ts'

type Props = GameScreenProps<SketchView>

const MOD_LABEL: Record<string, string> = { fog: '🌫️ Fog', blitz: '⚡ Blitz', drought: '🏜️ Drought', flip: '🙃 Topsy-Turvy', fat: '🖍️ Fat' }

const TILTS = ['-rotate-1', 'rotate-1', 'rotate-0', '-rotate-2', 'rotate-2'] as const

export function Gallery(props: Props) {
  const { view: v, send, deadline } = props
  const items = v.gallery ?? []
  return (
    <div className="flex flex-col gap-4" data-testid="sr-gallery">
      <div className="text-center">
        <BigText color="bubblegum" size="lg">The Gallery</BigText>
        <p className="mt-1 font-semibold text-ink-soft">Every masterpiece, exactly as nobody intended.</p>
      </div>
      <div className="flex items-center gap-2">
        {v.isHost ? (
          <Button size="lg" className="flex-1" data-testid="sr-finish" onClick={() => send('finish')} icon="🏁">
            See the results
          </Button>
        ) : (
          <Card color="paper" padding="sm" className="flex-1 text-center text-sm font-semibold">
            Results in a moment — the host can skip ahead.
          </Card>
        )}
        <Countdown deadline={deadline} variant="badge" warnAt={10} />
      </div>
      <div className="grid grid-cols-1 gap-5 min-[480px]:grid-cols-2">
        {items.map((item, i) => <GalleryCard key={item.round} item={item} tilt={TILTS[i % TILTS.length] ?? ''} {...props} />)}
      </div>
      {items.length === 0 && <Card padding="lg" className="text-center font-semibold">No drawings this time. Suspicious.</Card>}
    </div>
  )
}

function GalleryCard({ item, tilt, player, team }: Props & { item: GalleryItem; tilt: string }) {
  const t = team(item.drawingTeamId)
  const r = item.result
  const winner = r.winnerPlayerId ? player(r.winnerPlayerId) : undefined
  const winTeam = r.winnerTeamId ? team(r.winnerTeamId) : undefined
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const blob = await exportPng({
        strokes: item.strokes,
        prompt: item.prompt,
        caption: `${t ? `${t.emoji} ${t.name}` : 'A team'} · ${item.strokes.length} strokes`,
        accent: t ? getComputedStyle(document.documentElement).getPropertyValue(`--color-${t.color}`).trim() || '#ff7ac6' : '#ff7ac6',
      })
      if (blob) await downloadPng(blob, item.prompt)
      else toast('Could not make the image', { kind: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card padding="sm" className={`flex flex-col gap-2 ${tilt}`} data-testid="sr-gallery-item">
      <SketchCanvas strokes={item.strokes} live={null} input={null} className="shadow-none" label={`Drawing of ${item.prompt}`} />
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-lg leading-tight">{item.prompt}</h3>
        {t && <TeamPill team={t} size="sm" compact />}
      </div>
      <p className="text-sm font-semibold">
        {winTeam ? (
          <>
            <span style={{ color: colorVar(winTeam.color) }}>●</span>{' '}
            {r.steal ? '🦝 Stolen' : '🎉 Cracked'} by {winner?.name ?? 'someone'} · +{r.points}
          </>
        ) : (
          '🤷 Stumped everyone'
        )}
      </p>
      <div className="flex items-center gap-2">
        <Badge color="white">✏️ {item.strokes.length}</Badge>
        {item.modifier && <Badge color="grape">{MOD_LABEL[item.modifier] ?? item.modifier}</Badge>}
        <Button size="sm" variant="secondary" className="ml-auto" loading={saving} onClick={save} icon="💾">Save</Button>
      </div>
    </Card>
  )
}
