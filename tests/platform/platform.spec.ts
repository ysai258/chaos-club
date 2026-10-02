import { test, expect } from '@playwright/test'
import {
  PHONE,
  clearEvents,
  getEvents,
  waitForEvent,
  createRoom,
  endGame,
  expectNoHorizontalScroll,
  expectTapTargets,
  joinRoom,
  pickGame,
  setTeams,
  startGame,
  waitForResults,
} from '../helpers/e2e.ts'

test.describe('landing & join', () => {
  test('create a room from the landing page and land in the lobby as host', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true })
    const page = await ctx.newPage()
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /CHAOS\s*CLUB/ })).toBeVisible()
    await expect(page.locator('[data-testid^="game-info-"]')).toHaveCount(6) // test game hidden
    await expectNoHorizontalScroll(page)
    await expectTapTargets(page)
    await page.getByRole('button', { name: 'Create a room' }).click()
    await expect(page).toHaveURL(/\/r\/[A-Z]{5}$/)
    await expect(page.getByText("First in — you'll be the host")).toBeVisible()
    await expectNoHorizontalScroll(page)
    await expectTapTargets(page)
    // Name is required.
    await page.getByRole('button', { name: 'Let me in!' }).click()
    await expect(page.getByText('Everyone needs a name')).toBeVisible()
    await page.getByLabel('Your name').fill('Asha')
    await page.getByRole('button', { name: 'Avatar 🦊' }).click()
    await page.getByRole('button', { name: 'Let me in!' }).click()
    await expect(page.getByTestId('lobby')).toBeVisible()
    await expect(page.getByText("You're the host")).toBeVisible()
    await expect(page.getByTestId('player-chip')).toContainText('Asha')
    await expectNoHorizontalScroll(page)
    // Reload keeps the seat (token in localStorage), no join form.
    await page.reload()
    await expect(page.getByTestId('lobby')).toBeVisible()
    await expect(page.getByTestId('player-chip')).toHaveCount(1)
    await ctx.close()
  })

  test('join with a code from the landing page; bad codes are explained', async ({ browser, baseURL }) => {
    const room = await createRoom(browser, { players: 1 })
    const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true })
    const page = await ctx.newPage()
    await page.goto('/')
    await page.getByLabel('Room code').fill('AB')
    await page.getByRole('button', { name: 'Join →' }).click()
    await expect(page.getByText('Room codes are 5 letters')).toBeVisible()
    await page.getByLabel('Room code').fill(room.code.toLowerCase())
    await page.getByRole('button', { name: 'Join →' }).click()
    await expect(page).toHaveURL(new RegExp(`/r/${room.code}$`))
    await expect(page.getByText('1 player inside')).toBeVisible()
    await page.goto('/r/QQQQQ')
    await expect(page.getByRole('heading', { name: 'No such room' })).toBeVisible()
    await page.goto('/this/does/not/exist')
    await expect(page.getByText('This page got abducted.')).toBeVisible()
    await ctx.close()
    await room.close()
  })
})

