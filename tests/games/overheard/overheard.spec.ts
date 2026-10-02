import { test, expect, type Page } from '@playwright/test'
import { createRoom, setTeams, pickGame, startGame, waitForResults, expectNoHorizontalScroll, type E2ERoom } from '../../helpers/e2e.ts'

/**
 * Four phones, two teams, a full game of Overheard:
 *   Round 1: both teams decode, interception is closed.
 *   Round 2 (Ben's team transmits first): Chai team intercepts, Ben's team decodes.
 *   Round 2 second half: Asha's team miscommunicates.
 *   Round 3: Asha's team intercepts again → two wiretaps, game over.
 * Along the way: secrets are absent from rival phones, and nothing scrolls sideways.
 */

const SHOTS = process.env.OVERHEARD_SHOTS

const TEAM_A = ['Asha', 'Chen']
const TEAM_B = ['Ben', 'Dev']

async function waitPhase(room: E2ERoom, p: string) {
  for (const page of room.pages) await expect(page.getByTestId('overheard')).toHaveAttribute('data-phase', p, { timeout: 20_000 })
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return
  await page.waitForTimeout(700) // let pop-in animations settle
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

/** The phones whose screen shows the clue writer, with their secret code. */
async function encryptors(room: E2ERoom): Promise<{ page: Page; name: string; code: number[] }[]> {
  const out: { page: Page; name: string; code: number[] }[] = []
  for (const pl of room.players) {
    const code = pl.page.getByTestId('my-code')
    if ((await code.count()) > 0) {
      const raw = (await code.getAttribute('data-code'))!
      out.push({ page: pl.page, name: pl.name, code: raw.split('-').map(Number) })
    }
  }
  return out
}

const swap = (c: number[]) => [c[1]!, c[0]!, c[2]!]

async function pickCode(page: Page, code: number[]) {
  for (let i = 0; i < 3; i++) {
    const btn = page.getByRole('radio', { name: `Clue ${i + 1} is ${code[i]}` })
    await btn.click()
    await expect(btn).toHaveAttribute('aria-checked', 'true')
  }
  const lock = page.getByRole('button', { name: /^Lock in/ })
  await lock.click()
  await page.getByRole('button', { name: /^Sure\? Lock/ }).click()
  await expect(page.getByRole('button', { name: /^Sure\? Lock/ })).toHaveCount(0)
}

interface Plan {
  decode: boolean
  /** undefined = interception closed this round. */
  intercept?: boolean
}

/** Read clues aloud, guess, and get through the reveal for the current transmission. */
async function playTransmission(room: E2ERoom, codes: Map<string, number[]>, plan: Plan, label: string) {
  await waitPhase(room, 'transmit')
  // Who is on air?
  let onAir: { page: Page; name: string } | undefined
  for (const pl of room.players) {
    if ((await pl.page.getByTestId('onair-clue').count()) > 0) onAir = pl
  }
  expect(onAir, 'someone is on air').toBeTruthy()
  const team = TEAM_A.includes(onAir!.name) ? TEAM_A : TEAM_B
  const rivals = team === TEAM_A ? TEAM_B : TEAM_A
  const code = codes.get(onAir!.name)!
  const listener = room.page(rivals[0]!)

  for (let i = 0; i < 3; i++) {
    const clue = (await onAir!.page.getByTestId('onair-clue').textContent())!.replace(/[“”]/g, '')
    if (i === 1) await shot(onAir!.page, `${label}-onair-encryptor`)
    await onAir!.page.getByRole('button', { name: /I said it/ }).click()
    // the clue pops up on the rival's phone
    await expect(listener.getByText(clue).first()).toBeVisible()
    if (i === 1) await shot(listener, `${label}-onair-listener`)
  }
  await waitPhase(room, 'guess')

  const decoder = room.page(team.find((n) => n !== onAir!.name)!)
  const interceptor = room.page(rivals[1]!)
  if (plan.intercept === undefined) {
    await expect(interceptor.getByText(/Interception opens in round/)).toBeVisible()
    await expect(interceptor.getByRole('radio', { name: /Clue 1 is/ })).toHaveCount(0)
  } else {
    await expect(interceptor.getByRole('heading', { name: 'Intercept their code!' })).toBeVisible()
    await shot(interceptor, `${label}-intercept`)
    await pickCode(interceptor, plan.intercept ? code : swap(code))
  }
  await expect(decoder.getByRole('heading', { name: 'Crack your own code' })).toBeVisible()
  await shot(decoder, `${label}-decode`)
  // the encryptor can't guess
  await expect(onAir!.page.getByRole('radio', { name: /Clue 1 is/ })).toHaveCount(0)
  await pickCode(decoder, plan.decode ? code : swap(code))

  await waitPhase(room, 'reveal')
  const stamp = plan.intercept ? 'WIRETAPPED!' : plan.decode ? 'DECODED' : 'STATIC!'
  for (const page of room.pages) await expect(page.getByTestId('stamp')).toContainText(stamp)
  await shot(listener, `${label}-reveal`)
  // host skips ahead (Asha is host), unless the game just ended
  const next = room.host.getByRole('button', { name: /Next/ })
  if (await next.isVisible()) await next.click()
}

async function writeClues(room: E2ERoom, round: number, codes: Map<string, number[]>, label: string) {
  await waitPhase(room, 'encrypt')
  const encs = await encryptors(room)
  expect(encs).toHaveLength(2)
  expect(new Set(encs.map((e) => (TEAM_A.includes(e.name) ? 'A' : 'B'))).size).toBe(2)
  for (const e of encs) codes.set(e.name, e.code)

  // non-encryptors never see a code
  for (const pl of room.players) {
    if (!encs.some((e) => e.name === pl.name)) await expect(pl.page.getByTestId('my-code')).toHaveCount(0)
  }

  for (const [k, e] of encs.entries()) {
    if (k === 0) await shot(e.page, `${label}-encrypt`)
    for (let i = 0; i < 3; i++) await e.page.getByTestId(`clue-${i}`).fill(`r${round}${e.name.toLowerCase()}${i}`)
    // the draft is private: no other phone shows it
    for (const pl of room.players) if (pl.page !== e.page) await expect(pl.page.getByText(`r${round}${e.name.toLowerCase()}0`)).toHaveCount(0)
    await e.page.getByRole('button', { name: 'Send clues' }).click()
    if (k === 0) await shot(room.page(TEAM_A.includes(e.name) ? TEAM_A.find((n) => n !== e.name)! : TEAM_B.find((n) => n !== e.name)!), `${label}-waiting`)
  }
}

test('Overheard: a full game on four phones', async ({ browser }) => {
  test.setTimeout(240_000)
  const room = await createRoom(browser, { players: 4, names: ['Asha', 'Ben', 'Chen', 'Dev'] })
  try {
    await pickGame(room.host, 'overheard')
    await setTeams(room, [TEAM_A, TEAM_B])
    await startGame(room)
    await waitPhase(room, 'encrypt')

    // ---- hidden information: each team's keywords are absent from the rival phones
    const words = async (name: string) => Promise.all([1, 2, 3, 4].map(async (i) => (await room.page(name).getByTestId(`kw-${i}`).textContent())!.trim()))
    const aWords = await words('Asha')
    const bWords = await words('Ben')
    expect(await words('Chen')).toEqual(aWords)
    expect(await words('Dev')).toEqual(bWords)
    for (const name of TEAM_B) {
      const html = await room.page(name).content()
      for (const w of aWords) expect(html).not.toContain(`>${w}<`)
    }
    for (const name of TEAM_A) {
      const html = await room.page(name).content()
      for (const w of bWords) expect(html).not.toContain(`>${w}<`)
    }
    for (const page of room.pages) await expectNoHorizontalScroll(page)

    const codes = new Map<string, number[]>()
    // ---- round 1: interception closed; A then B
    await writeClues(room, 1, codes, 'r1')
    await playTransmission(room, codes, { decode: true }, 'r1a')
    await playTransmission(room, codes, { decode: true }, 'r1b')

    // ---- round 2: B first. A intercepts B. Then A miscommunicates.
    await writeClues(room, 2, codes, 'r2')
    await playTransmission(room, codes, { decode: true, intercept: true }, 'r2b')
    await playTransmission(room, codes, { decode: false, intercept: false }, 'r2a')
    for (const page of room.pages) await expectNoHorizontalScroll(page)

    // ---- round 3: A first. A decodes, then intercepts B again → 2 wiretaps
    await writeClues(room, 3, codes, 'r3')
    await playTransmission(room, codes, { decode: true, intercept: false }, 'r3a')
    await playTransmission(room, codes, { decode: true, intercept: true }, 'r3b')

    for (const page of room.pages) await waitForResults(page)
    await shot(room.page('Dev'), 'results')
    await expect(room.host.getByTestId('results')).toContainText(/wiretapped two codes/)
  } finally {
    await room.close()
  }
})
