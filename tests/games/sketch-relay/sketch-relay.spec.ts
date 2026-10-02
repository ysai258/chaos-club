import { test, expect, type Page } from '@playwright/test'
import { createRoom, setTeams, pickGame, startGame, waitForResults, expectNoHorizontalScroll, expectTapTargets } from '../../helpers/e2e.ts'

const SHOTS = process.env.SHOTS_DIR ?? '/tmp/claude-1000/-home-yashwanth-Desktop-fun-friendzone/38d1d29a-80cc-448d-89a1-0f06ddfe8863/scratchpad/shots/sketch-relay'

const root = (p: Page) => p.getByTestId('sketch-relay')
const role = (p: Page) => root(p).getAttribute('data-role')

async function rolesOf(pages: Page[]) {
  const out = { drawers: [] as Page[], seers: [] as Page[], rivals: [] as Page[] }
  for (const p of pages) {
    const r = await role(p)
    if (r === 'drawer') out.drawers.push(p)
    else if (r === 'seer') out.seers.push(p)
    else out.rivals.push(p)
  }
  return out
}

/** One real stroke through pointer events: press, drag through `pts` (0..1 of the canvas), lift. */
async function drawStroke(page: Page, pts: [number, number][]) {
  const canvas = page.getByTestId('sketch-canvas')
  await expect(canvas).toHaveAttribute('data-can-draw', 'yes')
  const box = (await canvas.boundingBox())!
  const at = ([x, y]: [number, number]) => [box.x + x * box.width, box.y + y * box.height] as const
  const [sx, sy] = at(pts[0]!)
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  for (const p of pts.slice(1)) {
    const [x, y] = at(p)
    await page.mouse.move(x, y, { steps: 8 })
  }
  await page.mouse.up()
}