test.describe('lobby', () => {
  test('teams: count, move, rename, shuffle, join a team, kick', async ({ browser }) => {
    const room = await createRoom(browser, { players: 4 })
    const [host, ben, chen] = room.pages as [typeof room.host, typeof room.host, typeof room.host]
    await pickGame(host, 'test-lab')
    await setTeams(room, [['Asha', 'Ben'], ['Chen'], ['Dev']])
    await expect(ben.locator('[data-testid^="team-"]').filter({ has: ben.getByTestId('team-name') })).toHaveCount(3)

    // Rename
    await host.getByRole('button', { name: /^Rename / }).first().click()
    await host.getByLabel('Team name').fill('Chai Gang')
    await host.getByRole('button', { name: 'Save name' }).click()
    await expect(chen.getByTestId('team-0').getByTestId('team-name')).toHaveText('Chai Gang')

    // A guest moves themselves
    await chen.getByTestId('team-0').getByRole('button', { name: 'Join this team' }).click()
    await expect(host.getByTestId('team-0').getByTestId('player-chip').filter({ hasText: 'Chen' })).toHaveCount(1)

    // Guests can't open other players' chips
    await expect(chen.getByTestId('player-chip').filter({ hasText: 'Ben' })).toBeDisabled()

    // Shuffle keeps everyone
    await host.getByRole('button', { name: 'Shuffle' }).click()
    await expect(host.getByTestId('player-chip')).toHaveCount(4)

    // Kick Dev (two taps)
    await host.getByTestId('player-chip').filter({ hasText: 'Dev' }).click()
    await host.getByRole('button', { name: 'Remove Dev from the room' }).click()
    await host.getByRole('button', { name: 'Tap again to kick Dev' }).click()
    await expect(host.getByTestId('player-chip')).toHaveCount(3)
    await expect(room.page('Dev').getByRole('heading', { name: 'Booted!' })).toBeVisible()

    for (const p of room.pages) await expectNoHorizontalScroll(p)
    await room.close()
  })

  test('start button explains why it is disabled; guests see the host’s choices', async ({ browser }) => {
    const room = await createRoom(browser, { players: 2 })
    const guest = room.pages[1]!
    await pickGame(room.host, 'test-lab', { rounds: 2, mode: 'Chaos', bonus: true, roundSeconds: 30 })
    await expect(guest.getByTestId('setting-mode')).toContainText('Chaos')
    await expect(guest.getByTestId('setting-rounds')).toContainText('2')
    await expect(guest.getByText(/Waiting for Asha to start/)).toBeVisible()
    await setTeams(room, [['Asha', 'Ben'], []])
    await expect(room.host.getByTestId('start-blocker')).toContainText('every team needs a player')
    await expect(room.host.getByTestId('start-game')).toBeDisabled()
    await setTeams(room, [['Asha'], ['Ben']])
    await expect(room.host.getByTestId('start-game')).toBeEnabled()
    await room.close()
  })
})

