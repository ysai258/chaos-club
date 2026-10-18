import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, COLOR, cn } from '../ui/index.ts'
import type { TeamColor } from '../../shared/protocol.ts'

/**
 * "Watch how to play": a narrated video of six friends playing the game.
 *
 * Most people join from a laptop, so a wide screen gets the full 1080p cut
 * from the GitHub release, beside the written rules. Phones get the 720p copy
 * this server ships (lighter on data). If the release file won't play (Safari
 * is picky about GitHub's download content type) the player quietly falls
 * back to the local copy, so every browser gets a video.
 */

const RELEASE = 'https://github.com/ysai258/chaos-club/releases/download/how-to-play-v1'

/** Video length per game, for the button label. */
const MINUTES: Record<string, string> = {
  'bomb-squad': '4 min',
  overheard: '4 min',
  'friend-court': '3 min',
  'pitch-wars': '4 min',
  'the-mole': '4 min',
  'sketch-relay': '3 min',
}

export function hasHowToVideo(gameId: string): boolean {
  return gameId in MINUTES
}

const isWide = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches

interface Props {
  gameId: string
  name: string
  emoji: string
  color: TeamColor
  howToPlay: string[]
  /** Smaller button for tight spots (the in-game menu). */
  compact?: boolean
}

export function HowToVideoButton({ gameId, compact, ...rest }: Props) {
  const [open, setOpen] = useState(false)
  if (!hasHowToVideo(gameId)) return null
  return (
    <>
      <Button
        variant="secondary"
        color={rest.color}
        size={compact ? 'md' : 'lg'}
        block
        icon="▶️"
        onClick={() => setOpen(true)}
        data-testid="how-to-video"
      >
        Watch how to play <span className="font-normal opacity-75">· {MINUTES[gameId]}</span>
      </Button>
      {open && <VideoModal gameId={gameId} {...rest} onClose={() => setOpen(false)} />}
    </>
  )
}

function VideoModal({ gameId, name, emoji, color, howToPlay, onClose }: Omit<Props, 'compact'> & { onClose: () => void }) {
  const wide = isWide()
  const local = `/videos/${gameId}.mp4`
  const [src, setSrc] = useState(wide ? `${RELEASE}/${gameId}.mp4` : local)
  const video = useRef<HTMLVideoElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Only close the video, not a sheet underneath it.
      e.stopImmediatePropagation()
      closeRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
    }
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-ink/85 p-0 sm:p-6" role="dialog" aria-modal="true" aria-label={`How to play ${name}`} data-testid="how-to-video-modal">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-ink sm:h-auto sm:w-auto sm:flex-row sm:gap-6 sm:rounded-[28px] sm:border-3 sm:border-ink sm:bg-paper sm:p-5 sm:shadow-hard-lg">
        <div className="flex shrink-0 items-center gap-3 bg-paper px-4 py-3 sm:hidden">
          <span className="min-w-0 flex-1 truncate font-display text-lg font-extrabold">{emoji} How to play {name}</span>
          <CloseButton onClose={onClose} />
        </div>
        <video
          ref={video}
          key={src}
          src={src}
          poster={`/videos/${gameId}.jpg`}
          controls
          autoPlay
          playsInline
          preload="auto"
          onError={() => {
            if (src !== local) setSrc(local)
          }}
          className="min-h-0 w-full flex-1 bg-ink object-contain sm:h-[min(84dvh,1100px)] sm:w-auto sm:flex-none sm:rounded-2xl sm:border-3 sm:border-ink"
          data-testid="how-to-video-player"
        />
        <aside className="hidden w-[min(360px,32vw)] flex-col gap-4 sm:flex">
          <div className="flex items-start gap-3">
            <h2 className="min-w-0 flex-1 font-display text-3xl leading-tight font-black">{emoji} {name}</h2>
            <CloseButton onClose={onClose} />
          </div>
          <p className="text-ink-soft">Six friends play a real round while we explain. Pause any time.</p>
          <ol className="flex flex-col gap-2.5">
            {howToPlay.map((line, i) => (
              <li key={i} className="flex gap-3">
                <span className={cn('grid size-7 shrink-0 place-items-center rounded-full border-2 border-ink font-display text-sm font-black', COLOR[color].bg)}>{i + 1}</span>
                <span className="pt-0.5 leading-snug">{line}</span>
              </li>
            ))}
          </ol>
          <a
            className="mt-auto text-sm font-bold underline decoration-2 underline-offset-4"
            href={`${RELEASE}/${gameId}.mp4`}
            target="_blank"
            rel="noreferrer"
          >
            Download the video to share ↗
          </a>
        </aside>
      </div>
    </div>,
    document.body,
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close video"
      className="grid size-11 shrink-0 place-items-center rounded-full border-3 border-ink bg-white font-display text-lg font-black shadow-hard-sm active:translate-y-0.5"
      data-testid="how-to-video-close"
    >
      ✕
    </button>
  )
}
