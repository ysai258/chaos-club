/**
 * Turn a recorded demo (videos/raw/<game>/timeline.json + six phone videos +
 * narration clips) into videos/out/<game>.mp4.
 *
 *   npx tsx videos/compose.ts bomb-squad [--preview]
 *
 * Portrait 1080×1920: game title and chapter caption on top, six phones in a
 * 3×2 grid with name tags in team colours, speech bubbles over phones, a
 * highlight ring on whoever is acting, narration subtitles at the bottom and
 * the voiceover. Stretches marked with film.cut() are dropped. A title card
 * opens the video and an invite card closes it.
 *
 * --preview renders at half size and fast settings, for checking timing.
 */
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { games } from '../src/games/registry.ts'
import type { Timeline } from './kit.ts'

const run = promisify(execFile)
const ROOT = resolve(import.meta.dirname)
const FONTS = join(ROOT, 'fonts')
export const SITE = process.env.VIDEO_SITE ?? 'chaos-club-eg0v.onrender.com'

const W = 1080
const H = 1920
const FPS = 25
const TILE_W = 330
const TILE_H = 714
const COL_X = [22, 375, 728]
const ROW_Y = [205, 968]
const SPOT_W = 640
const SPOT_H = 1385
const SPOT_X = (W - SPOT_W) / 2
const SPOT_Y = 222
const INTRO_S = 3.6
const OUTRO_S = 4.5

const PALETTE: Record<string, string> = {
  tomato: '#ff5a36', sky: '#38b6ff', lime: '#9be15d', grape: '#a77bff', sun: '#ffd23f', bubblegum: '#ff7ac6',
  ink: '#16130f', paper: '#fff4e0', white: '#ffffff',
}
const TEAM_ORDER = ['tomato', 'sky', 'lime', 'grape', 'sun', 'bubblegum']

/** '#rrggbb' -> ASS '&HAABBGGRR' */
function ass(hex: string, alpha = 0): string {
  const h = hex.replace('#', '')
  const a = alpha.toString(16).padStart(2, '0')
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase()
}
const ffhex = (hex: string) => `0x${hex.replace('#', '')}`

