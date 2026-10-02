/**
 * E2E helpers for Chaos Club. Game agents: use these to get a room full of
 * joined phones in one line, then drive your game's UI.
 *
 *   import { test, expect } from '@playwright/test'
 *   import { createRoom, setTeams, pickGame, startGame } from '../../helpers/e2e.ts'
 *
 *   test('a full game', async ({ browser }) => {
 *     const room = await createRoom(browser, { players: 4 })
 *     await setTeams(room, [['Asha', 'Chen'], ['Ben', 'Dev']])
 *     await pickGame(room.host, 'bomb-squad', { rounds: 3 })
 *     await startGame(room)
 *     // ... room.pages[i] are logged-in phones
 *     await room.close()
 *   })
 *
 * Docs: docs/platform-for-games.md
 */
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'

export const PHONE = { width: 390, height: 844 }

export const DEFAULT_NAMES = ['Asha', 'Ben', 'Chen', 'Dev', 'Esha', 'Farhan', 'Gia', 'Hari', 'Isha', 'Jay', 'Kavya', 'Leo', 'Meera', 'Nikhil', 'Ojas', 'Priya']

export interface E2EPlayer {
  name: string
  page: Page
  context: BrowserContext
}

export interface E2ERoom {
  code: string
  /** The host's page (the first player). */
  host: Page
  players: E2EPlayer[]
  /** Same order as `players`. */
  pages: Page[]
  /** Look a player's page up by name. */
  page(name: string): Page
  close(): Promise<void>
}

export interface CreateRoomOptions {
  /** How many phones, host included. Default 2. */
  players?: number
  /** Names in join order (host first). Defaults to DEFAULT_NAMES. */
  names?: string[]
  /** Viewport for every context. Default 390×844 (phone). */
  viewport?: { width: number; height: number }
  /** Override the base URL (defaults to the project's baseURL). */
  baseURL?: string
}

/**
 * Click like a thumb: scroll the element to the middle of the viewport first,
 * so sticky headers / fixed action bars never sit on top of it.
 */
export async function tap(target: Locator): Promise<void> {
  await target.waitFor({ state: 'visible' })
  await target.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
  await target.click()
}

function resolveBaseURL(override?: string): string {
  if (override) return override
  const fromProject = test.info().project.use.baseURL
  if (fromProject) return fromProject
  return `http://localhost:${process.env.WEB_PORT ?? 5199}`
}

/** Open the join form for `code` and join as `name`. */
export async function joinRoom(page: Page, code: string, name: string, avatarIndex = 0): Promise<void> {
  await page.goto(`/r/${code}`)
  await page.getByLabel('Your name').fill(name)
  const avatars = page.getByRole('button', { name: /^Avatar / })
  await avatars.nth(avatarIndex % 40).click()
  await page.getByRole('button', { name: 'Let me in!' }).click()
  await expect(page.getByTestId('lobby').or(page.getByTestId('game-view')).or(page.getByTestId('results'))).toBeVisible()
}

/**
 * Create a room via the API and join `players` phones, host first, each in its
 * own browser context (separate localStorage = separate player). Resolves once
 * every phone sees everyone in the lobby.
 */
export async function createRoom(browser: Browser, opts: CreateRoomOptions = {}): Promise<E2ERoom> {
  const count = opts.players ?? 2
  const names = opts.names ?? DEFAULT_NAMES
  if (names.length < count) throw new Error(`createRoom: need ${count} names, got ${names.length}`)
  const baseURL = resolveBaseURL(opts.baseURL)
  const viewport = opts.viewport ?? PHONE

  const res = await fetch(new URL('/api/rooms', baseURL), { method: 'POST' })
  if (!res.ok) throw new Error(`createRoom: POST /api/rooms -> ${res.status}`)
  const { code } = (await res.json()) as { code: string }

  const players: E2EPlayer[] = []
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext({ baseURL, viewport, hasTouch: true, isMobile: viewport.width < 600 && browser.browserType().name() === 'chromium' })
    const page = await context.newPage()
    await joinRoom(page, code, names[i]!, i * 7)
    players.push({ name: names[i]!, page, context })
  }
  // Everyone sees everyone.
  for (const p of players) await expect(p.page.getByTestId('player-chip')).toHaveCount(count)

  return {
    code,
    host: players[0]!.page,
    players,
    pages: players.map((p) => p.page),
    page(name: string) {
      const p = players.find((x) => x.name === name)
      if (!p) throw new Error(`No player called ${name}`)
      return p.page
    },
    async close() {
      await Promise.all(players.map((p) => p.context.close().catch(() => {})))
    },
  }
}

