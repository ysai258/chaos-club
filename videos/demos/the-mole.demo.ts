import { test, expect, type Page } from '@playwright/test'
import { setUpLobby, start, startFilm, tap, type Film } from '../kit.ts'

/**
 * How-to-play film for The Mole.
 *
 * Moles and challenge order are random per room. The demo discovers the moles
 * from the phones at runtime, and scripts round 1 for the three challenges that
 * tell the cleanest "promised X, did Y" story (Safe Cracker, Bribe the Guard,
 * The Heist). If round 1 is any other challenge, it throws the room away and
 * films a fresh one (startFilm wipes the raw folder, so only the keeper counts).
 *
 * Story: team 0's Mole sabotages round 1 and gets caught in the debrief;
 * team 1's Mole plays straight, survives a wiretap, and escapes the Final Hunt
 * on a three-way tie.
 */

type Kind = 'safe' | 'bribe' | 'heist'
const KIND_BY_NAME: Record<string, Kind> = { 'Safe Cracker': 'safe', 'Bribe the Guard': 'bribe', 'The Heist': 'heist' }

const N = {
  intro: 'Welcome to The Mole! Six friends on one Meet call, phones in hand, split into two teams of three.',
  lobby: 'The host picks The Mole, sets up the teams, and goes with four challenges. The fewest you can play.',
  coop: 'Each team plays quick co-op challenges together. Simple, right? Except one player on every team is secretly a Mole.',
  loyal: 'Most phones say this: you are LOYAL. Plus a little warning. One of your teammates probably is not.',
  mole: 'But one phone on each team says this instead. Only the Mole sees it: you secretly work for the RIVAL team.',
  straight: 'Meanwhile, the other team\'s Mole plays it totally straight. Looking trustworthy is half the game.',
  accuse: 'Convinced? Vote to accuse! A majority of the others convicts. Right: plus six. Wrong: minus three.',
  wiretap: 'The winning team has points to spend. A wiretap costs two, and shows exactly what one teammate did this round.',
  tapped: 'Clean. So, loyal... or a very patient Mole.',
  verdict: 'Caught! Plus six for the team, and that Mole\'s cover is blown.',
  final: 'Three challenges later, the other Mole is still hidden. So it is the Final Hunt: one last vote, no second chances.',
  finalRule: 'Most votes wins. A tie lets the Mole escape. Pick carefully!',
  tie: 'One vote each. A tie! And the Mole quietly slips away.',
  unmask: 'The unmasking! Every Mole is revealed, along with who they were really working for.',
  unmask2: 'Every sabotage that landed pays their real employer. And an escaped Mole is worth eight more. Sneaky.',
  results: 'Then the final scores. Crack the challenges, trust nobody, and catch your Mole. Play it with your friends tonight!',
  safe: {
    rules: 'Challenge one: Safe Cracker. Everyone secretly dials a number from zero to nine. The team total must hit the target exactly.',
    mission: 'And the Mole gets a secret mission every round. Here: make the total miss by just one or two. It looks like an honest slip.',
    plan: 'Teams plan out loud on the call. Who dials what?',
    play: 'Now everyone dials in secret. Watch the Mole. Promised one number, and quietly dials another.',
    evidence: 'The debrief: every number dialled, shuffled, no names. But someone promised a number that is not here!',
  },
  bribe: {
    rules: 'Challenge one: Bribe the Guard. The guard has a secret price. Each player slips him zero to five coins.',
    mission: 'The Mole gets a secret mission, plus inside info: the exact price. Mission: make the team overpay big, or come up short.',
    plan: 'Teams pool their hints out loud on the call, and split who pays what.',
    play: 'Coins go in secretly. Watch the Mole. Promised their share, and slips in one coin less.',
    evidence: 'The debrief: every payment, shuffled, no names. One coin short, and someone paid less than they promised!',
  },
  heist: {
    rules: 'Challenge one: The Heist. The Leader picks a crew of two. Each crew member secretly plays crack, or jam.',
    mission: 'And the Mole gets a secret mission every round. Here: get picked for the crew, then jam it. One jam ruins the job.',
    plan: 'Everyone lobbies the Leader out loud. Pick me! I am totally trustworthy!',
    play: 'The crew plays their cards in secret. Watch the Mole\'s thumb. Straight to jam.',
    evidence: 'The debrief: one jam, and only two people on the crew. If you played crack, you know who jammed!',
  },
}

