import { test, expect, type Page } from '@playwright/test'
import { setUpLobby, start, startFilm, tap, type Film } from '../kit.ts'

/**
 * How to play Bomb Squad. Asha's team defuses a bomb on camera (one deliberate
 * strike), Ben's team blows theirs up inside a cut, then the results.
 *
 * The bomb is random, so the script adapts: the defuser plays from the answers
 * on a spectator's phone, and what people "say" is built from the real bomb.
 */

const NAMES = ['Asha', 'Ben', 'Chen', 'Dev', 'Esha', 'Farhan']
const TEAMS = [['Asha', 'Chen', 'Esha'], ['Ben', 'Dev', 'Farhan']]
const GAME = 'bomb-squad'

const N = {
  intro: 'Bomb Squad! One friend holds a ticking bomb, the rest of the team holds the manual. Nobody sees both, so you talk.',
  lobby: 'The host picks Bomb Squad and makes two teams. For a first game, one round on the relaxed fuse is plenty.',
  briefButton: 'Asha’s team goes first, and Asha is the defuser. Only her phone will show the bomb. Inside: wires and a panic button.',
  briefWheels: 'Asha’s team goes first, and Asha is the defuser. Only her phone will show the bomb. Inside: wires and a letter lock.',
  briefExperts: 'Chen and Esha are the experts. Each one gets a different page of the manual. Skim it now!',
  briefBet: 'Ben’s team just watches this time. First they bet: defused, or boom? A right bet is worth two points.',
  arm: 'Asha taps Arm it. And now the clock is ticking!',
  roleBomb: 'Asha’s phone: the timer, strikes, serial number, batteries, and the modules. She has to describe all of it.',
  roleManualChen: 'Now Chen’s phone. No bomb here, only rules. Chen has to find the right rule and read it out loud.',
  roleManualEsha: 'Now Esha’s phone. No bomb here, only rules. Esha has to find the right rule and read it out loud.',
  roleSpectator: 'And Ben’s team sees everything: the bomb AND the answers. They can’t help. But they can heckle.',
  describe: 'So Asha describes the wires: how many, and every colour, top to bottom.',
  search: 'The expert types into the search box, and the manual jumps straight to the right rules.',
  strike: 'Oops! Asha didn’t wait for the rule. That’s a strike: the bomb shakes and fifteen seconds vanish off the clock.',
  strikeRules: 'Three strikes and it’s boom. Meanwhile, the other team is enjoying this a little too much.',
  properly: 'Now properly. Go down the list and stop at the first rule that fits.',
  button: 'Next, the panic button. Its colour and its label decide: do you tap it, or hold it?',
  buttonHold: 'Holding lights up a strip. Its colour tells you when to let go, by watching the digits on the timer.',
  wheels: 'Next, the letter lock. Asha spins each wheel and reads the letters. Only one word in the manual fits.',
  defused: 'Defused! Everybody breathes again.',
  score: 'Scoring: three points a module, five for defusing, and a bonus for every twenty seconds left on the clock.',
  next: 'Then the teams swap. Ben’s team gets a brand new bomb, and Ben is on defuser duty.',
  betBoom: 'Now Asha’s team bets. They watched Ben describe a sandwich once. They bet boom.',
  boom: 'Three strikes. BOOM! No modules, no points for Ben’s team. And Asha’s team wins the bet.',
  rotate: 'In longer games the defuser changes every round, so everyone gets a turn holding the bomb.',
  results: 'Final scores! The team that talks clearly wins. Not the team that shouts loudest. Usually.',
  outro: 'That’s Bomb Squad. Get your friends on a call, grab your phones, and talk fast!',
}

const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
const STRIP: Record<string, (t: string) => boolean> = {
  Red: (t) => t.includes('3'),
  Blue: (t) => t.includes('5'),
  Yellow: (t) => t.endsWith('0'),
  White: (t) => t[t.length - 1] === t[t.length - 2],
  Pink: (t) => t.includes('1'),
}
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six']

const root = (p: Page) => p.getByTestId('bomb-squad')
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** Bubble time that scales with the text, so long rules stay readable. */
const readMs = (text: string) => Math.max(2600, Math.min(6500, text.length * 55))