async function strokesShown(page: Page): Promise<number> {
  const t = (await page.getByTestId('sr-strokes').textContent()) ?? ''
  return Number(/(\d+)\//.exec(t)?.[1] ?? 0)
}

test('Silent Sketch Relay: a full game on four phones', async ({ browser }) => {
  test.setTimeout(150_000)
  const room = await createRoom(browser, { players: 4 })
  try {
    await setTeams(room, [['Asha', 'Ben'], ['Chen', 'Dev']])
    await pickGame(room.host, 'sketch-relay', { roundsPerTeam: 1, strokesPerRound: 6, chaos: false })
    await startGame(room)

    for (let round = 0; round < 2; round++) {
      for (const p of room.pages) await expect(root(p)).toHaveAttribute('data-phase', 'pick')
      const { drawers, seers, rivals } = await rolesOf(room.pages)
      expect(drawers).toHaveLength(1) // teams of 2: one drawer, one blindfolded Seer
      expect(seers).toHaveLength(1)
      expect(rivals).toHaveLength(2)
      const drawer = drawers[0]!
      const seer = seers[0]!
      const rival = rivals[0]!

      // Only the drawer sees the choices.
      await expect(drawer.getByTestId('sr-option-0')).toBeVisible()
      await expect(seer.getByTestId('sr-option-0')).toHaveCount(0)
      await expect(rival.getByTestId('sr-option-0')).toHaveCount(0)
      if (round === 0) await drawer.screenshot({ path: `${SHOTS}/1-pick-drawer.png` })
      if (round === 0) await seer.screenshot({ path: `${SHOTS}/1-pick-seer.png` })
      await drawer.getByTestId('sr-option-1').click()
      for (const p of room.pages) await expect(root(p)).toHaveAttribute('data-phase', 'draw')

      const prompt = (await drawer.getByTestId('sr-prompt').textContent())!.trim()
      expect(prompt.length).toBeGreaterThan(0)
      // The secret is not on the Seer's or the rivals' screens.
      for (const p of [seer, ...rivals]) {
        expect(await p.locator('body').innerText()).not.toContain(prompt)
        await expect(p.getByTestId('sr-prompt')).toHaveCount(0)
      }

      // Stroke 1: a big circle-ish loop. Turn passes on finger-up.
      const shapes: [number, number][][] = round === 0
        ? [[[0.2, 0.75], [0.5, 0.12], [0.8, 0.75], [0.2, 0.75]], [[0.12, 0.8], [0.5, 0.9], [0.88, 0.8]]]
        : [[[0.2, 0.5], [0.45, 0.3], [0.7, 0.5], [0.45, 0.7], [0.2, 0.5]], [[0.7, 0.5], [0.88, 0.35], [0.88, 0.65], [0.7, 0.5]]]
      await drawStroke(drawer, shapes[0]!)
      await expect.poll(() => strokesShown(rival)).toBe(2)
      // Stroke 2: the solo drawer goes again (relay with yourself).
      await drawStroke(drawer, shapes[1]!)
      await expect.poll(() => strokesShown(rival)).toBe(3)

      // Everyone sees the same ink: the rival's canvas has non-paper pixels.
      const inked = await rival.getByTestId('sketch-canvas').evaluate((c: HTMLCanvasElement) => {
        const ctx = c.getContext('2d')!
        const d = ctx.getImageData(0, 0, c.width, c.height).data
        let n = 0
        for (let i = 0; i < d.length; i += 16) if (d[i]! < 200 || d[i + 1]! < 200) n++
        return n
      })
      expect(inked).toBeGreaterThan(50)

      // Rival fires a wrong guess; everyone sees it struck through.
      await rival.getByTestId('sr-guess').fill('xylophone submarine')
      await rival.getByTestId('sr-guess-send').click()
      await expect(seer.getByText('xylophone submarine')).toBeVisible()
      await expect(drawer.getByText('xylophone submarine')).toBeVisible()
      // Drawers have no guess box.
      await expect(drawer.getByTestId('sr-guess')).toHaveCount(0)

      if (round === 0) {
        // Mid-turn: drawer has the pen again, rival is typing.
        await expect(drawer.getByTestId('sketch-canvas')).toHaveAttribute('data-can-draw', 'yes')
        await drawer.screenshot({ path: `${SHOTS}/2-drawing-drawer.png` })
        await rival.getByTestId('sr-guess').fill('a jhola?')
        await rival.screenshot({ path: `${SHOTS}/3-guessing-rival.png` })
        await seer.screenshot({ path: `${SHOTS}/3-guessing-seer.png` })
        await expectNoHorizontalScroll(drawer)
        await expectNoHorizontalScroll(rival)
        await expectTapTargets(drawer)
        await expectTapTargets(rival)
        await rival.getByTestId('sr-guess').fill('')
      }

      // Round 0: the Seer cracks it. Round 1: a rival steals it, in sloppy caps.
      const winner = round === 0 ? seer : rival
      await winner.waitForTimeout(1000) // per-player guess cooldown
      await winner.getByTestId('sr-guess').fill(round === 0 ? prompt : `  ${prompt.toUpperCase()}!! `)
      await winner.getByTestId('sr-guess-send').click()
      for (const p of room.pages) {
        await expect(root(p)).toHaveAttribute('data-phase', 'reveal')
        await expect(p.getByTestId('sr-result')).toContainText(prompt)
      }
      await expect(winner.getByTestId('sr-result')).toContainText(round === 0 ? 'Cracked by' : 'STOLEN by')
      if (round === 0) await rival.screenshot({ path: `${SHOTS}/4-reveal.png` })
      if (round === 1) await seer.screenshot({ path: `${SHOTS}/4-reveal-steal.png` })
    }

    // Gallery after the last reveal.
    for (const p of room.pages) await expect(root(p)).toHaveAttribute('data-phase', 'gallery', { timeout: 15_000 })
    await expect(room.host.getByTestId('sr-gallery-item')).toHaveCount(2)
    await room.host.screenshot({ path: `${SHOTS}/5-gallery.png`, fullPage: true })
    await expectNoHorizontalScroll(room.host)
    await expect(room.pages[2]!.getByTestId('sr-finish')).toHaveCount(0)
    // Save a drawing as PNG.
    const download = room.host.waitForEvent('download')
    await room.host.getByTestId('sr-gallery-item').first().getByRole('button', { name: /Save/ }).click()
    expect((await download).suggestedFilename()).toMatch(/\.png$/)
    await room.host.getByTestId('sr-finish').click()
    for (const p of room.pages) await waitForResults(p)
    await room.host.screenshot({ path: `${SHOTS}/6-results.png` })
  } finally {
    await room.close()
  }
})