const allLines = (o: unknown): string[] => (typeof o === 'string' ? [o] : Object.values(o as object).flatMap(allLines))

const NAMES = ['Asha', 'Ben', 'Chen', 'Dev', 'Esha', 'Farhan']
const TEAMS = [['Asha', 'Chen', 'Esha'], ['Ben', 'Dev', 'Farhan']]
const SETTINGS = { rounds: 4, pace: 'Chill (longer)' }

// ---------- phone helpers ----------

const screen = (p: Page) => p.getByTestId('mole-screen')
const phaseOf = (p: Page) => screen(p).getAttribute('data-phase', { timeout: 500 }).catch(() => null)

async function waitPhase(film: Film, names: string[], phase: string, timeout = 90_000): Promise<void> {
  for (const n of names) await expect(screen(film.page(n))).toHaveAttribute('data-phase', phase, { timeout })
}

/** Pick a number on the pad and lock it in. */
async function dial(p: Page, n: number): Promise<void> {
  await tap(p.getByTestId(`mole-num-${n}`))
  await p.waitForTimeout(450)
  await tap(p.getByTestId('mole-lock'))
}

async function choose(p: Page, value: string): Promise<void> {
  await tap(p.getByTestId(`mole-choice-${value}`))
  await p.waitForTimeout(450)
  await tap(p.getByTestId('mole-lock'))
}

/** Value of one fact row ("Target", "Leader", ...) on the shared facts card. */
async function fact(p: Page, label: string): Promise<string> {
  const row = p.getByTestId('mole-facts').locator('dl > div').filter({ has: p.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
  return (await row.locator('dd').first().innerText()).trim()
}

async function scrollTo(p: Page, testId: string, nth = 0): Promise<void> {
  await p.getByTestId(testId).nth(nth).evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' })).catch(() => {})
}

async function scrollTop(p: Page): Promise<void> {
  await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })).catch(() => {})
}

/** Play whatever is on screen, like a cooperative human (for the rounds we cut). */
async function playAnything(p: Page): Promise<boolean> {
  const lock = p.getByTestId('mole-lock')
  if (!(await lock.isVisible().catch(() => false))) return false
  if (await p.getByTestId('mole-number-input').isVisible().catch(() => false)) {
    await p.getByTestId('mole-number-input').fill('100')
  } else if (await p.getByTestId('mole-text-input').isVisible().catch(() => false)) {
    await p.getByTestId('mole-text-input').fill('zzclue')
  } else if (await p.getByTestId('mole-digits').isVisible().catch(() => false)) {
    for (let i = 0; i < 4; i++) await p.getByTestId('mole-key-1').click()
  } else {
    const picks = p.locator('[data-testid^="mole-pick-"]')
    const n = await picks.count()
    if (n) {
      const label = (await p.getByText(/\(\d+\/\d+\)/).first().textContent()) ?? ''
      const need = Number(/\/(\d+)\)/.exec(label)?.[1] ?? 2)
      for (let i = 0; i < need; i++) await picks.nth(i).click()
    } else {
      const opt = p.locator('[data-testid^="mole-num-"], [data-testid^="mole-choice-"]').first()
      if (await opt.isVisible().catch(() => false)) await opt.click()
    }
  }
  if (await lock.isEnabled().catch(() => false)) { await lock.click().catch(() => {}); return true }
  return false
}