function ts(sec: number): string {
  const s = Math.max(0, sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const cs = Math.round((s - Math.floor(s)) * 100)
  const whole = Math.floor(s % 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(Math.min(cs, 99)).padStart(2, '0')}`
}

function esc(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, '\\N')
}

/** Drop characters libass can only draw as tofu (emoji and friends). */
function plain(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '').replace(/\s{2,}/g, ' ').trim()
}

function tilePos(i: number) {
  return { x: COL_X[i % 3]!, y: ROW_Y[Math.floor(i / 3)]! }
}

function header(): string {
  const S = (name: string, font: string, size: number, fg: string, box: string, align: number, mv: number, bold = 1, ml = 40, mr = 40, outline = 14) =>
    `Style: ${name},${font},${size},${ass(fg)},${ass(fg)},${ass(box)},${ass(box)},${bold},0,0,0,100,100,0,0,3,${outline},0,${align},${ml},${mr},${mv},1`
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    S('Title', 'Rubik Mono One', 56, PALETTE.ink!, PALETTE.paper!, 8, 26, 0, 40, 40, 0),
    S('Caption', 'Bricolage Grotesque 48pt ExtraBold', 44, PALETTE.white!, PALETTE.ink!, 8, 112, 0),
    S('Narration', 'DM Sans 14pt SemiBold', 40, PALETTE.ink!, PALETTE.white!, 2, 34, 0, 44, 44, 16),
    S('Label', 'Bricolage Grotesque 48pt ExtraBold', 32, PALETTE.white!, PALETTE.ink!, 8, 0, 0, 0, 0, 8),
    S('Bubble', 'DM Sans 14pt SemiBold', 32, PALETTE.ink!, PALETTE.sun!, 8, 0, 0, 0, 0, 14),
    S('Card', 'Rubik Mono One', 60, PALETTE.ink!, PALETTE.sun!, 5, 0, 0, 60, 60, 24),
    S('Big', 'Rubik Mono One', 92, PALETTE.ink!, PALETTE.paper!, 5, 0, 0, 60, 60, 0),
    S('Body', 'Bricolage Grotesque 48pt ExtraBold', 52, PALETTE.ink!, PALETTE.paper!, 5, 0, 0, 80, 80, 0),
    S('Pill', 'Bricolage Grotesque 48pt ExtraBold', 46, PALETTE.white!, PALETTE.ink!, 5, 0, 0, 60, 60, 16),
    S('SpotTag', 'Bricolage Grotesque 48pt ExtraBold', 40, PALETTE.white!, PALETTE.ink!, 8, 0, 0, 0, 0, 10),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')
}

const dlg = (layer: number, a: number, b: number, style: string, text: string, ml = 0, mr = 0, mv = 0, overrides = '') =>
  `Dialogue: ${layer},${ts(a)},${ts(b)},${style},,${ml},${mr},${mv},,${overrides}${esc(text)}`

/** Overlay subtitles for the main (uncut, raw-time) segment. */
function mainAss(tl: Timeline, title: string, teamColors: string[]): string {
  const end = tl.end / 1000
  const lines: string[] = [header()]
  lines.push(dlg(0, 0, end, 'Title', title.toUpperCase()))

  const captions = tl.events.filter((e) => e.kind === 'caption') as Extract<Timeline['events'][number], { kind: 'caption' }>[]
  captions.forEach((c, i) => {
    const next = captions[i + 1]
    lines.push(dlg(1, c.at / 1000, next ? next.at / 1000 : end, 'Caption', plain(c.text)))
  })

  tl.names.forEach((name, i) => {
    const { x, y } = tilePos(i)
    const color = PALETTE[teamColors[tl.team[i]!] ?? 'ink']!
    const tag = i === 0 ? `${name}  (host)` : name
    lines.push(
      dlg(1, 0, end, 'Label', tag, x, W - x - TILE_W, y + TILE_H + 8, `{\\3c${ass(color)}\\4c${ass(color)}}`),
    )
  })

  for (const [i, ws] of spotWindows(tl)) {
    const color = PALETTE[teamColors[tl.team[i]!] ?? 'ink']!
    for (const [a, b] of ws) {
      lines.push(dlg(3, a, b, 'SpotTag', `${tl.names[i]}'s phone`, SPOT_X, W - SPOT_X - SPOT_W, SPOT_Y + SPOT_H + 6, `{\\3c${ass(color)}\\4c${ass(color)}}`))
    }
  }

  for (const e of tl.events) {
    if (e.kind === 'say') {
      lines.push(dlg(2, e.at / 1000, e.at / 1000 + e.dur + 0.2, 'Narration', plain(e.text)))
    } else if (e.kind === 'bubble') {
      const i = tl.names.indexOf(e.name)
      const t = e.at / 1000
      const spotted = (spotWindows(tl).get(i) ?? []).some(([a, b]) => t >= a && t < b)
      if (spotted) {
        lines.push(dlg(5, t, t + e.dur, 'Bubble', `“${plain(e.text)}”`, SPOT_X + 30, W - SPOT_X - SPOT_W + 30, SPOT_Y + 140, '{\\fad(120,150)\\fs38}'))
      } else {
        const { x, y } = tilePos(i)
        lines.push(dlg(5, t, t + e.dur, 'Bubble', `“${plain(e.text)}”`, x + 12, W - x - TILE_W + 12, y + 70, '{\\fad(120,150)}'))
      }
    } else if (e.kind === 'cut') {
      // Shown right after the jump, so it lands at the start of the kept footage.
      lines.push(dlg(4, e.to / 1000, e.to / 1000 + 1.6, 'Card', `>> ${plain(e.label).toUpperCase()}`, 0, 0, 0, '{\\fad(80,200)}'))
    }
  }
  return lines.join('\n') + '\n'
}

