import { test, expect, type Page } from '@playwright/test'
import { createRoom, setTeams, pickGame, waitForResults, expectNoHorizontalScroll, expectTapTargets, type E2ERoom } from '../../helpers/e2e.ts'

/**
 * Bomb Squad on real phones. The defuser can't know the answers — but the
 * other team's screen shows them, so the test plays the defuser by reading
 * the spectators' answer stickers (exactly what a heckling rival could do).
 */

const SHOTS = process.env.BOMB_SHOTS

async function shot(page: Page, name: string, fullPage = false) {
  if (!SHOTS) return
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage })
}

/**
 * Like the helper's startGame, but immune to lobby cards overlapping the Start
 * button on a short phone (seen while the platform lobby was being reworked).
 */
async function startGame(room: E2ERoom) {
  const btn = room.host.getByTestId('start-game')
  await expect(btn).toBeEnabled()
  await btn.dispatchEvent('click')
  for (const p of room.pages) await expect(p.getByTestId('game-view')).toBeVisible()
}

const root = (p: Page) => p.getByTestId('bomb-squad')
const role = (p: Page) => root(p).getAttribute('data-role')

async function waitPhase(room: E2ERoom, phase: string) {
  for (const p of room.pages) await expect(root(p)).toHaveAttribute('data-phase', phase, { timeout: 30_000 })
}

async function cast(room: E2ERoom) {
  const out = { defuser: null as Page | null, experts: [] as Page[], spectators: [] as Page[], lone: false }
  for (const p of room.pages) {
    const r = await role(p)
    if (r === 'defuser' || r === 'loneWolf') { out.defuser = p; out.lone = r === 'loneWolf' }
    if (r === 'expert') out.experts.push(p)
    if (r === 'spectator') out.spectators.push(p)
  }
  expect(out.defuser).not.toBeNull()
  return out as { defuser: Page; experts: Page[]; spectators: Page[]; lone: boolean }
}

const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
const STRIP: Record<string, (t: string) => boolean> = {
  Red: (t) => t.includes('3'),
  Blue: (t) => t.includes('5'),
  Yellow: (t) => t.endsWith('0'),
  White: (t) => t[t.length - 1] === t[t.length - 2],
  Pink: (t) => t.includes('1'),
}

/** Wait until the spectator's copy of module `i` changes (solved, or a new answer). */
async function settle(spec: Page, i: number, before: string) {
  const mod = spec.getByTestId(`module-${i}`)
  await expect.poll(async () => {
    const quick = { timeout: 500 }
    if ((await root(spec).getAttribute('data-phase', quick).catch(() => 'live')) !== 'live') return true // the bomb is over
    if ((await mod.getAttribute('data-solved', quick).catch(() => null)) === 'true') return true
    // The answer sticker vanishes the moment the module is solved: never wait on it.
    return (await mod.getByTestId('answer').textContent(quick).catch(() => before)) !== before
  }, { timeout: 10_000 }).toBe(true)
}