/** Split `total` into three shares, the Mole's (last) one at least 1, none above `max`. */
function split(total: number, moleShare: number): [number, number, number] {
  const rest = total - moleShare
  return [Math.ceil(rest / 2), Math.floor(rest / 2), moleShare]
}

// ---------- the film ----------

test('the-mole', async ({ browser }) => {
  let film!: Film
  let kind: Kind | null = null
  for (let attempt = 1; attempt <= 15 && !kind; attempt++) {
    film = await startFilm(browser, { game: 'the-mole', names: NAMES, teams: TEAMS, lines: allLines(N) })
    film.caption('Setting up')
    await film.say(N.intro)
    film.focus('Asha')
    await film.sayWhile(N.lobby, () => setUpLobby(film, { game: 'the-mole', teams: TEAMS, settings: SETTINGS }))
    film.focus(null)
    await film.say(N.coop)
    await start(film)
    const ALL = ['Safe Cracker', 'The Heist', 'Heat Scale', 'Intel Board', 'Bribe the Guard', 'Ballpark', 'Code Relay', 'Stock Tip', 'Blind Spot']
    let text = ''
    await expect.poll(async () => {
      text = (await screen(film.room.host).textContent().catch(() => '')) ?? ''
      return ALL.some((k) => text.includes(k))
    }, { timeout: 15_000 }).toBe(true)
    console.log(`[the-mole] screen: ${text.slice(0, 160).replace(/\s+/g, ' ')}`)
    const found = Object.keys(KIND_BY_NAME).find((k) => text.includes(k))
    kind = found ? KIND_BY_NAME[found]! : null
    if (!kind) {
      console.log(`[the-mole] attempt ${attempt}: round 1 is not a scripted challenge, filming a fresh room`)
      await film.room.close()
    }
  }
  if (!kind) throw new Error('Never got a scripted first challenge')
  const K = N[kind]

  // Who is who: each phone only knows itself.
  const role: Record<string, string> = {}
  for (const n of NAMES) {
    const r = film.page(n).getByTestId('mole-role')
    await expect(r).toBeVisible()
    role[n] = (await r.getAttribute('data-role')) ?? ''
  }
  const moleOf = (t: string[]) => t.find((n) => role[n] === 'mole')!
  const [A, B] = TEAMS as [string[], string[]]
  const M0 = moleOf(A)
  const M1 = moleOf(B)
  const [L0a, L0b] = A.filter((n) => n !== M0) as [string, string]
  const [L1a, L1b] = B.filter((n) => n !== M1) as [string, string]
  console.log(`[the-mole] kind=${kind} moles: ${M0}, ${M1}`)
  const pg = film.page
  for (const n of NAMES) await scrollTop(pg(n))

  // ---- Briefing: loyal vs mole ----
  film.caption('Challenge 1 · Your secret role')
  film.spotlight(L0a)
  await film.say(N.loyal)
  await film.say(K.rules)
  film.spotlight(M0)
  await film.say(N.mole)
  await waitPhase(film, NAMES, 'challenge', 20_000)
  await film.say(K.mission)
  film.spotlight(null)
  const captionName = kind === 'safe' ? 'Safe Cracker' : kind === 'bribe' ? 'Bribe the Guard' : 'The Heist'
  film.caption(`Challenge 1 · ${captionName}`)

  // ---- Round 1, scripted per challenge ----
  let argue: [string, string][] = []
  if (kind === 'safe' || kind === 'bribe') {
    const plan = async (team: string[], mole: string) => {
      const [la, lb] = team.filter((n) => n !== mole) as [string, string]
      let total: number
      if (kind === 'safe') total = Number(await fact(pg(la), 'Target'))
      else total = Number(/exact price is (\d+)/.exec(await pg(mole).getByTestId('mole-insider').innerText())![1])
      const moleShare = kind === 'safe' ? Math.floor(total / 3) : total >= 9 ? 3 : 2
      let [a, b, c] = split(total, moleShare)
      if (kind === 'safe') { a = Math.min(9, a + 1); b = total - c - a }
      // What the Mole really dials: a near miss nobody promised (bribe: one coin short).
      const d = kind === 'safe' ? [c - 1, c + 1, c - 2, c + 2].find((x) => x >= 0 && x <= 9 && x !== a && x !== b)! : c - 1
      return { la, lb, total, a, b, c, d }
    }
    const p0 = await plan(A, M0)
    const p1 = await plan(B, M1)
    const hint = async (n: string) => (/between (\d+) and (\d+)/.exec(await pg(n).getByTestId('mole-intel').innerText()) ?? []).slice(1).join(' to ')
    await film.sayWhile(K.plan, async () => {
      if (kind === 'safe') {
        film.bubble(p0.la, `Target ${p0.total}! I'll dial ${p0.a}.`, 3000)
        await film.pause(900)
        film.bubble(p1.la, `Ours is ${p1.total}. ${p1.a} from me.`, 3000)
        await film.pause(1300)
        film.bubble(p0.lb, `I've got ${p0.b}.`, 2800)
        await film.pause(900)
        film.bubble(M1, `I'll do ${p1.c}.`, 2600)
        await film.pause(1300)
        film.bubble(M0, `So I dial ${p0.c}. Easy!`, 2800)
        film.bubble(p1.lb, `And ${p1.b} from me!`, 2800)
      } else {
        film.bubble(p0.la, `My hint: ${await hint(p0.la)} coins.`, 3000)
        await film.pause(900)
        film.bubble(p1.la, `Mine says ${await hint(p1.la)}.`, 3000)
        await film.pause(1300)
        film.bubble(M0, `Feels like ${p0.total}. I'll pay ${p0.c}!`, 3000)
        await film.pause(900)
        film.bubble(M1, `I'd say ${p1.total}. ${p1.c} from me.`, 3000)
        await film.pause(1300)
        film.bubble(p0.lb, `Then ${p0.a} from ${p0.la}, ${p0.b} from me.`, 3000)
        film.bubble(p1.lb, `${p1.a}, ${p1.b}, ${p1.c}. Deal!`, 3000)
      }
      await film.pause(2600)
    })
    await film.sayWhile(K.play, async () => {
      film.focus([...A, ...B])
      await Promise.all([dial(pg(p0.la), p0.a), dial(pg(p0.lb), p0.b), dial(pg(p1.la), p1.a), dial(pg(p1.lb), p1.b)])
      film.spotlight(M0)
      film.focus(M0)
      await pg(M0).waitForTimeout(700)
      await dial(pg(M0), p0.d)
      await pg(M0).waitForTimeout(1200)
    })
    film.spotlight(null)
    film.focus(B)
    await film.sayWhile(N.straight, async () => {
      await dial(pg(M1), p1.c)
      film.bubble(M1, kind === 'safe' ? `Locked in my ${p1.c}!` : `${p1.c} coins, as promised!`, 2600)
    })
    const unit = kind === 'safe' ? '' : ' coins'
    const got = p0.total - p0.c + p0.d
    argue = [
      [p0.lb, kind === 'safe' ? `Total ${got}?! Where did a ${p0.d} come from?` : `${got}${unit}?! We were one short!`],
      [p0.la, `${M0}, you promised ${p0.c}. Why is there a ${p0.d}?!`],
      [M0, kind === 'safe' ? 'My finger slipped! I swear!' : 'Inflation! Prices go up!'],
    ]
  } else {
    // The Heist
    const leaderOf = async (team: string[]) => {
      const v = await fact(pg(team[0]!), 'Leader')
      return team.find((n) => v.includes(n))!
    }
    const lead0 = await leaderOf(A)
    const lead1 = await leaderOf(B)
    const crew0 = lead0 === M0 ? [M0, L0a] : [lead0, M0]
    const crew1 = lead1 === M1 ? [M1, L1a] : [lead1, M1]
    const pickCrew = async (leader: string, crew: string[]) => {
      const p = pg(leader)
      for (const c of crew) {
        await tap(p.locator('[data-testid^="mole-pick-"]').filter({ hasText: c }))
        await p.waitForTimeout(400)
      }
      await tap(p.getByTestId('mole-lock'))
    }
    await film.sayWhile(K.plan, async () => {
      if (lead0 === M0) {
        film.bubble(M0, `I'm the Leader! Me and ${L0a}. Trust me.`, 3200)
      } else {
        film.bubble(M0, `Pick me, ${lead0}! I'm SO trustworthy.`, 3000)
        await film.pause(1400)
        film.bubble(lead0, `Fine, ${M0}, you're in.`, 2600)
      }
      await film.pause(900)
      film.bubble(lead1, lead1 === M1 ? `Leader here. Me and ${L1a}.` : `${M1} and me. Let's go.`, 3000)
      film.focus([lead0, lead1])
      await Promise.all([pickCrew(lead0, crew0), pickCrew(lead1, crew1)])
      await film.pause(1200)
    })
    const loyalOnCrew0 = crew0.find((n) => n !== M0)!
    await film.sayWhile(K.play, async () => {
      film.focus([...crew0, ...crew1])
      await Promise.all([choose(pg(loyalOnCrew0), 'clean'), ...crew1.map((n) => choose(pg(n), 'clean'))])
      film.spotlight(M0)
      film.focus(M0)
      await pg(M0).waitForTimeout(700)
      await choose(pg(M0), 'jam')
      await pg(M0).waitForTimeout(1200)
    })
    film.spotlight(null)
    film.focus(B)
    await film.sayWhile(N.straight, async () => {
      film.bubble(M1, 'Crack! Clean as a whistle.', 2600)
      await film.pause(2000)
    })
    const other0 = A.find((n) => n !== M0 && n !== loyalOnCrew0)!
    argue = [
      [loyalOnCrew0, `I played CRACK. So the jam was YOU, ${M0}!`],
      [M0, 'The button was sticky!'],
      [other0, 'Sticky. Sure.'],
    ]
  }

  // ---- Debrief ----
  await waitPhase(film, NAMES, 'debrief', 60_000)
  for (const n of NAMES) await scrollTop(pg(n))
  film.focus(null)
  film.caption('The debrief')
  const ev = pg(L0a)
  film.spotlight(L0a)
  await film.say(K.evidence)
  film.spotlight(null)
  film.focus(A)
  for (const [who, line] of argue) await film.shout(who, line, 2500)

  // Team 0 accuses its mole (votes land early, so the timer can't steal them).
  film.caption('Accuse!')
  await film.sayWhile(N.accuse, async () => {
    film.focus([L0a, L0b])
    const accuse = (from: string, target: string) => tap(pg(from).getByTestId(/^mole-accuse-/).filter({ hasText: target }))
    await accuse(L0a, M0)
    film.bubble(L0a, `I'm voting ${M0}.`, 2400)
    await film.pause(1500)
    await accuse(L0b, M0)
    film.bubble(L0b, 'Same!', 2000)
    await film.pause(1500)
    film.focus(M0)
    await accuse(M0, L0a)
    film.bubble(M0, `Fine! Then I vote ${L0a}!`, 2600)
    await film.pause(1500)
  })

  // Team 1 wiretaps its (honest-looking) mole.
  film.caption('Wiretap')
  film.focus(L1a)
  film.spotlight(L1a)
  await film.sayWhile(N.wiretap, async () => {
    await scrollTop(pg(L1a))
    await pg(L1a).waitForTimeout(1500)
    await tap(pg(L1a).getByTestId('mole-wiretap'))
    await pg(L1a).waitForTimeout(1200)
    await tap(pg(L1a).getByTestId(/^mole-tap-/).filter({ hasText: M1 }))
    await expect(pg(L1a).getByTestId('mole-wiretap-result')).toBeVisible()
    await scrollTo(pg(L1a), 'mole-wiretap-result')
  })
  await film.say(N.tapped)
  film.spotlight(null)
  film.focus(B)
  await film.shout(L1a, `Huh. ${M1} is clean... for now.`, 2400)
  await film.shout(M1, 'Told you! Loyal to the bone.', 2200)
  await Promise.all(B.map((n) => tap(pg(n).getByTestId('mole-pass'))))

  // ---- Verdict ----
  await waitPhase(film, [L0a], 'verdict', 30_000)
  film.caption('The verdict')
  film.focus(A)
  film.spotlight(L0a)
  await film.say(N.verdict)
  film.spotlight(null)
  await film.shout(M0, 'Worth a try!', 2000)
  void ev

  // ---- The middle rounds, cut ----
  await film.cut(async () => {
    film.focus(null)
    for (let loop = 0; loop < 600; loop++) {
      const phases = await Promise.all(NAMES.map((n) => phaseOf(pg(n))))
      if (phases.includes('finalHunt') || phases.includes('unmasking')) break
      let acted = false
      for (const n of NAMES) {
        const p = pg(n)
        const ph = await phaseOf(p)
        if (ph === 'challenge') acted = (await playAnything(p)) || acted
        else if (ph === 'debrief') {
          const pass = p.getByTestId('mole-pass')
          if (await pass.isVisible().catch(() => false) && !/voted|✔/.test((await pass.textContent()) ?? '')) {
            await pass.click().catch(() => {})
            acted = true
          }
        }
      }
      if (!acted) await film.pause(400)
    }
    await waitPhase(film, B, 'finalHunt', 30_000)
    for (const n of NAMES) await scrollTop(pg(n))
    await film.pause(800)
  }, 'three challenges later')

  // ---- Final Hunt ----
  film.caption('The Final Hunt')
  film.spotlight(L1a)
  await film.say(N.final)
  film.spotlight(null)
  film.focus(B)
  await film.say(N.finalRule)
  const finalVote = (from: string, target: string) => tap(pg(from).getByTestId(/^mole-final-/).filter({ hasText: target }))
  film.bubble(L1a, `It's always the quiet one. ${L1b}!`, 2800)
  await finalVote(L1a, L1b)
  await film.pause(2200)
  film.bubble(L1b, `No way! My money's on ${M1}.`, 2800)
  await finalVote(L1b, M1)
  await film.pause(2400)
  film.bubble(M1, `Hmm. I pick ${L1a}. Very suspicious.`, 2800)
  await finalVote(M1, L1a)
  await film.pause(1200)

  // ---- Unmasking ----
  await waitPhase(film, NAMES, 'unmasking', 30_000)
  film.caption('The unmasking')
  await film.say(N.tie)
  film.focus(null)
  film.spotlight(L1b)
  await film.sayWhile(N.unmask, async () => {
    await pg(L1b).waitForTimeout(2500)
    await scrollTo(pg(L1b), 'mole-unmask', 0)
  })
  await film.sayWhile(N.unmask2, async () => {
    await pg(L1b).waitForTimeout(1500)
    await scrollTo(pg(L1b), 'mole-unmask', 1)
  })
  film.spotlight(null)
  film.bubble(L1b, `${M1}?! You LIAR!`, 2600)
  await film.shout(M1, 'Nothing personal. Just business.', 2600)

  // ---- Results ----
  film.caption('Final scores')
  film.focus('Asha')
  await tap(film.room.host.getByTestId('mole-finish'))
  await expect(film.room.host.getByTestId('results')).toBeVisible({ timeout: 20_000 })
  film.focus(null)
  film.spotlight('Asha')
  await film.say(N.results)
  await film.pause(1500)
  await film.finish()
})
