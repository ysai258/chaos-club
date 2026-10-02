import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import {
  createRoom, pickGame, setTeams, startGame, waitForResults, expectNoHorizontalScroll, expectTapTargets,
} from '../../helpers/e2e.ts'

const SHOTS = process.env.MOLE_SHOTS ?? ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

/** Record every room snapshot a page receives, to audit hidden information. */
function captureViews(page: Page): { phase: string; raw: string; role: string }[] {
  const out: { phase: string; raw: string; role: string }[] = []
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => {
      try {
        const msg = JSON.parse(String(f.payload)) as { t: string; room?: { game?: { view?: { phase?: string; role?: { kind: string } } } } }
        const view = msg.t === 'room' ? msg.room?.game?.view : undefined
        if (view?.phase) out.push({ phase: view.phase, raw: JSON.stringify(view), role: view.role?.kind ?? '' })
      } catch { /* not json */ }
    })
  })
  return out
}

async function phaseOf(page: Page): Promise<string | null> {
  return page.getByTestId('mole-screen').getAttribute('data-phase', { timeout: 500 }).catch(() => null)
}

/** Play whatever input is on screen, like a cooperative human would. Returns true if it acted. */
async function playInput(page: Page): Promise<boolean> {
  const lock = page.getByTestId('mole-lock')
  if (!(await lock.isVisible().catch(() => false))) return false
  if (await page.getByTestId('mole-number-input').isVisible().catch(() => false)) {
    await page.getByTestId('mole-number-input').fill('100')
  } else if (await page.getByTestId('mole-text-input').isVisible().catch(() => false)) {
    await page.getByTestId('mole-text-input').fill('zzclue')
  } else if (await page.getByTestId('mole-digits').isVisible().catch(() => false)) {
    for (let i = 0; i < 4; i++) await page.getByTestId('mole-key-1').click()
  } else {
    const picks = page.locator('[data-testid^="mole-pick-"]')
    const n = await picks.count()
    if (n) {
      const label = (await page.getByText(/\(\d+\/\d+\)/).first().textContent()) ?? ''
      const need = Number(/\/(\d+)\)/.exec(label)?.[1] ?? 2)
      for (let i = 0; i < need; i++) await picks.nth(i).click()
    } else {
      const opt = page.locator('[data-testid^="mole-num-"], [data-testid^="mole-choice-"]').first()
      if (await opt.isVisible().catch(() => false)) await opt.click()
    }
  }
  if (await lock.isEnabled()) { await lock.click(); return true }
  return false
}