test.describe('playing', () => {
  test('a full game: scores, events, private team chat, results, play again, back to lobby', async ({ browser }) => {
    const room = await createRoom(browser, { players: 4 })
    const [asha, ben, chen, dev] = room.pages as [typeof room.host, typeof room.host, typeof room.host, typeof room.host]
    await pickGame(asha, 'test-lab')
    await setTeams(room, [['Asha', 'Chen'], ['Ben', 'Dev']])
    await startGame(room)

    // Header chrome
    for (const p of room.pages) {
      await expect(p.getByTestId('scoreboard').getByRole('timer').or(p.getByRole('timer')).first()).toBeVisible()
      await expectNoHorizontalScroll(p)
      await expectTapTargets(p)
    }

    // Secrets: same within a team
    const s = async (p: typeof asha) => (await p.getByTestId('secret').textContent())!.trim()
    expect(await s(asha)).toBe(await s(chen))
    expect(await s(ben)).toBe(await s(dev))

    // Scoring updates every scoreboard; team-addressed events reach only that team
    await chen.getByRole('button', { name: 'Score a point' }).click()
    await chen.getByRole('button', { name: 'Score a point' }).click()
    for (const p of room.pages) await expect(p.getByTestId('scoreboard')).toContainText('2')
    await expect(asha.getByTestId('last-event')).toContainText('point')
    await expect(ben.getByTestId('last-event')).toContainText('none yet')
    await ben.getByRole('button', { name: 'Shout' }).click()
    await expect(asha.getByTestId('last-event')).toContainText('shout')
    await waitForEvent(ben, 'shout')
    expect((await getEvents(ben)).map((e) => e.type)).not.toContain('point')
    expect((await getEvents(chen)).filter((e) => e.type === 'point')).toHaveLength(2)
    await clearEvents(ben)
    expect(await getEvents(ben)).toEqual([])

    // Server rejections toast
    await ben.getByRole('button', { name: 'Explode' }).click()
    await expect(ben.getByText('The game tripped over that')).toBeVisible()

    // Private team chat with unread badge
    await asha.getByTestId('team-chat-button').click()
    await asha.getByLabel('Team chat message').fill('the secret is safe 🤫')
    await asha.getByRole('button', { name: 'Send' }).click()
    await expect(asha.getByTestId('team-chat-list')).toContainText('the secret is safe')
    await expect(chen.getByTestId('team-chat-unread')).toHaveText('1')
    await expect(ben.getByTestId('team-chat-unread')).toHaveCount(0)
    await chen.getByTestId('team-chat-button').click()
    await expect(chen.getByTestId('team-chat-list')).toContainText('the secret is safe')
    await ben.getByTestId('team-chat-button').click()
    await expect(ben.getByTestId('team-chat-list')).not.toContainText('the secret is safe')
    await ben.keyboard.press('Escape')
    await chen.keyboard.press('Escape')
    await asha.keyboard.press('Escape')

    // Finish → results for everyone
    await asha.getByRole('button', { name: 'Finish game' }).click()
    for (const p of room.pages) await waitForResults(p)
    await expect(asha.getByRole('heading', { level: 1 })).toContainText('win!')
    await expect(asha.getByTestId('my-rank')).toContainText('Your team took it')
    await expect(ben.getByTestId('my-rank')).toContainText('2nd')
    await expect(asha.getByText('Fastest Thumb')).toBeVisible()
    await expect(ben.getByText(/decides what's next/)).toBeVisible()
    for (const p of room.pages) await expectNoHorizontalScroll(p)

    // Play again → fresh game; back to lobby via the menu
    await asha.getByTestId('play-again').click()
    for (const p of room.pages) await expect(p.getByTestId('game-view')).toBeVisible()
    await expect(asha.getByTestId('scoreboard')).not.toContainText('2')
    await endGame(room)
    await room.close()
  })

  test('the round timer ticks over on its own (deadline → tick)', async ({ browser }) => {
    const room = await createRoom(browser, { players: 2 })
    await pickGame(room.host, 'test-lab', { rounds: 2, roundSeconds: 5 })
    await startGame(room)
    await expect(room.host.getByText('Round 1/2')).toBeVisible()
    await expect(room.host.getByText('Round 2/2')).toBeVisible({ timeout: 9000 })
    for (const p of room.pages) await waitForResults(p, 12_000)
    await room.close()
  })

  test('reconnect: a dropped phone comes back to the same seat mid-game', async ({ browser }) => {
    const room = await createRoom(browser, { players: 2 })
    await pickGame(room.host, 'test-lab')
    await startGame(room)
    const ben = room.pages[1]!
    await ben.getByRole('button', { name: 'Score a point' }).click()
    await expect(ben.getByTestId('my-taps')).toContainText('1 taps')

    await room.players[1]!.context.setOffline(true)
    await expect(ben.getByTestId('connection-banner')).toBeVisible({ timeout: 25_000 })
    // The host sees Ben drop once the server notices (the socket closes on the server's heartbeat or the client's reconnect).
    await room.players[1]!.context.setOffline(false)
    await expect(ben.getByTestId('connection-banner')).toHaveCount(0, { timeout: 20_000 })
    await expect(ben.getByTestId('my-taps')).toContainText('1 taps')

    // A full reload also keeps the seat.
    await ben.reload()
    await expect(ben.getByTestId('game-view')).toBeVisible()
    await expect(ben.getByTestId('my-taps')).toContainText('1 taps')
    await expect(room.host.getByTestId('scoreboard')).toBeVisible()
    await room.close()
  })

  test('late joiner spectates until the next game', async ({ browser }) => {
    const room = await createRoom(browser, { players: 2 })
    await pickGame(room.host, 'test-lab')
    await startGame(room)
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL!, viewport: PHONE, hasTouch: true })
    const late = await ctx.newPage()
    await joinRoom(late, room.code, 'Zed')
    await expect(late.getByTestId('game-view')).toBeVisible()
    await expect(late.getByText('You joined mid-game')).toBeVisible()
    await late.getByRole('button', { name: 'Score a point' }).click()
    await expect(late.getByText("You're watching this round")).toBeVisible()
    await ctx.close()
    await room.close()
  })
})
