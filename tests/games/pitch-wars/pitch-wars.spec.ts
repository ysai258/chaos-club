import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import {
  createRoom, expectNoHorizontalScroll, expectTapTargets, pickGame, setTeams, startGame, waitForResults,
} from '../../helpers/e2e.ts'

const SHOTS = process.env.PW_SHOTS ?? '/tmp/claude-1000/-home-yashwanth-Desktop-fun-friendzone/38d1d29a-80cc-448d-89a1-0f06ddfe8863/scratchpad/shots/pitch-wars'
mkdirSync(SHOTS, { recursive: true })
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
const fullShot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })

async function findPage(pages: Page[], testId: string): Promise<Page> {
  await expect.poll(async () => {
    for (const p of pages) if (await p.getByTestId(testId).isVisible()) return true
    return false
  }, { timeout: 15_000 }).toBe(true)
  for (const p of pages) if (await p.getByTestId(testId).isVisible()) return p
  throw new Error(`no page shows ${testId}`)
}

test('4 phones, 2 teams: prep, pitch, grill, curveball, cheques, deal reveal, results', async ({ browser }) => {
  test.setTimeout(240_000)
  const room = await createRoom(browser, { players: 4 })
  const [asha, ben, chen, dev] = [room.page('Asha'), room.page('Ben'), room.page('Chen'), room.page('Dev')]
  await setTeams(room, [['Asha', 'Chen'], ['Ben', 'Dev']])
  await pickGame(room.host, 'pitch-wars', { rounds: 1, prepSeconds: 60, pitchSeconds: 45 })
  await startGame(room)

  // ---- prep: every phone gets its own team's cards
  for (const p of room.pages) await expect(p.getByTestId('pw-prep')).toBeVisible()
  const ashaProduct = (await asha.getByTestId('pw-product').textContent())!.trim()
  const benProduct = (await ben.getByTestId('pw-product').textContent())!.trim()
  await expect(chen.getByTestId('pw-product')).toHaveText(ashaProduct)
  expect(await ben.content()).not.toContain(ashaProduct)
  expect(await asha.content()).not.toContain(benProduct)

  await asha.getByTestId('pw-name').fill('ChaiCoin')
  await asha.getByTestId('pw-slogan').fill('Sip. Mine. Repeat.')
  await asha.getByTestId('pw-price').fill('₹99/month')
  await asha.getByRole('radio', { name: '🐐' }).click()
  await asha.getByRole('radio', { name: '₹2 cr' }).click()
  await asha.getByTestId('pw-name').blur()
  // the teammate sees the draft live, the rivals never do
  await expect(chen.getByTestId('pw-name')).toHaveValue('ChaiCoin')
  await expect(chen.getByTestId('pw-poster')).toContainText('ChaiCoin')
  await ben.getByTestId('pw-name').fill('GossipGPT')
  await ben.getByTestId('pw-name').blur()
  await expect(dev.getByTestId('pw-name')).toHaveValue('GossipGPT')
  expect(await ben.content()).not.toContain('ChaiCoin')
  expect(await asha.content()).not.toContain('GossipGPT')

  await expectNoHorizontalScroll(asha)
  await expectTapTargets(asha)
  await shot(asha, '01-prep-top')
  await fullShot(asha, '02-prep-full')

  await asha.getByTestId('pw-ready').click()
  await expect(ben.getByText('READY ✅')).toBeVisible()
  await ben.getByTestId('pw-ready').click()

  // ---- two pitches, one per team
  for (let pitch = 0; pitch < 2; pitch++) {
    const pitcher = await findPage(room.pages, 'pw-start')
    const pitchingTeam = [asha, chen].includes(pitcher) ? [asha, chen] : [ben, dev]
    const sharks = room.pages.filter((p) => !pitchingTeam.includes(p))
    if (pitch === 0) {
      await shot(pitcher, '03-stage-pitcher')
      await shot(sharks[0]!, '04-stage-shark')
    }
    await pitcher.getByTestId('pw-start').click()
    for (const p of room.pages) await expect(p.getByTestId('pw-pitch')).toBeVisible()
    // the poster is now public
    const name = pitch === 0 ? 'ChaiCoin' : 'GossipGPT'
    for (const s of sharks) await expect(s.getByTestId('pw-poster')).toContainText(name)

    // sharks grill
    const s0 = sharks[0]!
    const q = s0.getByTestId('pw-question').first()
    const qText = (await q.textContent())!.replace(/^🎯/, '').trim()
    await q.click()
    await expect(pitcher.getByTestId('pw-fired').first()).toContainText(qText)
    if (pitch === 0) await shot(s0, '05-pitch-shark-tools')
    await sharks[1]!.getByTestId('pw-curveball').first().click()
    await sharks[1]!.getByTestId('pw-throw').click()
    await expect(pitcher.getByTestId('pw-curveball-banner')).toBeVisible()
    await expect(s0.getByTestId('pw-throw')).toHaveCount(0)
    await expectNoHorizontalScroll(pitcher)
    await expectNoHorizontalScroll(s0)
    await expectTapTargets(s0)
    await expectTapTargets(pitcher)
    if (pitch === 0) {
      await pitcher.waitForTimeout(1500) // let the CURVEBALL flash fade
      await shot(pitcher, '06-pitch-teleprompter')
    }
    await pitcher.getByTestId('pw-done').click()

    // ---- cheques
    for (const s of sharks) await expect(s.getByTestId('pw-invest')).toBeVisible()
    await expect(pitcher.getByTestId('pw-invest-wait')).toBeVisible()
    await expectTapTargets(sharks[0]!)
    await expectNoHorizontalScroll(sharks[0]!)
    await sharks[0]!.getByRole('button', { name: '₹3 cr' }).click()
    if (pitch === 0) await shot(sharks[0]!, '07-invest-cheque')
    await sharks[0]!.getByTestId('pw-sign').click()
    // amounts stay secret from everyone else
    await expect(pitcher.getByTestId('pw-signers')).toBeVisible()
    if (pitch === 0) await shot(pitcher, '08-invest-waiting')
    await sharks[1]!.getByRole('button', { name: pitch === 0 ? '₹5 cr' : 'Out 🙅' }).click()
    await sharks[1]!.getByTestId('pw-sign').click()

    // ---- reveal
    for (const p of room.pages) await expect(p.getByTestId('pw-reveal')).toBeVisible()
    await expect(room.host.getByTestId('pw-verdict')).toBeVisible({ timeout: 10_000 })
    if (pitch === 0) {
      // avg(3, 5) = 4 cr ≥ Ask 2 cr → deal, 4 + 1 bonus
      await expect(room.host.getByTestId('pw-verdict')).toHaveText(/DEAL/)
      await expect(room.host.getByTestId('pw-total')).toHaveText('₹4 cr')
      await asha.waitForTimeout(600)
      await shot(asha, '09-reveal-deal')
    } else {
      // avg(3, 0) = 1.5 cr < default Ask 5 cr → no deal
      await expect(room.host.getByTestId('pw-verdict')).toHaveText(/NO DEAL/)
      await asha.waitForTimeout(600)
      await shot(asha, '10-reveal-nodeal')
    }
    await room.host.getByTestId('pw-next').click()
  }

  // ---- results
  for (const p of room.pages) await waitForResults(p)
  await expect(room.host.getByTestId('results')).toContainText(/ChaiCoin|GossipGPT/)
  await room.host.waitForTimeout(1500)
  await shot(room.host, '11-results')
  await room.close()
})
