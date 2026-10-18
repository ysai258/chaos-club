import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setUpLobby, start, startFilm, tap, VIDEO_ROOT, type Film, type Timeline } from '../kit.ts'

const GAME = 'friend-court'
const NAMES = ['Asha', 'Ben', 'Chen', 'Dev', 'Esha', 'Farhan']
const TEAMS = [['Asha', 'Chen', 'Esha'], ['Ben', 'Dev', 'Farhan']]

const N = {
  intro: 'Welcome to Friend Court! Six friends on one Meet call, phones in hand. The host picks Friend Court and makes two teams.',
  settings: 'For a quick game, pick two cases and a speech length. Then hit start.',
  charge: 'Every case puts a real friend on trial for something absurd. Yes, that is your friend in the dock!',
  sides: 'One team prosecutes, one defends, and one player sits out as the Judge. Everyone gets three secret evidence cards.',
  judge: 'The Judge bangs the gavel. All rise!',
  floor: 'YOU have the floor! Unmute and argue before the timer runs out. Everyone else: shh.',
  note: 'Teammates cannot talk, but they can slip you a note: one card per case. It lands in your hand, and you have to use it!',
  exhibit: 'Tap a card to present it as an exhibit. Each one is a point, max two per speech.',
  defence: 'Sides take turns, and the accused always gets the last word. Defence, twist every card into an alibi!',
  objection: 'The other side can smash OBJECTION! The clock freezes, and the objector explains why, out loud.',
  ruling: 'The Judge rules. Sustained: the objectors get a point and the last exhibit is struck. Overruled: the speaker gets the point.',
  closing: 'Closing speeches are shorter. Said enough? Tap "I rest my case" to end your speech early.',
  lastWords: 'And finally, the accused gets the last words. Make them count.',
  delib: 'Deliberation! The Judge picks guilty or not guilty, and then a sentence.',
  respect: 'Everyone else votes respect for the best lawyer on the other side. Bragging rights only!',
  verdict: 'Winning the case scores three points. Sentences are served on the next call!',
  swap: 'Next case, the sides swap and a new Judge takes the bench. Everyone gets their turn in the dock.',
  results: 'Court adjourned! Most points wins, and every case and sentence is on the record forever.',
  awards: 'Plus silly awards for the stars of the courtroom. Who knew you were such a good lawyer?',
  outro: 'That is Friend Court. Get your friends on a call, open Chaos Club, and argue anyway!',
}

/**
 * Work around recordings that start late: a phone left on about:blank while
 * the others join records no frames, so its video runs a few seconds ahead of
 * the timeline. Each video should last (end - startedAt) plus the same close
 * flush; whatever a video is short by was lost at its start. Shift those tiles
 * and drop the first seconds of the film so every tile starts at or before t=0.
 */
function resyncTiles(game: string): void {
  const file = join(VIDEO_ROOT, 'raw', game, 'timeline.json')
  const tl = JSON.parse(readFileSync(file, 'utf8')) as Timeline
  const dur = (f: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()) * 1000
  const loss = tl.tiles.map((t) => tl.end - t.startedAt - dur(t.video))
  const base = Math.min(...loss)
  const starts = tl.tiles.map((t, i) => t.startedAt + (loss[i]! - base))
  const shift = Math.max(0, ...starts)
  tl.tiles.forEach((t, i) => { t.startedAt = Math.round(starts[i]! - shift) })
  for (const e of tl.events) {
    if ('at' in e) e.at = Math.max(0, e.at - shift)
    if ('from' in e) { e.from = Math.max(0, e.from - shift); e.to = Math.max(0, e.to - shift) }
  }
  tl.end -= shift
  writeFileSync(file, JSON.stringify(tl, null, 2))
  console.log(`[resync] lost ms per tile: ${loss.map((l) => Math.round(l - base)).join(', ')}; trimmed ${Math.round(shift)}ms`)
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

function nameOf(film: Film, page: Page): string {
  return film.room.players.find((p) => p.page === page)!.name
}

/** The first player whose phone shows `testId` (polls). */
async function who(film: Film, testId: string, timeout = 20_000): Promise<string> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    for (const p of film.room.players) if (await p.page.getByTestId(testId).first().isVisible().catch(() => false)) return p.name
    await film.room.host.waitForTimeout(100)
  }
  throw new Error(`nobody shows ${testId}`)
}

