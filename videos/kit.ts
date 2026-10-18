/**
 * Filming kit for the how-to-play videos.
 *
 * A demo is a Playwright test that plays one game with six recorded phones
 * while a narrator explains it. The kit records every phone, synthesises the
 * narration, and writes a timeline that `videos/compose.ts` turns into one
 * portrait video: six phones in a 3×2 grid, captions, speech bubbles for what
 * people "say on the Meet call", a highlight ring on whoever is acting, and
 * the voiceover.
 *
 *   const film = await startFilm(browser, {
 *     game: 'bomb-squad',
 *     names: ['Asha', 'Ben', 'Chen', 'Dev', 'Esha', 'Farhan'],
 *     teams: [['Asha', 'Chen', 'Esha'], ['Ben', 'Dev', 'Farhan']],
 *     lines: Object.values(N),          // every narration line, synthesised up front
 *   })
 *   await film.caption('Round 1')
 *   await film.say(N.intro)              // speaks, and waits until it's done
 *   film.bubble('Asha', 'Four wires! Red, black, black, green!')
 *   film.focus('Asha')
 *   await film.cut(async () => { ... })  // boring stretch, dropped from the video
 *   await film.finish()
 *
 * Run: npm run video:record -- <game>   then   npm run video:compose -- <game>
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { joinRoom, pickGame, setTeams, startGame, tap, type E2EPlayer, type E2ERoom } from '../tests/helpers/e2e.ts'

const run = promisify(execFile)

export const VIDEO_ROOT = resolve(import.meta.dirname)
export const PHONE = { width: 390, height: 844 }
export const VOICE = process.env.VIDEO_VOICE ?? 'en-IN-NeerjaExpressiveNeural'
const TTS_CACHE = join(VIDEO_ROOT, '.cache', 'tts')

export { tap }

export type TimelineEvent =
  | { kind: 'say'; at: number; dur: number; text: string; audio: string }
  | { kind: 'caption'; at: number; text: string }
  | { kind: 'focus'; at: number; names: string[] }
  | { kind: 'bubble'; at: number; dur: number; name: string; text: string }
  | { kind: 'cut'; from: number; to: number; label: string }
  | { kind: 'spotlight'; at: number; name: string | null }

export interface Timeline {
  game: string
  names: string[]
  /** Team index per player, same order as names. */
  team: number[]
  tiles: { name: string; video: string; startedAt: number }[]
  /** Epoch ms that becomes t=0 of the video. */
  start: number
  end: number
  events: TimelineEvent[]
}

export interface FilmOptions {
  game: string
  /** Exactly six names; the first is the host. */
  names: string[]
  /** Team rosters by name. Team 0 gets the first colour (tomato), team 1 the second (sky)... */
  teams: string[][]
  /** Lobby settings, as for pickGame (option labels for selects). */
  settings?: Record<string, number | string | boolean>
  /** Every narration line the demo will say(), so they are synthesised before filming starts. */
  lines?: string[]
  baseURL?: string
}