/** Disarm module i on the defuser's phone using the answer shown on the spectator's phone. */
async function disarm(defuser: Page, spec: Page, i: number, shots: Set<string>) {
  const smod = spec.getByTestId(`module-${i}`)
  const kind = (await smod.getAttribute('data-kind'))!
  await defuser.getByTestId(`module-tab-${i}`).click()
  const card = defuser.getByTestId(`module-${i}`)
  await expect(card).toBeVisible()
  if (!shots.has(kind)) { shots.add(kind); await shot(defuser, `defuser-${kind}`) }

  const live = async () => (await root(spec).getAttribute('data-phase')) === 'live'
  for (let guard = 0; guard < 12 && (await live()) && (await smod.getAttribute('data-solved')) !== 'true'; guard++) {
    const answer = (await smod.getByTestId('answer').textContent())!
    switch (kind) {
      case 'wires': {
        const ord = /Cut the (\w+) wire/.exec(answer)![1]!
        await card.getByTestId(`wire-${ORD.indexOf(ord)}`).click()
        await card.getByTestId('cut-wire').click()
        break
      }
      case 'button': {
        const btn = card.getByTestId('big-button')
        if (answer.includes('TAP')) { await btn.click(); break }
        const color = /(Red|Blue|Yellow|White|Pink) strip/.exec(answer)![1]!
        const box = (await btn.boundingBox())!
        await defuser.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await defuser.mouse.down()
        await expect(card.getByTestId('strip')).toHaveCSS('animation-name', /pulse/, { timeout: 5000 })
        await defuser.waitForTimeout(900)
        const timer = defuser.getByTestId('bomb-timer')
        for (let k = 0; k < 400; k++) {
          const t = (await timer.textContent())!.trim()
          if (STRIP[color]!(t)) {
            await defuser.waitForTimeout(150)
            if (STRIP[color]!((await timer.textContent())!.trim())) break
          }
          await defuser.waitForTimeout(60)
        }
        await defuser.mouse.up()
        break
      }
      case 'glyphs': {
        const ids = await smod.getByTestId('answer').locator('[data-glyph]').evaluateAll((els) => els.map((e) => e.getAttribute('data-glyph')))
        for (const g of ids) await card.locator(`button[data-glyph="${g}"]`).click()
        break
      }
      case 'saywhat': {
        const word = /press (.+)$/.exec(answer.split('\n')[0]!.replace(/Screen says.*$/, '').trim())?.[1] ?? /press ([^\s]+)/.exec(answer)![1]!
        for (let b = 0; b < 4; b++) {
          const el = card.getByTestId(`say-${b}`)
          if ((await el.textContent())!.trim() === word.trim()) { await el.click(); break }
        }
        break
      }
      case 'wheels': {
        const word = /Spell ([A-Z]{5})/.exec(answer)![1]!
        for (let s = 0; s < 5; s++) {
          const w = card.getByTestId(`wheel-${s}`)
          for (let k = 0; k < 6 && (await w.textContent()) !== word[s]; k++) {
            const was = await w.textContent()
            await card.getByTestId(`wheel-${s}-down`).click()
            await expect(w).not.toHaveText(was!)
          }
        }
        await card.getByTestId('wheels-submit').click()
        break
      }
      case 'disco': {
        const seq = /Press ([A-Za-z →]+?)(?:\d| strike|$)/.exec(answer)![1]!.split('→').map((x) => x.trim().toLowerCase()).filter(Boolean)
        for (const c of seq) await card.getByTestId(`disco-${c}`).click()
        break
      }
    }
    await settle(spec, i, answer)
  }
  if (await live()) await expect(smod).toHaveAttribute('data-solved', 'true')
}

async function defuseBomb(room: E2ERoom, shots: Set<string>, opts: { strikeFirst?: boolean; tag: string }) {
  await waitPhase(room, 'briefing')
  const c = await cast(room)
  const spec = c.spectators[0]!
  await shot(c.defuser, `${opts.tag}-defuser-briefing`)
  if (c.experts[0]) await shot(c.experts[0], `${opts.tag}-expert-briefing`)
  await spec.getByTestId('predict-defuse').click()
  await c.defuser.getByTestId('arm').click()
  await waitPhase(room, 'live')

  // Hidden information on screen: answers only for the spectators, pages only for experts.
  await expect(c.defuser.getByTestId('answer')).toHaveCount(0)
  await expect(c.defuser.getByTestId('serial')).toBeVisible()
  if (!c.lone) await expect(c.defuser.getByTestId('manual')).toHaveCount(0)
  for (const e of c.experts) {
    await expect(e.getByTestId('manual')).toBeVisible()
    await expect(e.getByTestId('casing')).toHaveCount(0)
    await expect(e.getByTestId('answer')).toHaveCount(0)
  }
  await expect(spec.getByTestId('answer').first()).toBeVisible()
  await expect(spec.getByTestId('manual')).toHaveCount(0)
  for (const p of room.pages) {
    await expectNoHorizontalScroll(p)
    await expectTapTargets(p)
  }

  await shot(c.defuser, `${opts.tag}-defuser-live`)
  for (const [k, e] of c.experts.entries()) await shot(e, `${opts.tag}-expert${k}-live`)
  await shot(spec, `${opts.tag}-spectator-live`)
  await shot(spec, `${opts.tag}-spectator-live-full`, true)

  if (opts.strikeFirst) {
    // A deliberately wrong wire: strike, 15s off the clock, everyone shakes.
    const wires = spec.locator('[data-kind="wires"]')
    const i = Number((await wires.getAttribute('data-testid'))!.replace('module-', ''))
    const ord = /Cut the (\w+) wire/.exec((await wires.getByTestId('answer').textContent())!)![1]!
    const wrong = ORD.indexOf(ord) === 0 ? 1 : 0
    await c.defuser.getByTestId(`module-tab-${i}`).click()
    await c.defuser.getByTestId(`wire-${wrong}`).click()
    await c.defuser.getByTestId('cut-wire').click()
    await expect(c.defuser.getByTestId('strikes')).toHaveAttribute('aria-label', /^1 of/)
    for (const e of c.experts) await expect(e.getByTestId('strikes')).toHaveAttribute('aria-label', /^1 of/)
    // Heckle from the other team.
    await spec.getByTestId('heckle-chicken').click()
  }

  const n = await spec.locator('[data-kind]').count()
  for (let i = 0; i < n; i++) await disarm(c.defuser, spec, i, shots)
  await waitPhase(room, 'aftermath')
  await expect(c.defuser.getByTestId('aftermath')).toHaveAttribute('data-result', 'defused')
  await expect(spec.getByTestId('flash-defused')).toHaveCount(0, { timeout: 5000 })
  await shot(spec, `${opts.tag}-aftermath`)
  return c
}