async function roles(film: Film): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const p of film.room.players) out[p.name] = (await p.page.getByTestId('fc-role').getAttribute('data-role'))!
  return out
}

async function handTexts(page: Page): Promise<string[]> {
  return (await page.getByTestId('fc-speaker').getByTestId('fc-card').locator('div.font-display').allTextContents()).map(clean)
}

async function play(page: Page, text: string): Promise<void> {
  await tap(page.getByTestId('fc-speaker').getByTestId('fc-card').filter({ hasText: text }).first().getByTestId('fc-play'))
  await top(page)
}

async function rest(page: Page): Promise<void> {
  await tap(page.getByTestId('fc-rest'))
  await expect(page.getByTestId('fc-speaker')).toHaveCount(0)
}

async function top(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
}

async function react(film: Film, name: string, emoji: string): Promise<void> {
  await film.page(name).getByRole('button', { name: `React ${emoji}` }).click().catch(() => {})
}

/** A whole speech with no fuss (used inside cuts): play a card, rest. */
async function quickSpeech(film: Film): Promise<void> {
  const name = await who(film, 'fc-speaker')
  const page = film.page(name)
  const [card] = await handTexts(page)
  if (card) await play(page, card)
  await rest(page)
}

test(GAME, async ({ browser }) => {
  test.setTimeout(20 * 60_000)
  const film = await startFilm(browser, { game: GAME, names: NAMES, teams: TEAMS, lines: Object.values(N) })

  // ------------------------------------------------------------ lobby
  film.caption('Friend Court')
  film.focus('Asha')
  await film.sayWhile(N.intro, () => setUpLobby(film, { game: GAME, teams: TEAMS }))
  await film.sayWhile(N.settings, () => setUpLobby(film, { game: GAME, teams: TEAMS, settings: { cases: '2 cases (~7 min)', pace: 'Normal (45s / 30s)' } }))
  await start(film)
  film.focus(null)

  // ------------------------------------------------------------ case 1: reveal (15 s on the clock)
  for (const p of film.room.pages) await expect(p.getByTestId('fc-screen')).toHaveAttribute('data-phase', 'reveal')
  film.caption('Case 1 · The charge')
  const r = await roles(film)
  const judge = NAMES.find((n) => r[n] === 'judge')!
  const pros = NAMES.filter((n) => r[n] === 'prosecution')
  const def = NAMES.filter((n) => r[n] === 'defence')
  const accusedName = clean((await film.page(def[0]!).getByTestId('fc-title').locator('xpath=following-sibling::p').textContent()) ?? '').match(/vs\. (\w+)/)?.[1] ?? def[0]!
  const title = clean((await film.page(def[0]!).getByTestId('fc-title').textContent()) ?? 'this case')
  film.spotlight(accusedName); film.focus(accusedName)
  await film.sayWhile(N.charge, async () => {
    await film.pause(3200)
    film.bubble(accusedName, `"${title}"?! Lies! I demand a lawyer! Preferably a good one.`, 3600)
  })
  // Show a prosecutor's secret hand.
  const pros1 = pros[0]!
  await film.page(pros1).getByText('Your secret evidence').evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
  film.spotlight(pros1); film.focus(pros1)
  await film.say(N.sides)
  film.spotlight(null); film.focus(judge)
  if (await film.page(judge).getByTestId('fc-begin').isVisible()) await tap(film.page(judge).getByTestId('fc-begin'))
  await film.say(N.judge)
  film.focus(null)

  // ------------------------------------------------------------ speech 1: prosecution opening, with a note
  const s1 = await who(film, 'fc-speaker')
  const s1p = film.page(s1)
  await top(s1p)
  film.caption('Case 1 · Opening for the prosecution')
  film.spotlight(s1); film.focus(s1)
  await film.say(N.floor)
  await film.shout(s1, `Your Honour, look at ${accusedName}. Is that an innocent face? No. That is the face of a criminal.`, 3200)
  // A teammate slips a note.
  const passer = pros.find((n) => n !== s1)!
  const passerCard = clean((await film.page(passer).getByTestId('fc-card').first().locator('div.font-display').textContent()) ?? '')
  await film.sayWhile(N.note, async () => {
    await film.pause(1500)
    film.spotlight(passer); film.focus(passer)
    await film.pause(1800)
    await tap(film.page(passer).getByTestId('fc-note').first())
    await expect(s1p.getByText(/note from/).first()).toBeVisible()
    await top(s1p)
    await film.pause(1200)
    film.spotlight(s1); film.focus(s1)
  })
  await film.sayWhile(N.exhibit, async () => {
    await film.pause(2500)
    await play(s1p, passerCard)
  })
  await film.shout(s1, `Exhibit A: "${passerCard}". My colleague just handed me this and honestly? It explains EVERYTHING.`, 4000)
  await react(film, def[1] ?? def[0]!, '😂')
  await rest(s1p)

  // ------------------------------------------------------------ speech 2: defence opening, objection
  const s2 = await who(film, 'fc-speaker')
  const s2p = film.page(s2)
  await top(s2p)
  film.caption('Case 1 · Opening for the defence')
  film.spotlight(s2); film.focus(s2)
  const [d1] = await handTexts(s2p)
  await film.sayWhile(N.defence, async () => {
    await film.pause(2200)
    await play(s2p, d1!)
  })
  await film.shout(s2, `Exhibit B: "${d1}". My client was clearly busy with THIS. Airtight alibi.`, 3600)
  const objector = pros.find((n) => n !== s1) ?? pros[0]!
  await film.sayWhile(N.objection, async () => {
    await film.pause(1200)
    film.spotlight(null); film.focus(objector)
    await tap(film.page(objector).getByTestId('fc-object'))
    await film.pause(1600)
    film.spotlight(objector)
    const reason = clean((await film.page(objector).getByTestId('fc-objection').locator('div.font-display').first().textContent()) ?? 'Objection!').replace(/[“”"]/g, '')
    await film.pause(800)
    film.bubble(objector, `${reason} Your Honour, that card has nothing to do with anything!`, 3400)
  })
  film.spotlight(judge); film.focus(judge)
  await film.sayWhile(N.ruling, async () => {
    await film.pause(2500)
    await tap(film.page(judge).getByTestId('fc-sustain'))
  })
  film.bubble(judge, 'Sustained! Exhibit B, get out of my courtroom.', 2800)
  film.spotlight(s2); film.focus(s2)
  await top(s2p)
  await film.pause(2800)
  await film.shout(s2, 'Fine. FINE. My client is still innocent. I rest my case.', 2800)
  await rest(s2p)

  // ------------------------------------------------------------ speech 3: prosecution closing
  const s3 = await who(film, 'fc-speaker')
  const s3p = film.page(s3)
  await top(s3p)
  film.caption('Case 1 · Closing arguments')
  film.spotlight(s3); film.focus(s3)
  const [p3] = await handTexts(s3p)
  await film.sayWhile(N.closing, async () => {
    await film.pause(2000)
    await play(s3p, p3!)
  })
  await film.shout(s3, `Exhibit C: "${p3}". Case closed. Literally. I am closing it.`, 3200)
  await rest(s3p)

  // ------------------------------------------------------------ speech 4: the accused's last words
  const s4 = await who(film, 'fc-speaker')
  const s4p = film.page(s4)
  await top(s4p)
  film.spotlight(s4); film.focus(s4)
  const [d4] = await handTexts(s4p)
  await film.sayWhile(N.lastWords, async () => {
    await film.pause(1500)
    await play(s4p, d4!)
  })
  await film.shout(s4, `I am innocent! Also... "${d4}". I don't know why I said that.`, 3400)
  await react(film, pros1, '🤡')
  await rest(s4p)

  // ------------------------------------------------------------ deliberation
  for (const p of film.room.pages) await expect(p.getByTestId('fc-screen')).toHaveAttribute('data-phase', 'deliberation')
  film.caption('Case 1 · The verdict')
  const jp = film.page(judge)
  film.spotlight(judge); film.focus(judge)
  await film.sayWhile(N.delib, async () => {
    await film.pause(2500)
    await tap(jp.getByTestId('fc-guilty'))
    await jp.getByTestId('fc-sentence').first().evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
  })
  const voter = def.find((n) => n !== accusedName) ?? def[0]!
  film.spotlight(voter); film.focus(voter)
  await film.sayWhile(N.respect, async () => {
    await film.pause(1500)
    for (const n of [voter, ...NAMES.filter((x) => x !== voter && x !== judge)]) {
      const target = film.page(n).getByTestId('fc-respect-target').first()
      if (await target.isVisible().catch(() => false)) {
        await tap(target)
        await film.pause(400)
      }
    }
  })
  film.spotlight(judge); film.focus(judge)
  await film.shout(judge, 'After careful thought, for zero seconds: GUILTY!', 2600)
  await tap(jp.getByTestId('fc-sentence').first())
  await expect(film.page(accusedName).getByTestId('fc-verdict')).toBeVisible()
  film.spotlight(accusedName); film.focus(accusedName)
  await film.sayWhile(N.verdict, async () => {
    await film.pause(4200)
    film.bubble(accusedName, 'I want a retrial! And a lawyer who reads the cards first!', 3000)
  })
  film.spotlight(null); film.focus(null)

  // ------------------------------------------------------------ case 2: show the swap, skip the trial
  await film.cut(async () => {
    for (const p of film.room.pages) await expect(p.getByTestId('fc-screen')).toHaveAttribute('data-phase', 'reveal', { timeout: 20_000 })
  }, 'next case')
  film.caption('Case 2 · Sides swap')
  const r2 = await roles(film)
  const judge2 = NAMES.find((n) => r2[n] === 'judge')!
  film.spotlight(judge2); film.focus(judge2)
  await film.say(N.swap)
  film.spotlight(null); film.focus(null)
  await film.cut(async () => {
    const jp2 = film.page(judge2)
    if (await jp2.getByTestId('fc-begin').isVisible()) await tap(jp2.getByTestId('fc-begin'))
    for (let s = 0; s < 4; s++) await quickSpeech(film)
    for (const p of film.room.pages) await expect(p.getByTestId('fc-screen')).toHaveAttribute('data-phase', 'deliberation')
    for (const n of NAMES) {
      const target = film.page(n).getByTestId('fc-respect-target').first()
      if (await target.isVisible().catch(() => false)) await tap(target)
    }
    await tap(jp2.getByTestId('fc-not-guilty'))
    await tap(jp2.getByTestId('fc-sentence').first())
    for (const p of film.room.pages) await expect(p.getByTestId('results')).toBeVisible({ timeout: 30_000 })
    await film.pause(1500)
  }, 'case 2')

  // ------------------------------------------------------------ results
  film.caption('Results')
  film.spotlight('Asha')
  const host = film.room.host
  await film.sayWhile(N.results, async () => {
    await film.pause(3800)
    await host.getByRole('heading', { name: /Highlights/ }).evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  })
  await film.sayWhile(N.awards, async () => {
    await host.getByRole('heading', { name: /Awards/ }).evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  })
  await film.pause(1000)
  film.spotlight(null)
  await film.say(N.outro)
  await film.pause(1200)
  await film.finish()
  resyncTiles(GAME)
})