export interface Film {
  room: E2ERoom
  /** Page by player name. */
  page(name: string): Page
  /** Narrate and wait until the line has been spoken. */
  say(text: string): Promise<void>
  /** Narrate while running `action`; resolves when both are done. */
  sayWhile<T>(text: string, action: () => Promise<T>): Promise<T>
  /** Chapter heading shown at the top until the next caption. */
  caption(text: string): void
  /** Speech bubble over a player's phone: what they say out loud on the call. Default 2.6s. */
  bubble(name: string, text: string, ms?: number): void
  /** Like bubble, but also waits for it so the viewer can read it. */
  shout(name: string, text: string, ms?: number): Promise<void>
  /** Highlight ring on these players' phones (null clears). */
  focus(names: string | string[] | null): void
  /**
   * Show this player's phone enlarged over the grid, so viewers can read it,
   * until spotlight(null) or the next spotlight. Use it whenever the thing
   * worth seeing is on one phone (a secret, a puzzle, a reveal).
   */
  spotlight(name: string | null): void
  /** Run a stretch that is dropped from the final video (a "⏩ later" card marks the jump). */
  cut<T>(action: () => Promise<T>, label?: string): Promise<T>
  /** Wait, keeping the camera rolling. */
  pause(ms: number): Promise<void>
  /** Close the phones (flushes the videos) and write the timeline. */
  finish(): Promise<Timeline>
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function duration(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  return Number.parseFloat(stdout.trim())
}

/** Synthesise one line (cached by voice + text). Returns the mp3 path and its length in seconds. */
export async function tts(text: string): Promise<{ audio: string; dur: number }> {
  mkdirSync(TTS_CACHE, { recursive: true })
  const hash = createHash('sha1').update(`${VOICE}\n${text}`).digest('hex').slice(0, 16)
  const audio = join(TTS_CACHE, `${hash}.mp3`)
  if (!existsSync(audio)) {
    const tmp = `${audio}.part`
    for (let attempt = 1; ; attempt++) {
      try {
        await run('uvx', ['--from', 'edge-tts', 'edge-tts', '--voice', VOICE, '--rate', '+4%', '--text', text, '--write-media', tmp], { timeout: 60_000 })
        await run('mv', [tmp, audio])
        break
      } catch (err) {
        if (attempt >= 3) throw new Error(`TTS failed for "${text.slice(0, 60)}": ${String(err)}`)
        await sleep(1500 * attempt)
      }
    }
  }
  return { audio, dur: await duration(audio) }
}

export async function startFilm(browser: Browser, opts: FilmOptions): Promise<Film> {
  if (opts.names.length !== 6) throw new Error('A film has exactly six players')
  const baseURL = opts.baseURL ?? `http://localhost:${process.env.WEB_PORT ?? 5199}`
  const rawDir = join(VIDEO_ROOT, 'raw', opts.game)
  rmSync(rawDir, { recursive: true, force: true })
  mkdirSync(rawDir, { recursive: true })

  // Narration first, so no line costs dead air on camera.
  const clips = new Map<string, { audio: string; dur: number }>()
  for (const line of opts.lines ?? []) clips.set(line, await tts(line))
  const clip = async (text: string) => {
    let c = clips.get(text)
    if (!c) {
      console.warn(`[film] line not preloaded, synthesising on camera: "${text.slice(0, 50)}"`)
      c = await tts(text)
      clips.set(text, c)
    }
    return c
  }

  const res = await fetch(new URL('/api/rooms', baseURL), { method: 'POST' })
  if (!res.ok) throw new Error(`POST /api/rooms -> ${res.status}`)
  const { code } = (await res.json()) as { code: string }

  // Open all six phones before anything happens, so their recordings line up.
  const players: E2EPlayer[] = []
  const startedAt: number[] = []
  for (const name of opts.names) {
    const context: BrowserContext = await browser.newContext({
      baseURL,
      viewport: PHONE,
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      recordVideo: { dir: rawDir, size: PHONE },
    })
    const page = await context.newPage()
    startedAt.push(Date.now())
    players.push({ name, page, context })
  }
  const start = Math.max(...startedAt)
  const events: TimelineEvent[] = []
  const now = () => Date.now() - start
  const byName = (name: string) => {
    const p = players.find((x) => x.name === name)
    if (!p) throw new Error(`No player called ${name}`)
    return p.page
  }

  const room: E2ERoom = {
    code,
    host: players[0]!.page,
    players,
    pages: players.map((p) => p.page),
    page: byName,
    async close() {
      await Promise.all(players.map((p) => p.context.close().catch(() => {})))
    },
  }

  const film: Film = {
    room,
    page: byName,
    async say(text) {
      const c = await clip(text)
      events.push({ kind: 'say', at: now(), dur: c.dur, text, audio: c.audio })
      await sleep(c.dur * 1000 + 350)
    },
    async sayWhile(text, action) {
      const c = await clip(text)
      events.push({ kind: 'say', at: now(), dur: c.dur, text, audio: c.audio })
      const [result] = await Promise.all([action(), sleep(c.dur * 1000 + 350)])
      return result
    },
    caption(text) {
      events.push({ kind: 'caption', at: now(), text })
    },
    bubble(name, text, ms = 2600) {
      byName(name)
      events.push({ kind: 'bubble', at: now(), dur: ms / 1000, name, text })
    },
    async shout(name, text, ms = 2600) {
      film.bubble(name, text, ms)
      await sleep(ms)
    },
    focus(names) {
      const list = names === null ? [] : Array.isArray(names) ? names : [names]
      for (const n of list) byName(n)
      events.push({ kind: 'focus', at: now(), names: list })
    },
    spotlight(name) {
      if (name !== null) byName(name)
      events.push({ kind: 'spotlight', at: now(), name })
    },
    async cut(action, label = 'a little later') {
      const from = now()
      try {
        return await action()
      } finally {
        events.push({ kind: 'cut', from, to: now(), label })
      }
    },
    pause: sleep,
    async finish() {
      const end = now()
      await room.close()
      const tiles = await Promise.all(
        players.map(async (p, i) => ({ name: p.name, video: (await p.page.video()!.path())!, startedAt: startedAt[i]! - start })),
      )
      const team = opts.names.map((n) => opts.teams.findIndex((t) => t.includes(n)))
      const timeline: Timeline = { game: opts.game, names: opts.names, team, tiles, start: 0, end, events }
      writeFileSync(join(rawDir, 'timeline.json'), JSON.stringify(timeline, null, 2))
      console.log(`[film] ${opts.game}: ${(end / 1000).toFixed(1)}s recorded -> ${rawDir}/timeline.json`)
      return timeline
    },
  }

  // Everyone joins. This is on camera: it is how a real night starts.
  for (let i = 0; i < players.length; i++) await joinRoom(players[i]!.page, code, players[i]!.name, i * 7)
  for (const p of players) await expect(p.page.getByTestId('player-chip')).toHaveCount(players.length)

  return film
}

/** Lobby setup with the kit's room: teams, game, settings. Does not start. */
export async function setUpLobby(film: Film, opts: Pick<FilmOptions, 'game' | 'teams' | 'settings'>): Promise<void> {
  await pickGame(film.room.host, opts.game, {})
  await setTeams(film.room, opts.teams)
  if (opts.settings && Object.keys(opts.settings).length > 0) await pickGame(film.room.host, opts.game, opts.settings)
  // Bring the host's game card back into view for the camera.
  await film.room.host.getByTestId(`game-card-${opts.game}`).evaluate((el) => el.scrollIntoView({ block: 'center' }))
}

export async function start(film: Film): Promise<void> {
  await startGame(film.room)
}