/**
 * Arrange teams by player name, using the host's lobby UI. The number of
 * inner arrays becomes the team count (must be allowed by the picked game, so
 * call `pickGame` first if it needs more than 2 teams).
 *
 *   await setTeams(room, [['Asha', 'Chen'], ['Ben', 'Dev']])
 */
export async function setTeams(room: E2ERoom, teams: string[][]): Promise<void> {
  const host = room.host
  const teamCards = host.locator('[data-testid^="team-"]').filter({ has: host.getByTestId('team-name') })
  // Team count.
  for (let guard = 0; guard < 10; guard++) {
    const n = await teamCards.count()
    if (n === teams.length) break
    const btn = host.getByRole('button', { name: n < teams.length ? 'Increase Number of teams' : 'Decrease Number of teams' })
    await tap(btn)
    await expect(teamCards).not.toHaveCount(n)
  }
  await expect(teamCards).toHaveCount(teams.length)

  for (let i = 0; i < teams.length; i++) {
    for (const name of teams[i]!) {
      const card = host.getByTestId(`team-${i}`)
      const chipHere = card.getByTestId('player-chip').filter({ hasText: name })
      if ((await chipHere.count()) > 0) continue
      await tap(host.getByTestId('player-chip').filter({ hasText: name }).first())
      const dialog = host.getByRole('dialog')
      await dialog.getByRole('button').filter({ hasNotText: '✕' }).nth(i).click()
      await expect(chipHere).toHaveCount(1)
    }
  }
  // Wait for every phone to agree.
  for (const page of room.pages) {
    for (let i = 0; i < teams.length; i++) {
      for (const name of teams[i]!) {
        await expect(page.getByTestId(`team-${i}`).getByTestId('player-chip').filter({ hasText: name })).toHaveCount(1)
      }
    }
  }
}

/**
 * Pick a game in the lobby (host only) and optionally set settings through
 * the generic settings form. Values: number → stepped with −/+, string →
 * option label or value of a select, boolean → toggle.
 */
