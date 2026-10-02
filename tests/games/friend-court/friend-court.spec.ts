import { test, expect, type Page } from '@playwright/test'
import {
  createRoom, setTeams, pickGame, startGame, waitForResults, expectNoHorizontalScroll, expectTapTargets, type E2ERoom,
} from '../../helpers/e2e.ts'

const SHOTS = process.env.FC_SHOTS_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

/** The first page for which `testId` is visible right now (polls until timeout). */
async function findPage(room: E2ERoom, testId: string, timeout = 15_000): Promise<Page> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    for (const p of room.pages) if (await p.getByTestId(testId).first().isVisible().catch(() => false)) return p
    await room.host.waitForTimeout(150)
  }
  throw new Error(`no page shows ${testId}`)
}

async function role(page: Page): Promise<string | null> {
  return page.getByTestId('fc-role').getAttribute('data-role').catch(() => null)
}

test('Friend Court: 4 phones, 2 teams, a full game with evidence, notes, objections and verdicts', async ({ browser }) => {
  test.setTimeout(240_000)
  const room = await createRoom(browser, { players: 4 })
  await setTeams(room, [['Asha', 'Chen'], ['Ben', 'Dev']])
  await pickGame(room.host, 'friend-court', { cases: '2 cases (~7 min)', pace: 'Snappy (30s / 20s)' })
  await startGame(room)

  for (let k = 1; k <= 2; k++) {
    // ---- Reveal: every phone sees the case and its own role; 4 players -> one judge sits out.
    for (const p of room.pages) {
      await expect(p.getByTestId('fc-screen')).toHaveAttribute('data-phase', 'reveal', { timeout: 20_000 })
      await expect(p.getByText(`Case ${k} of 2`)).toBeVisible()
    }
    const roles = await Promise.all(room.pages.map(role))
    expect(roles.filter((r) => r === 'judge')).toHaveLength(1)
    expect(roles.filter((r) => r === 'prosecution').length).toBeGreaterThan(0)
    expect(roles.filter((r) => r === 'defence').length).toBeGreaterThan(0)
    if (k === 1) {
      for (const p of room.pages) await expectNoHorizontalScroll(p)
      await shot(room.pages[roles.indexOf('defence')]!, 'e2e-01-reveal')
    }
    const judge = await findPage(room, 'fc-begin')
    await judge.getByTestId('fc-begin').click()

    // ---- Four speeches.
    for (let s = 0; s < 4; s++) {
      const speaker = await findPage(room, 'fc-speaker')
      const firstCard = speaker.getByTestId('fc-speaker').locator('.font-display.text-\\[15px\\]').first()
      const secretText = (await firstCard.textContent())!.trim()
      // Hidden information: nobody else can see the speaker's unplayed card.
      for (const p of room.pages) {
        if (p === speaker) continue
        await expect(p.getByText(secretText, { exact: true })).toHaveCount(0)
      }
      // A teammate (if this side has a spare one) slips the speaker a note.
      let notePasser: Page | null = null
      for (const p of room.pages) if (p !== speaker && (await p.getByTestId('fc-note').first().isVisible())) { notePasser = p; break }
      if (notePasser) {
        await notePasser.getByTestId('fc-note').first().click()
        await expect(speaker.getByText(/note from/).first()).toBeVisible()
        if (k === 1) await shot(speaker, 'e2e-04b-speaker-got-note')
      }
      await speaker.getByTestId('fc-speaker').getByTestId('fc-card').filter({ hasText: secretText }).first().getByTestId('fc-play').click()
      // Once presented it is on the record for everyone.
      for (const p of room.pages) await expect(p.getByTestId('fc-screen').getByText(secretText).first()).toBeVisible()

      if (s === 0) {
        // Opponent objects, judge rules.
        const objector = await findPage(room, 'fc-object')
        if (k === 1) await shot(objector, 'e2e-02-speech-opponent')
        await objector.getByTestId('fc-object').click()
        await expect(judge.getByTestId('fc-sustain')).toBeVisible()
        if (k === 1) await shot(judge, 'e2e-03-objection-judge')
        await judge.getByTestId(k === 1 ? 'fc-sustain' : 'fc-overrule').click()
        await expect(speaker.getByTestId('fc-speaker')).toBeVisible()
        if (k === 1) await expect(speaker.getByText('STRUCK', { exact: true })).toBeVisible()
      }
      if (k === 1 && s === 0) await shot(speaker, 'e2e-04-speaker')
      await speaker.getByTestId('fc-rest').click()
      await expect(speaker.getByTestId('fc-speaker')).toHaveCount(0)
    }

    // ---- Deliberation: judge rules, both sides vote respect.
    for (const p of room.pages) await expect(p.getByTestId('fc-screen')).toHaveAttribute('data-phase', 'deliberation')
    for (const p of room.pages) {
      if (await p.getByTestId('fc-respect').isVisible()) await p.getByTestId('fc-respect-target').first().click()
    }
    const guilty = k === 1
    await judge.getByTestId(guilty ? 'fc-guilty' : 'fc-not-guilty').click()
    if (k === 1) await shot(judge, 'e2e-05-judge-verdict')
    await judge.getByTestId('fc-sentence').nth(1).click()

    for (const p of room.pages) await expect(p.getByTestId('fc-verdict')).toHaveAttribute('data-guilty', String(guilty))
    if (k === 1) await shot(room.host, 'e2e-06-verdict')
  }

  await waitForResults(room.host, 30_000)
  for (const p of room.pages) await waitForResults(p, 10_000)
  await shot(room.host, 'e2e-07-results')
  await expect(room.host.getByTestId('results')).toContainText(/GUILTY/)
  await room.close()
})

test('Friend Court: phone layout has no sideways scroll and big tap targets during a speech', async ({ browser }) => {
  const room = await createRoom(browser, { players: 4 })
  await pickGame(room.host, 'friend-court', { pace: 'Snappy (30s / 20s)', cases: '2 cases (~7 min)' })
  await startGame(room)
  const judge = await findPage(room, 'fc-begin')
  await judge.getByTestId('fc-begin').click()
  const speaker = await findPage(room, 'fc-speaker')
  for (const p of room.pages) {
    await expectNoHorizontalScroll(p)
    await expectTapTargets(p.getByTestId('game-view').page())
  }
  void speaker
  await room.close()
})