async function waitPhase(film: Film, phase: string) {
  for (const p of film.room.pages) await expect(root(p)).toHaveAttribute('data-phase', phase, { timeout: 30_000 })
}

async function roleOf(film: Film, name: string) {
  return root(film.page(name)).getAttribute('data-role')
}

async function scrollTo(page: Page, testId: string, block: ScrollLogicalPosition = 'center') {
  await page.getByTestId(testId).first().evaluate((el, b) => el.scrollIntoView({ block: b, behavior: 'smooth' }), block)
}

async function scrollTop(page: Page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
}

interface ModInfo { i: number; kind: string; answer: string }

/** What the spectator sees: module kinds and answer stickers. */
async function readModules(spec: Page): Promise<ModInfo[]> {
  const mods = spec.locator('[data-kind]')
  const n = await mods.count()
  const out: ModInfo[] = []
  for (let i = 0; i < n; i++) {
    const m = spec.getByTestId(`module-${i}`)
    out.push({ i, kind: (await m.getAttribute('data-kind'))!, answer: (await m.getByTestId('answer').innerText()).replace(/\s+/g, ' ') })
  }
  return out
}

async function wireColors(defuser: Page, i: number): Promise<string[]> {
  const labels = await defuser.getByTestId(`module-${i}`).locator('[data-testid^="wire-"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  return labels.map((l) => /Wire \d+, (\w+)/.exec(l)![1]!)
}

async function cutWire(defuser: Page, i: number, w: number) {
  const card = defuser.getByTestId(`module-${i}`)
  // A strike shakes (and remounts) the bomb, which hops back to the first unsolved module.
  if (!(await card.isVisible())) { await tap(defuser.getByTestId(`module-tab-${i}`)); await sleep(500) }
  await tap(card.getByTestId(`wire-${w}`))
  await sleep(700)
  await tap(card.getByTestId('cut-wire'))
}

/** Hold the big button and let go when the timer matches the strip colour. */
async function holdAndRelease(defuser: Page, i: number, color: string, onStrip: () => Promise<void>) {
  const card = defuser.getByTestId(`module-${i}`)
  const btn = card.getByTestId('big-button')
  await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const box = (await btn.boundingBox())!
  await defuser.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await defuser.mouse.down()
  await expect(card.getByTestId('strip')).toHaveCSS('animation-name', /pulse/, { timeout: 5000 })
  await onStrip()
  const timer = defuser.getByTestId('bomb-timer')
  for (let k = 0; k < 600; k++) {
    const t = (await timer.textContent())!.trim()
    if (STRIP[color]!(t)) {
      await sleep(150)
      if (STRIP[color]!((await timer.textContent())!.trim())) break
    }
    await sleep(60)
  }
  await defuser.mouse.up()
}

async function quickTap(defuser: Page, i: number) {
  await tap(defuser.getByTestId(`module-${i}`).getByTestId('big-button'))
}

async function longPressWrong(defuser: Page, i: number) {
  const btn = defuser.getByTestId(`module-${i}`).getByTestId('big-button')
  await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const box = (await btn.boundingBox())!
  await defuser.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await defuser.mouse.down()
  await sleep(1500)
  await defuser.mouse.up()
}

/** Read every letter on wheel 0 by spinning it once round. */
async function readWheel(defuser: Page, i: number, slot: number): Promise<string[]> {
  const card = defuser.getByTestId(`module-${i}`)
  const w = card.getByTestId(`wheel-${slot}`)
  const letters: string[] = [(await w.textContent())!.trim()]
  for (let k = 0; k < 5; k++) {
    const was = (await w.textContent())!
    await card.getByTestId(`wheel-${slot}-down`).click()
    await expect(w).not.toHaveText(was)
    letters.push((await w.textContent())!.trim())
    await sleep(380)
  }
  // Back to the start.
  const was = (await w.textContent())!
  await card.getByTestId(`wheel-${slot}-down`).click()
  await expect(w).not.toHaveText(was)
  return letters
}

async function spell(defuser: Page, i: number, word: string, stepMs = 260) {
  const card = defuser.getByTestId(`module-${i}`)
  for (let s = 0; s < word.length; s++) {
    const w = card.getByTestId(`wheel-${s}`)
    for (let k = 0; k < 6 && (await w.textContent())!.trim() !== word[s]; k++) {
      const was = await w.textContent()
      await card.getByTestId(`wheel-${s}-down`).click()
      await expect(w).not.toHaveText(was!)
      await sleep(stepMs)
    }
  }
}

async function solved(spec: Page, i: number) {
  await expect.poll(async () => {
    if ((await root(spec).getAttribute('data-phase')) !== 'live') return true
    return (await spec.getByTestId(`module-${i}`).getAttribute('data-solved')) === 'true'
  }, { timeout: 15_000 }).toBe(true)
}

test.use({ actionTimeout: 20_000 })

test(GAME, async ({ browser }) => {
  const film = await startFilm(browser, { game: GAME, names: NAMES, teams: TEAMS, lines: Object.values(N) })
  const host = film.room.host

  // ------------------------------------------------------------- lobby
  film.caption('Getting set up')
  await film.say(N.intro)
  film.focus('Asha')
  await film.sayWhile(N.lobby, () => setUpLobby(film, { game: GAME, teams: TEAMS, settings: { rounds: 1, fuse: 'Relaxed (100s a module)' } }))
  film.bubble('Ben', 'Our team is going to win this!')
  await start(film)
  await waitPhase(film, 'briefing')

  // ------------------------------------------------------------- briefing
  const cast = { defuser: '', experts: [] as string[], spectators: [] as string[] }
  for (const n of NAMES) {
    const r = await roleOf(film, n)
    if (r === 'defuser') cast.defuser = n
    else if (r === 'expert') cast.experts.push(n)
    else if (r === 'spectator') cast.spectators.push(n)
  }
  expect(cast.defuser).toBe('Asha')
  expect(cast.experts).toEqual(['Chen', 'Esha'])
  const asha = film.page('Asha')
  const ben = film.page('Ben')

  const mods = await readModules(ben)
  const wires = mods.find((m) => m.kind === 'wires')!
  const other = mods.find((m) => m.kind !== 'wires')!
  const manualOf = async (n: string) => (await film.page(n).getByTestId('manual').innerText()).toLowerCase()
  const wireExpert = (await manualOf('Chen')).includes('wire spaghetti') ? 'Chen' : 'Esha'
  const otherExpert = wireExpert === 'Chen' ? 'Esha' : 'Chen'

  film.caption('Bomb 1 · The briefing')
  film.focus('Asha')
  film.spotlight('Asha')
  await film.say(other.kind === 'button' ? N.briefButton : N.briefWheels)
  film.spotlight(wireExpert)
  film.focus(cast.experts)
  await film.say(N.briefExperts)
  film.spotlight('Asha')
  film.focus('Asha')
  await film.sayWhile(N.arm, async () => {
    await sleep(1000)
    if ((await root(asha).getAttribute('data-phase')) === 'briefing') await tap(asha.getByTestId('arm'))
    await waitPhase(film, 'live')
  })
  film.spotlight('Ben')
  film.focus(cast.spectators)
  await film.sayWhile(N.briefBet, async () => {
    await sleep(2500)
    await scrollTo(ben, 'predict')
    await sleep(800)
    await tap(ben.getByTestId('predict-boom'))
    film.bubble('Ben', 'Asha? Defusing? We bet BOOM.', 3200)
  })

  // ------------------------------------------------------------- the three views
  film.caption('Who sees what')
  film.spotlight('Asha')
  film.focus('Asha')
  await scrollTop(asha)
  await film.say(N.roleBomb)
  film.spotlight(wireExpert)
  film.focus(wireExpert)
  await film.say(wireExpert === 'Chen' ? N.roleManualChen : N.roleManualEsha)
  film.spotlight('Ben')
  film.focus(cast.spectators)
  await film.sayWhile(N.roleSpectator, async () => {
    await sleep(2500)
    await scrollTo(ben, `module-${wires.i}`, 'start')
  })

  // ------------------------------------------------------------- wires, with a strike
  film.caption('Bomb 1 · Wire Spaghetti')
  film.spotlight('Asha')
  film.focus('Asha')
  await tap(asha.getByTestId(`module-tab-${wires.i}`))
  const colors = await wireColors(asha, wires.i)
  const right = ORD.indexOf(/Cut the (\w+) wire/.exec(wires.answer)![1]!)
  const wrong = right === 0 ? 1 : 0
  await film.say(N.describe)
  await film.shout('Asha', `${NUM[colors.length]![0]!.toUpperCase()}${NUM[colors.length]!.slice(1)} wires! ${colors.join(', ')}.`, 3400)

  const wexp = film.page(wireExpert)
  film.spotlight(wireExpert)
  film.focus(wireExpert)
  await film.sayWhile(N.search, async () => {
    const box = wexp.getByTestId('manual-search')
    await box.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    await sleep(500)
    await box.pressSequentially(`${colors.length} wires`, { delay: 140 })
  })
  film.bubble(wireExpert, `Okay, ${NUM[colors.length]} wires... rule one says...`, 2800)
  await sleep(1400)
  film.spotlight('Asha')
  film.focus('Asha')
  film.bubble('Asha', `Too slow! I'm cutting wire ${wrong + 1}!`, 2600)
  await sleep(900)
  await cutWire(asha, wires.i, wrong)
  await expect(asha.getByTestId('strikes')).toHaveAttribute('aria-label', /^1 of/)
  await sleep(700)
  await tap(asha.getByTestId(`module-tab-${wires.i}`))
  film.bubble(wireExpert, 'ASHA, NO! I wasn’t finished!', 2600)
  await film.say(N.strike)
  film.focus(cast.spectators)
  await film.sayWhile(N.strikeRules, async () => {
    await tap(ben.getByTestId('heckle-chicken'))
    film.bubble('Ben', 'Bawk bawk bawk!', 2400)
    await sleep(1300)
    await tap(film.page('Dev').getByTestId('heckle-airhorn'))
    film.bubble('Farhan', 'Hahaha, one down!', 2400)
    await sleep(1300)
    await tap(film.page('Farhan').getByTestId('heckle-popcorn'))
  })

  // The right way: read the rule that applies.
  film.spotlight(wireExpert)
  film.focus(wireExpert)
  const why = /rule (\d+): (.*)$/.exec(wires.answer)
  const ruleNo = why?.[1] ?? '1'
  const ruleText = (why?.[2] ?? '').replace(/^Otherwise, /, '')
  await film.sayWhile(N.properly, async () => {
    // The strike's shake remounts every screen, which clears the expert's search.
    const box = wexp.getByTestId('manual-search')
    await box.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    await sleep(600)
    await box.fill('')
    await box.pressSequentially(`${colors.length} wires`, { delay: 120 })
    await sleep(900)
    await wexp.getByTestId('manual').locator('li').nth(Number(ruleNo) - 1).evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  })
  const serial = (await asha.getByTestId('serial').textContent())!.trim()
  const batteries = Number(/(\d+) batteries/.exec((await asha.getByTestId('casing').locator('[aria-label$="batteries"]').getAttribute('aria-label'))!)![1])
  if (/serial/i.test(ruleText)) {
    await film.shout(wireExpert, 'Asha, read me the serial number.', 2400)
    await film.shout('Asha', `Serial is ${serial.split('').join(' ')}.`, 3000)
  } else if (/batter/i.test(ruleText)) {
    await film.shout(wireExpert, 'How many batteries on the bomb?', 2400)
    await film.shout('Asha', batteries === 0 ? 'No batteries at all.' : `${batteries} batter${batteries === 1 ? 'y' : 'ies'}.`, 2400)
  } else if (/sticker/i.test(ruleText)) {
    await film.shout(wireExpert, 'Any stickers? Lit or not?', 2400)
    await film.shout('Asha', 'Hmm, let me look...', 2200)
  }
  const ruleSay = `Rule ${ruleNo}: ${ruleText.charAt(0).toUpperCase()}${ruleText.slice(1)}`
  await film.shout(wireExpert, ruleSay, readMs(ruleSay))
  film.spotlight('Asha')
  film.focus('Asha')
  film.bubble('Asha', `The ${ORD[right]} wire... the ${colors[right]} one. Cutting!`, 2800)
  await sleep(1500)
  await cutWire(asha, wires.i, right)
  await solved(ben, wires.i)
  film.bubble('Asha', 'Yesss! Wires done!', 2200)
  await sleep(2400)

  // ------------------------------------------------------------- second module
  const oexp = film.page(otherExpert)
  await tap(asha.getByTestId(`module-tab-${other.i}`))
  if (other.kind === 'button') {
    film.caption('Bomb 1 · The Panic Button')
    const card = asha.getByTestId(`module-${other.i}`)
    const btn = card.getByTestId('big-button')
    const label = (await btn.innerText()).trim()
    const colorName = (/(\w+) button:/.exec(other.answer)?.[1] ?? 'big').toLowerCase()
    await film.sayWhile(N.button, async () => {
      await sleep(1500)
      film.bubble('Asha', `A huge ${colorName} button. It says ${label}!`, 3200)
    })
    film.spotlight(otherExpert)
    film.focus(otherExpert)
    const bwhy = /HOLD it|TAP it/.exec(other.answer)?.[0] ?? 'TAP it'
    await oexp.getByTestId('manual-search').evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    await sleep(500)
    await oexp.getByTestId('manual-search').pressSequentially(`${colorName} button`, { delay: 140 })
    await sleep(800)
    const ruleLine = /\. ([A-Z][a-z]+ button: .*)$/.exec(other.answer)?.[1] ?? /([A-Z][a-z]+ button: .*)$/.exec(other.answer)?.[1] ?? ''
    const rule = ruleLine.replace(/^\w+ button: (Otherwise, )?/, '')
    const brule = `${rule.charAt(0).toUpperCase()}${rule.slice(1)}`
    await film.shout(otherExpert, brule, readMs(brule))
    film.spotlight('Asha')
    film.focus('Asha')
    if (bwhy === 'TAP it') {
      await film.shout(otherExpert, 'So just TAP it. Quick tap!', 2400)
      await quickTap(asha, other.i)
      await solved(ben, other.i)
    } else {
      const strip = /(Red|Blue|Yellow|White|Pink) strip/.exec(other.answer)![1]!
      const stripRule = /strip: (.*)$/.exec(other.answer.split(/[A-Z][a-z]+ button:/)[0]!)?.[1]?.trim() ?? ''
      film.bubble(otherExpert, 'HOLD it! Keep your thumb on it!', 2400)
      await sleep(1200)
      await film.sayWhile(N.buttonHold, () => holdAndRelease(asha, other.i, strip, async () => {
        film.bubble('Asha', `Holding! The strip is glowing ${strip.toLowerCase()}!`, 2800)
        await sleep(2900)
        film.bubble(otherExpert, `${strip} strip: ${stripRule}`, readMs(stripRule) + 600)
        await sleep(readMs(stripRule))
        film.bubble('Asha', 'Watching the timer... NOW!', 2000)
      }))
      await solved(ben, other.i)
    }
  } else {
    film.caption('Bomb 1 · Letter Lock')
    const word = /Spell ([A-Z]{5})/.exec(other.answer)![1]!
    let letters: string[] = []
    await film.sayWhile(N.wheels, async () => {
      letters = await readWheel(asha, other.i, 0)
    })
    await film.shout('Asha', `Wheel one: ${letters.join(', ')}.`, 3200)
    film.spotlight(otherExpert)
    film.focus(otherExpert)
    const box = oexp.getByTestId('manual-search')
    await box.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    await sleep(400)
    await box.pressSequentially(word[0]!, { delay: 140 })
    await sleep(600)
    await film.shout(otherExpert, `Hmm, lots of words with a ${word[0]}... second wheel?`, 2800)
    film.spotlight('Asha')
    film.focus('Asha')
    film.bubble('Asha', 'Second wheel, spinning...', 2200)
    const second = await readWheel(asha, other.i, 1)
    await film.shout('Asha', `Second: ${second.join(', ')}.`, 3000)
    film.spotlight(otherExpert)
    film.focus(otherExpert)
    await box.pressSequentially(word[1]!, { delay: 140 })
    await sleep(700)
    await film.shout(otherExpert, `It has to be ${word}! ${word.split('').join('-')}!`, 3000)
    film.spotlight('Asha')
    film.focus('Asha')
    film.bubble('Asha', `Spinning to ${word}...`, 2600)
    await spell(asha, other.i, word)
    await sleep(500)
    await tap(asha.getByTestId(`module-${other.i}`).getByTestId('wheels-submit'))
    await solved(ben, other.i)
  }

  // ------------------------------------------------------------- defused
  await waitPhase(film, 'aftermath')
  film.caption('Bomb 1 · Defused!')
  film.focus(['Asha', 'Chen', 'Esha'])
  film.bubble('Chen', 'WE DID IT!', 2200)
  film.bubble('Esha', 'My heart!!', 2200)
  await film.say(N.defused)
  film.spotlight('Asha')
  await film.say(N.score)
  film.bubble('Ben', 'Okay okay, our turn now.', 2400)
  await sleep(1200)

  // ------------------------------------------------------------- bomb 2: Ben's team
  if ((await root(host).getAttribute('data-phase')) === 'aftermath') await tap(host.getByTestId('next'))
  await waitPhase(film, 'briefing')
  expect(await roleOf(film, 'Ben')).toBe('defuser')
  film.caption('Bomb 2 · Ben’s team')
  film.spotlight('Ben')
  film.focus('Ben')
  await film.say(N.next)
  film.spotlight('Asha')
  film.focus(['Asha', 'Chen', 'Esha'])
  await film.sayWhile(N.betBoom, async () => {
    await sleep(2400)
    await scrollTo(asha, 'predict')
    await sleep(600)
    await tap(asha.getByTestId('predict-boom'))
    film.bubble('Asha', 'Boom. Definitely boom.', 2600)
  })
  film.spotlight(null)
  film.focus(null)

  await film.cut(async () => {
    if ((await root(ben).getAttribute('data-phase')) === 'briefing') await tap(ben.getByTestId('arm'))
    await waitPhase(film, 'live')
    const mods2 = await readModules(asha)
    const w2 = mods2.find((m) => m.kind === 'wires')!
    const o2 = mods2.find((m) => m.kind !== 'wires')!
    const r2 = ORD.indexOf(/Cut the (\w+) wire/.exec(w2.answer)![1]!)
    await sleep(4000)
    await tap(ben.getByTestId(`module-tab-${w2.i}`))
    const n2 = (await wireColors(ben, w2.i)).length
    const wrongs = Array.from({ length: n2 }, (_, k) => k).filter((k) => k !== r2).slice(0, 2)
    for (const k of wrongs) {
      await cutWire(ben, w2.i, k)
      await sleep(3000)
    }
    await tap(ben.getByTestId(`module-tab-${o2.i}`))
    await sleep(2000)
    if (o2.kind === 'button') {
      if (o2.answer.includes('TAP')) await longPressWrong(ben, o2.i)
      else await quickTap(ben, o2.i)
    } else {
      await tap(ben.getByTestId(`module-${o2.i}`).getByTestId('wheels-submit'))
    }
    await expect(ben.getByTestId('flash-boom')).toBeVisible()
  }, 'a few strikes later')

  film.caption('Bomb 2 · BOOM')
  film.spotlight('Ben')
  film.focus('Ben')
  film.bubble('Dev', 'Ben, WHAT was that?!', 2400)
  await film.say(N.boom)
  film.spotlight(null)
  film.focus(null)
  await film.sayWhile(N.rotate, async () => {
    await sleep(2000)
    if ((await root(host).getAttribute('data-phase', { timeout: 1000 }).catch(() => null)) === 'aftermath') await host.getByTestId('next').click({ timeout: 2000 }).catch(() => {})
    for (const p of film.room.pages) await expect(p.getByTestId('results')).toBeVisible({ timeout: 30_000 })
  })

  // ------------------------------------------------------------- results
  film.caption('Results')
  film.spotlight('Asha')
  film.focus(['Asha', 'Chen', 'Esha'])
  await film.say(N.results)
  film.bubble('Farhan', 'Rematch. Right now.', 2600)
  await sleep(1500)
  film.spotlight(null)
  film.focus(null)
  await film.say(N.outro)
  await film.pause(800)
  await film.finish()
})