function cardAss(dur: number, rows: { style: string; text: string; y: number; color?: string }[]): string {
  const lines = [header()]
  for (const r of rows) {
    const color = r.color ? `{\\3c${ass(r.color)}\\4c${ass(r.color)}}` : ''
    lines.push(dlg(1, 0, dur, r.style, r.text, 0, 0, 0, `{\\an5\\pos(${W / 2},${r.y})\\fad(250,250)}${color}`))
  }
  return lines.join('\n') + '\n'
}

/** Focus rings as drawbox filters with enable windows (raw time). */
function focusFilters(tl: Timeline): string[] {
  const end = tl.end / 1000
  const focus = tl.events.filter((e) => e.kind === 'focus') as Extract<Timeline['events'][number], { kind: 'focus' }>[]
  const out: string[] = []
  focus.forEach((f, k) => {
    const a = f.at / 1000
    const b = focus[k + 1] ? focus[k + 1]!.at / 1000 : end
    if (b <= a) return
    for (const name of f.names) {
      const i = tl.names.indexOf(name)
      if (i < 0) continue
      const { x, y } = tilePos(i)
      const en = `enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'`
      out.push(`drawbox=x=${x - 12}:y=${y - 12}:w=${TILE_W + 24}:h=${TILE_H + 24}:color=${ffhex(PALETTE.ink!)}:t=14:${en}`)
      out.push(`drawbox=x=${x - 8}:y=${y - 8}:w=${TILE_W + 16}:h=${TILE_H + 16}:color=${ffhex(PALETTE.sun!)}:t=7:${en}`)
    }
  })
  return out
}

type SpotEvent = Extract<Timeline['events'][number], { kind: 'spotlight' }>

/** Spotlight windows per tile index, raw seconds. */
function spotWindows(tl: Timeline): Map<number, [number, number][]> {
  const end = tl.end / 1000
  const spots = tl.events.filter((e) => e.kind === 'spotlight') as SpotEvent[]
  const out = new Map<number, [number, number][]>()
  spots.forEach((s, k) => {
    if (s.name === null) return
    const i = tl.names.indexOf(s.name)
    const a = s.at / 1000
    const b = spots[k + 1] ? spots[k + 1]!.at / 1000 : end
    if (i < 0 || b - a < 0.1) return
    out.set(i, [...(out.get(i) ?? []), [a, b]])
  })
  return out
}

const enableExpr = (ws: [number, number][]) => ws.map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join('+')

/** Kept [a, b] ranges in raw seconds, after removing cuts. */
function keptRanges(tl: Timeline): [number, number][] {
  const end = tl.end / 1000
  const cuts = (tl.events.filter((e) => e.kind === 'cut') as Extract<Timeline['events'][number], { kind: 'cut' }>[])
    .map((c) => [c.from / 1000, c.to / 1000] as [number, number])
    .sort((p, q) => p[0] - q[0])
  const kept: [number, number][] = []
  let cursor = 0
  for (const [a, b] of cuts) {
    if (a > cursor) kept.push([cursor, a])
    cursor = Math.max(cursor, b)
  }
  if (cursor < end) kept.push([cursor, end])
  return kept.filter(([a, b]) => b - a > 0.05)
}

async function ffmpeg(args: string[]): Promise<void> {
  try {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    const e = err as { stderr?: string }
    throw new Error(`ffmpeg failed:\n${e.stderr ?? String(err)}`)
  }
}