export async function pickGame(host: Page, gameId: string, settings: Record<string, number | string | boolean> = {}): Promise<void> {
  const card = host.getByTestId(`game-card-${gameId}`)
  if ((await card.getAttribute('aria-pressed')) !== 'true') await tap(card)
  await expect(card).toHaveAttribute('aria-pressed', 'true')
  await expect(host.getByTestId(`game-info-${gameId}`)).toBeVisible()

  for (const [key, value] of Object.entries(settings)) {
    const row = host.getByTestId(`setting-${key}`)
    await expect(row, `setting "${key}" exists for ${gameId}`).toBeVisible()
    const radios = row.getByRole('radio')
    const sw = row.getByRole('switch')
    if ((await sw.count()) > 0) {
      if ((await sw.getAttribute('aria-checked')) !== String(value)) await tap(sw)
      await expect(sw).toHaveAttribute('aria-checked', String(value))
    } else if ((await radios.count()) > 0) {
      // Select: match the option by its visible label.
      const option = radios.filter({ hasText: new RegExp(`^\\s*${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) })
      if ((await option.count()) === 0) throw new Error(`pickGame: no option labelled "${value}" for setting "${key}" (use the option label)`)
      await tap(option.first())
      await expect(option.first()).toHaveAttribute('aria-checked', 'true')
    } else {
      if (typeof value !== 'number') throw new Error(`pickGame: setting "${key}" is a number`)
      const display = row.locator('[aria-live="polite"]')
      for (let guard = 0; guard < 200; guard++) {
        const current = Number.parseFloat((await display.textContent()) ?? '')
        if (current === value) break
        await tap(row.getByRole('button', { name: current < value ? /^Increase/ : /^Decrease/ }))
        await expect(display).not.toHaveText(String(current))
      }
      await expect(display).toHaveText(new RegExp(`^${value}`))
    }
  }
}

/** Host taps Start; resolves when every phone shows the game screen. */
export async function startGame(room: E2ERoom): Promise<void> {
  const btn = room.host.getByTestId('start-game')
  const reason = (await room.host.getByTestId('start-blocker').textContent().catch(() => null)) ?? 'start blocked'
  await expect(btn, reason).toBeEnabled()
  await tap(btn)
  for (const page of room.pages) await expect(page.getByTestId('game-view')).toBeVisible()
}

/** Resolves when `page` shows the results screen. */
export async function waitForResults(page: Page, timeout = 60_000): Promise<void> {
  await expect(page.getByTestId('results')).toBeVisible({ timeout })
}

/** Host ends the running game from the ⋯ menu; everyone lands in the lobby. */
export async function endGame(room: E2ERoom): Promise<void> {
  await room.host.getByRole('button', { name: 'Room menu' }).click()
  const end = room.host.getByRole('button', { name: /End game/ })
  await end.click()
  await room.host.getByRole('button', { name: /Tap again/ }).click()
  for (const page of room.pages) await expect(page.getByTestId('lobby')).toBeVisible()
}

/**
 * Fails if the page scrolls sideways (the #1 phone layout bug). On touch
 * contexts it also catches a layout viewport that grew because something
 * overflowed earlier, even for a single animation frame. The message lists
 * whatever pokes past the edge right now.
 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const r = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth
    const touch = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0
    const widest = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, touch ? window.innerWidth : 0)
    const offenders: string[] = []
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect()
      if (b.width > 0 && (b.right > clientWidth + 1 || b.left < -1)) {
        const cls = typeof el.className === 'string' ? el.className : ''
        offenders.push(`<${el.tagName.toLowerCase()} class="${cls.slice(0, 60)}"> ${Math.round(b.left)}→${Math.round(b.right)}`)
      }
    }
    return { widest, clientWidth, innerWidth: window.innerWidth, offenders: offenders.slice(0, 8) }
  })
  expect(
    r.widest,
    `page is ${r.widest}px wide in a ${r.clientWidth}px viewport (innerWidth ${r.innerWidth}). Overflowing now: ${r.offenders.join(' | ') || 'nothing (it overflowed earlier, e.g. during an animation)'}`,
  ).toBeLessThanOrEqual(r.clientWidth + 1)
}

/** Every visible button on the page is at least `min` px in both directions. */
export async function expectTapTargets(page: Page, min = 44): Promise<void> {
  const small = await page.evaluate((m) => {
    return [...document.querySelectorAll('button, a[href], [role="button"], input, select')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && (r.width < m - 0.5 || r.height < m - 0.5)
      })
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`)
  }, min)
  expect(small, `tap targets smaller than ${min}px`).toEqual([])
}

export interface RecordedEvent {
  type: string
  data: Record<string, unknown>
  /** Browser Date.now() when it arrived. */
  at: number
}

/** Game events this page has received so far (last 200), oldest first. */
export async function getEvents(page: Page): Promise<RecordedEvent[]> {
  return page.evaluate(() => (window as unknown as { __chaosEvents?: RecordedEvent[] }).__chaosEvents ?? [])
}

/** Forget recorded events (e.g. before the action you want to observe). */
export async function clearEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __chaosEvents?: unknown[] }).__chaosEvents = []
  })
}

/** Poll until `page` has received an event of `type` (optionally matching `where`). Returns it. */
export async function waitForEvent(page: Page, type: string, where?: (data: Record<string, unknown>) => boolean, timeout = 10_000): Promise<RecordedEvent> {
  let found: RecordedEvent | undefined
  await expect
    .poll(
      async () => {
        found = (await getEvents(page)).find((e) => e.type === type && (!where || where(e.data)))
        return !!found
      },
      { timeout, message: `event "${type}"` },
    )
    .toBe(true)
  return found!
}