test('5 phones, 2 teams: two rounds of bombs defused by talking (and reading over shoulders)', async ({ browser }) => {
  test.setTimeout(300_000)
  const room = await createRoom(browser, { players: 5 })
  await setTeams(room, [['Asha', 'Chen', 'Esha'], ['Ben', 'Dev']])
  await pickGame(room.host, 'bomb-squad', { rounds: 2 })
  await startGame(room)
  const shots = new Set<string>()

  for (let bomb = 0; bomb < 4; bomb++) {
    await defuseBomb(room, shots, { strikeFirst: bomb === 1, tag: `b${bomb + 1}` })
    // Host skips the aftermath countdown.
    await room.host.getByTestId('next').click()
  }
  await waitForResults(room.host)
  for (const p of room.pages) await waitForResults(p)
  await shot(room.host, 'results')
  await room.close()
})

test('a team of one plays lone wolf; one strike is a boom', async ({ browser }) => {
  test.setTimeout(180_000)
  const room = await createRoom(browser, { players: 3 })
  await setTeams(room, [['Asha'], ['Ben', 'Chen']])
  await pickGame(room.host, 'bomb-squad', { rounds: 1, strikes: 1 })
  await startGame(room)

  // Asha's team goes first: she is alone.
  const c = await defuseBomb(room, new Set(['wires', 'button', 'wheels']), { tag: 'wolf' }).catch(async (e) => { throw e })
  expect(c.lone).toBe(true)
  await room.host.getByTestId('next').click()

  // Ben's team: deliberately cut a wrong wire → BOOM (strikes = 1).
  await waitPhase(room, 'briefing')
  const d = await cast(room)
  await d.defuser.getByTestId('arm').click()
  await waitPhase(room, 'live')
  const spec = d.spectators[0]!
  const wires = spec.locator('[data-kind="wires"]')
  const i = Number((await wires.getAttribute('data-testid'))!.replace('module-', ''))
  const ord = /Cut the (\w+) wire/.exec((await wires.getByTestId('answer').textContent())!)![1]!
  await d.defuser.getByTestId(`module-tab-${i}`).click()
  await d.defuser.getByTestId(`wire-${ORD.indexOf(ord) === 0 ? 1 : 0}`).click()
  await d.defuser.getByTestId('cut-wire').click()
  await expect(d.defuser.getByTestId('flash-boom')).toBeVisible()
  await waitPhase(room, 'aftermath')
  await expect(spec.getByTestId('aftermath')).toHaveAttribute('data-result', 'boom')
  await shot(d.defuser, 'boom-flash')
  await expect(d.defuser.getByTestId('flash-boom')).toHaveCount(0, { timeout: 5000 })
  await shot(d.defuser, 'boom-aftermath')
  await room.host.getByTestId('next').click()
  await waitForResults(room.host)
  await room.close()
})

test('lone wolf can flip between the bomb and the whole manual', async ({ browser }) => {
  const room = await createRoom(browser, { players: 3 })
  await setTeams(room, [['Asha'], ['Ben', 'Chen']])
  await pickGame(room.host, 'bomb-squad', { rounds: 1 })
  await startGame(room)
  const asha = room.page('Asha')
  await expect(root(asha)).toHaveAttribute('data-role', 'loneWolf')
  await asha.getByTestId('arm').click()
  await expect(root(asha)).toHaveAttribute('data-phase', 'live')
  await shot(asha, 'wolf-bomb')
  await asha.getByRole('radio', { name: /Manual/ }).click()
  await expect(asha.getByTestId('manual')).toBeVisible()
  await asha.getByTestId('manual-search').fill('white')
  await shot(asha, 'wolf-manual-search')
  await expectNoHorizontalScroll(asha)
  await room.close()
})