export async function compose(gameId: string, preview = false): Promise<string> {
  const rawDir = join(ROOT, 'raw', gameId)
  const tl = JSON.parse(readFileSync(join(rawDir, 'timeline.json'), 'utf8')) as Timeline
  const game = games[gameId]
  if (!game) throw new Error(`Unknown game ${gameId}`)
  const meta = game.meta
  const teamColors = TEAM_ORDER
  const work = join(rawDir, 'work')
  mkdirSync(work, { recursive: true })
  mkdirSync(join(ROOT, 'out'), { recursive: true })
  const enc = preview ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20']
  const fontsdir = FONTS.replace(/:/g, '\\:')

  // 1) Main segment at raw time: grid + overlays + narration.
  const end = tl.end / 1000
  writeFileSync(join(work, 'main.ass'), mainAss(tl, meta.name, teamColors))
  const inputs: string[] = []
  tl.tiles.forEach((t) => {
    // Every tile's recording began a little before t=0; skip that lead-in.
    inputs.push('-ss', (Math.max(0, -t.startedAt) / 1000).toFixed(3), '-i', t.video)
  })
  const says = tl.events.filter((e) => e.kind === 'say') as Extract<Timeline['events'][number], { kind: 'say' }>[]
  for (const s of says) inputs.push('-i', s.audio)

  const f: string[] = []
  f.push(`color=c=${ffhex(PALETTE.paper!)}:s=${W}x${H}:r=${FPS}:d=${end.toFixed(3)}[bg0]`)
  const spots = spotWindows(tl)
  tl.tiles.forEach((_, i) => {
    if (spots.has(i)) {
      f.push(`[${i}:v]fps=${FPS},setpts=PTS-STARTPTS,split[s${i}a][s${i}b]`)
      f.push(`[s${i}a]scale=${TILE_W}:${TILE_H}:flags=lanczos[t${i}]`)
      f.push(`[s${i}b]scale=${SPOT_W}:${SPOT_H}:flags=lanczos[big${i}]`)
    } else {
      f.push(`[${i}:v]fps=${FPS},scale=${TILE_W}:${TILE_H}:flags=lanczos,setpts=PTS-STARTPTS[t${i}]`)
    }
  })
  let cur = 'bg0'
  tl.tiles.forEach((_, i) => {
    const { x, y } = tilePos(i)
    // Ink frame + hard shadow behind each phone, then the phone.
    f.push(`[${cur}]drawbox=x=${x + 8}:y=${y + 8}:w=${TILE_W}:h=${TILE_H}:color=${ffhex(PALETTE.ink!)}:t=fill,drawbox=x=${x - 4}:y=${y - 4}:w=${TILE_W + 8}:h=${TILE_H + 8}:color=${ffhex(PALETTE.ink!)}:t=fill[f${i}]`)
    f.push(`[f${i}][t${i}]overlay=${x}:${y}:eof_action=repeat[o${i}]`)
    cur = `o${i}`
  })
  for (const [i, ws] of spots) {
    const en = `enable='${enableExpr(ws)}'`
    f.push(`[${cur}]drawbox=x=0:y=${ROW_Y[0]! - 20}:w=${W}:h=${ROW_Y[1]! + TILE_H + 60 - ROW_Y[0]! + 20}:color=${ffhex(PALETTE.ink!)}@0.55:t=fill:${en},drawbox=x=${SPOT_X + 14}:y=${SPOT_Y + 14}:w=${SPOT_W}:h=${SPOT_H}:color=${ffhex(PALETTE.ink!)}:t=fill:${en},drawbox=x=${SPOT_X - 6}:y=${SPOT_Y - 6}:w=${SPOT_W + 12}:h=${SPOT_H + 12}:color=${ffhex(PALETTE.ink!)}:t=fill:${en}[sb${i}]`)
    f.push(`[sb${i}][big${i}]overlay=${SPOT_X}:${SPOT_Y}:eof_action=repeat:${en}[so${i}]`)
    cur = `so${i}`
  }
  const focus = focusFilters(tl)
  f.push(`[${cur}]${[...focus, `subtitles=${join(work, 'main.ass')}:fontsdir=${fontsdir}`].join(',')}[vmain]`)

  const audioBase = tl.tiles.length
  if (says.length > 0) {
    says.forEach((s, k) => {
      const ms = Math.round(s.at)
      f.push(`[${audioBase + k}:a]aresample=48000,adelay=${ms}|${ms}[a${k}]`)
    })
    f.push(`${says.map((_, k) => `[a${k}]`).join('')}amix=inputs=${says.length}:normalize=0:duration=longest,apad,atrim=0:${end.toFixed(3)}[amain]`)
  } else {
    f.push(`anullsrc=r=48000:cl=stereo,atrim=0:${end.toFixed(3)}[amain]`)
  }

  // 2) Drop the cut stretches.
  const kept = keptRanges(tl)
  const sel = kept.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+')
  f.push(`[vmain]select='${sel}',setpts=N/FRAME_RATE/TB[vcut]`)
  f.push(`[amain]aselect='${sel}',asetpts=N/SR/TB[acut]`)

  // 3) Title card and invite card.
  writeFileSync(
    join(work, 'intro.ass'),
    cardAss(INTRO_S, [
      { style: 'Pill', text: 'HOW TO PLAY', y: 640 },
      { style: 'Big', text: meta.name.toUpperCase(), y: 860 },
      { style: 'Body', text: plain(meta.tagline), y: 1080 },
      { style: 'Pill', text: `6 friends  ·  ${new Set(tl.team).size} teams  ·  one Meet call`, y: 1320, color: PALETTE[meta.color] ?? PALETTE.ink },
    ]),
  )
  writeFileSync(
    join(work, 'outro.ass'),
    cardAss(OUTRO_S, [
      { style: 'Big', text: 'CHAOS CLUB', y: 700 },
      { style: 'Body', text: 'Get your friends on a call.\\NOpen the link. Pick a side.', y: 900 },
      { style: 'Pill', text: SITE, y: 1120, color: PALETTE.tomato },
      { style: 'Body', text: 'Free. No sign-up. No app.', y: 1300 },
    ]),
  )
  const cardBg = PALETTE[meta.color] ?? PALETTE.sun!
  f.push(`color=c=${ffhex(cardBg)}:s=${W}x${H}:r=${FPS}:d=${INTRO_S},drawbox=x=60:y=420:w=${W - 120}:h=1080:color=${ffhex(PALETTE.ink!)}:t=fill,drawbox=x=48:y=408:w=${W - 120}:h=1080:color=${ffhex(PALETTE.paper!)}:t=fill,subtitles=${join(work, 'intro.ass')}:fontsdir=${fontsdir}[vin]`)
  f.push(`anullsrc=r=48000:cl=stereo,atrim=0:${INTRO_S}[ain]`)
  f.push(`color=c=${ffhex(PALETTE.sun!)}:s=${W}x${H}:r=${FPS}:d=${OUTRO_S},drawbox=x=60:y=480:w=${W - 120}:h=960:color=${ffhex(PALETTE.ink!)}:t=fill,drawbox=x=48:y=468:w=${W - 120}:h=960:color=${ffhex(PALETTE.paper!)}:t=fill,subtitles=${join(work, 'outro.ass')}:fontsdir=${fontsdir}[vout]`)
  f.push(`anullsrc=r=48000:cl=stereo,atrim=0:${OUTRO_S}[aout]`)
  f.push(`[vin][ain][vcut][acut][vout][aout]concat=n=3:v=1:a=1[vcat][acat]`)
  f.push(preview ? `[vcat]scale=${W / 2}:${H / 2},format=yuv420p[vfinal]` : `[vcat]format=yuv420p[vfinal]`)

  writeFileSync(join(work, 'filter.txt'), f.join(';\n'))
  const out = join(ROOT, 'out', preview ? `${gameId}.preview.mp4` : `${gameId}.mp4`)
  await ffmpeg([
    ...inputs,
    '-filter_complex_script', join(work, 'filter.txt'),
    '-map', '[vfinal]', '-map', '[acat]',
    ...enc, '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    out,
  ])
  const kept_s = kept.reduce((s, [a, b]) => s + (b - a), 0)
  console.log(`[compose] ${out}  (${(kept_s + INTRO_S + OUTRO_S).toFixed(1)}s, ${says.length} narration lines, ${kept.length} kept segments)`)
  return out
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const id = process.argv[2]
  if (!id) {
    console.error('usage: tsx videos/compose.ts <game-id> [--preview]')
    process.exit(1)
  }
  compose(id, process.argv.includes('--preview')).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