test('six phones, two teams: a full game of The Mole', async ({ browser }) => {
  test.setTimeout(420_000)
  const room = await createRoom(browser, { players: 6 })
  await pickGame(room.host, 'the-mole', { rounds: 4, pace: 'Quick' })
  await setTeams(room, [['Asha', 'Chen', 'Esha'], ['Ben', 'Dev', 'Farhan']])
  const audits = new Map(room.players.map((p) => [p.name, captureViews(p.page)]))
  // The sockets opened while joining; reload so the recorder sees the (re)connected socket.
  for (const p of room.players) {
    await p.page.reload()
    await expect(p.page.getByTestId('lobby')).toBeVisible()
  }
  await startGame(room)
  if (process.env.MOLE_DEBUG) console.log('started')

  // Who is who (each phone only knows itself).
  const roles: Record<string, string> = {}
  for (const p of room.players) {
    await expect(p.page.getByTestId('mole-role')).toBeVisible()
    roles[p.name] = (await p.page.getByTestId('mole-role').getAttribute('data-role')) ?? ''
  }
  const team0 = ['Asha', 'Chen', 'Esha']
  const team1 = ['Ben', 'Dev', 'Farhan']
  expect(team0.filter((n) => roles[n] === 'mole')).toHaveLength(1)
  expect(team1.filter((n) => roles[n] === 'mole')).toHaveLength(1)
  const mole0 = team0.find((n) => roles[n] === 'mole') as string
  // The mole's phone shows the secret mission; nobody else's does.
  await expect(room.page(mole0).getByTestId('mole-objective')).toBeVisible()
  for (const n of team0.filter((x) => x !== mole0)) await expect(room.page(n).getByTestId('mole-objective')).toHaveCount(0)

  const shot = new Set<string>()
  const snap = async (page: Page, name: string) => {
    if (!SHOTS || shot.has(name)) return
    shot.add(name)
    await page.waitForTimeout(450)
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
  }

  let accused = false
  const accusers = new Set<string>()
  let sawVerdict = false
  const seenPhases = new Set<string>()
  for (let loop = 0; loop < 400; loop++) {
    if (await room.host.getByTestId('results').isVisible().catch(() => false)) break
    let acted = false
    for (const p of room.players) {
      const page = p.page
      const phase = await phaseOf(page)
      if (!phase) continue
      if (!seenPhases.has(phase) && process.env.MOLE_DEBUG) console.log('phase', phase, loop)
      seenPhases.add(phase)
      const role = roles[p.name] === 'mole' ? 'mole' : 'loyal'
      if (phase === 'briefing') await snap(page, `01-briefing-${role}`)
      if (phase === 'challenge') {
        const label = (await page.locator('h2').first().textContent().catch(() => '')) ?? ''
        await snap(page, `02-challenge-${label.replace(/\W+/g, '-').toLowerCase()}-${role}`)
        await expectNoHorizontalScroll(page)
        acted = (await playInput(page)) || acted
      } else if (phase === 'debrief') {
        await snap(page, `03-debrief-${role}`)
        // Team 0's loyal players gang up on their mole once.
        if (!accused && team0.includes(p.name) && p.name !== mole0) {
          const btn = page.getByTestId(/^mole-accuse-/).filter({ hasText: mole0 })
          if (await btn.isVisible().catch(() => false)) {
            await btn.click()
            acted = true
            const others = team0.filter((n) => n !== mole0 && n !== p.name)
            for (const o of others) await room.page(o).getByTestId(/^mole-accuse-/).filter({ hasText: mole0 }).click()
            accused = true
            for (const n of [p.name, ...others]) accusers.add(n)
            continue
          }
        }
        const pass = page.getByTestId('mole-pass')
        if (accusers.has(p.name) && !sawVerdict) continue
        if (await pass.isVisible().catch(() => false) && !/voted|✔/.test((await pass.textContent()) ?? '')) {
          await pass.click()
          acted = true
        }
      } else if (phase === 'verdict') {
        sawVerdict = true
        await snap(page, `04-verdict-${role}`)
      } else if (phase === 'finalHunt') {
        await snap(page, `05-final-hunt-${role}`)
        const opt = page.locator('[data-testid^="mole-final-"]').first()
        if (await opt.isVisible().catch(() => false) && !(await page.getByText('my pick').isVisible().catch(() => false))) {
          await opt.click()
          acted = true
        }
      } else if (phase === 'unmasking') {
        await snap(page, `06-unmasking-${role}`)
        if (p.page === room.host) {
          await room.host.getByTestId('mole-finish').click({ timeout: 5_000 })
          acted = true
        }
      }
    }
    if (!acted) await room.host.waitForTimeout(400)
  }

  await waitForResults(room.host, 60_000)
  if (SHOTS) await room.host.screenshot({ path: `${SHOTS}/07-results.png`, fullPage: true })
  expect(accused).toBe(true)
  expect(sawVerdict).toBe(true)
  for (const ph of ['briefing', 'challenge', 'debrief', 'verdict', 'unmasking']) expect(seenPhases).toContain(ph)

  // Hidden information over the wire: no non-mole phone ever received a mission,
  // insider intel, or an employer before the unmasking.
  for (const p of room.players) {
    const views = audits.get(p.name) ?? []
    expect(views.length).toBeGreaterThan(5)
    if (roles[p.name] === 'mole') {
      expect(views.some((v) => /"objective":"/.test(v.raw))).toBe(true)
      continue
    }
    for (const v of views) {
      if (v.phase === 'unmasking') continue
      expect(v.raw).not.toMatch(/"objective":"/)
      expect(v.raw).not.toContain('employerTeamId')
      expect(v.raw).not.toContain('"tone":"mole"')
    }
  }
  for (const page of room.pages) await expectNoHorizontalScroll(page)
  await room.close()
})

test('debrief and challenge controls are thumb-sized on a phone', async ({ browser }) => {
  test.setTimeout(180_000)
  const room = await createRoom(browser, { players: 6 })
  await pickGame(room.host, 'the-mole', { rounds: 4, pace: 'Quick' })
  await setTeams(room, [['Asha', 'Chen', 'Esha'], ['Ben', 'Dev', 'Farhan']])
  await startGame(room)
  const page = room.page('Chen')
  await expect(page.getByTestId('mole-screen')).toHaveAttribute('data-phase', 'challenge', { timeout: 20_000 })
  await expectNoHorizontalScroll(page)
  await expectTapTargets(page)
  await room.close()
})
