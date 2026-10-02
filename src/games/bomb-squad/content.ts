/**
 * Bomb Squad — the defusal manual. SERVER ONLY: never import from src/web.
 *
 * Every rule is data with both its printed text and the predicate that the
 * solver runs, so the manual an expert reads and the answer the server checks
 * can never drift apart.
 */
import type {
  ButtonColor, DiscoColor, Edgework, ManualBlock, ModuleKind, StripColor, WireColor,
} from './shared.ts'

// ---------------------------------------------------------------------------
// Bomb casing
// ---------------------------------------------------------------------------

/** No I, O or Y: nothing you can mistake for 1, 0 or "why?" on a call. */
export const SERIAL_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXZ'
export const SERIAL_VOWELS = 'AEU'
export const STICKER_LABELS = ['CHAI', 'JUGAAD', 'FILMY', 'DHAMAKA', 'BAKWAS', 'MASALA'] as const

export const serialHasVowel = (e: Edgework) => [...e.serial].some((c) => SERIAL_VOWELS.includes(c))
export const lastDigit = (e: Edgework) => Number(e.serial[e.serial.length - 1])
export const serialOdd = (e: Edgework) => lastDigit(e) % 2 === 1
export const hasLit = (e: Edgework, label: string) => e.stickers.some((s) => s.lit && s.label === label)

export const MODULE_NAMES: Record<ModuleKind, string> = {
  wires: 'Wire Spaghetti',
  button: 'The Panic Button',
  glyphs: 'Alien Keypad',
  saywhat: 'Say What?!',
  wheels: 'Letter Lock',
  disco: 'Diwali Disco',
}

// ---------------------------------------------------------------------------
// Wire Spaghetti
// ---------------------------------------------------------------------------

export interface WireRule {
  text: string
  when: (w: WireColor[], e: Edgework) => boolean
  /** 0-based index of the wire to cut. */
  cut: (w: WireColor[], e: Edgework) => number
}

const count = (w: WireColor[], c: WireColor) => w.filter((x) => x === c).length
const lastOf = (w: WireColor[], c: WireColor) => w.lastIndexOf(c)
const always = () => true

export const WIRE_RULES: Record<number, WireRule[]> = {
  3: [
    { text: 'If there is no green wire and the serial number ends in an odd digit, cut the first wire.', when: (w, e) => count(w, 'green') === 0 && serialOdd(e), cut: () => 0 },
    { text: 'Otherwise, if the second wire is black, cut the last wire.', when: (w) => w[1] === 'black', cut: () => 2 },
    { text: 'Otherwise, if all three wires are different colours, cut the second wire.', when: (w) => new Set(w).size === 3, cut: () => 1 },
    { text: 'Otherwise, if the bomb has a lit CHAI sticker, cut the first wire.', when: (_w, e) => hasLit(e, 'CHAI'), cut: () => 0 },
    { text: 'Otherwise, cut the last wire.', when: always, cut: () => 2 },
  ],
  4: [
    { text: 'If there are two or more yellow wires and the bomb has no batteries, cut the last yellow wire.', when: (w, e) => count(w, 'yellow') >= 2 && e.batteries === 0, cut: (w) => lastOf(w, 'yellow') },
    { text: 'Otherwise, if the first wire is white, cut the fourth wire.', when: (w) => w[0] === 'white', cut: () => 3 },
    { text: 'Otherwise, if there is exactly one red wire and it is not the last wire, cut the wire right after the red one.', when: (w) => count(w, 'red') === 1 && w.indexOf('red') < 3, cut: (w) => w.indexOf('red') + 1 },
    { text: 'Otherwise, if there are more blue wires than green wires, cut the second wire.', when: (w) => count(w, 'blue') > count(w, 'green'), cut: () => 1 },
    { text: 'Otherwise, cut the third wire.', when: always, cut: () => 2 },
  ],
  5: [
    { text: 'If the last wire is black and the serial number has a vowel, cut the fourth wire.', when: (w, e) => w[4] === 'black' && serialHasVowel(e), cut: () => 3 },
    { text: 'Otherwise, if there are exactly two green wires, cut the first green wire.', when: (w) => count(w, 'green') === 2, cut: (w) => w.indexOf('green') },
    { text: 'Otherwise, if there are no white wires and more than two batteries, cut the second wire.', when: (w, e) => count(w, 'white') === 0 && e.batteries > 2, cut: () => 1 },
    { text: 'Otherwise, if the first and last wires are the same colour, cut the third wire.', when: (w) => w[0] === w[4], cut: () => 2 },
    { text: 'Otherwise, cut the first wire.', when: always, cut: () => 0 },
  ],
  6: [
    { text: 'If there are no yellow wires and the serial number ends in an even digit, cut the third wire.', when: (w, e) => count(w, 'yellow') === 0 && !serialOdd(e), cut: () => 2 },
    { text: 'Otherwise, if there are three or more blue wires, cut the last blue wire.', when: (w) => count(w, 'blue') >= 3, cut: (w) => lastOf(w, 'blue') },
    { text: 'Otherwise, if the bomb has a lit DHAMAKA sticker, cut the sixth wire.', when: (_w, e) => hasLit(e, 'DHAMAKA'), cut: () => 5 },
    { text: 'Otherwise, if there are no red wires, cut the fourth wire.', when: (w) => count(w, 'red') === 0, cut: () => 3 },
    { text: 'Otherwise, cut the fifth wire.', when: always, cut: () => 4 },
  ],
}

export const WIRE_COLORS: WireColor[] = ['red', 'blue', 'yellow', 'green', 'black', 'white']

// ---------------------------------------------------------------------------
// The Panic Button
// ---------------------------------------------------------------------------

export type ButtonAct = 'tap' | 'hold'
export interface ButtonRule { text: string; when: (label: string, e: Edgework) => boolean; act: ButtonAct }

export const BUTTON_COLORS: ButtonColor[] = ['red', 'blue', 'yellow', 'white', 'green']
export const BUTTON_LABELS = ['HOLD', 'PRESS', 'ABORT', 'DETONATE', 'CHILL', 'YEET'] as const
export const STRIP_COLORS: StripColor[] = ['red', 'blue', 'yellow', 'white', 'pink']
/** A press shorter than this is a tap; longer is a hold. */
export const TAP_MAX_MS = 700

export const BUTTON_RULES: Record<ButtonColor, ButtonRule[]> = {
  red: [
    { text: 'If the label says ABORT, hold it.', when: (l) => l === 'ABORT', act: 'hold' },
    { text: 'Otherwise, if the bomb has 2 or more batteries, tap it.', when: (_l, e) => e.batteries >= 2, act: 'tap' },
    { text: 'Otherwise, hold it.', when: always, act: 'hold' },
  ],
  blue: [
    { text: 'If the label says HOLD, tap it. (Yes, really.)', when: (l) => l === 'HOLD', act: 'tap' },
    { text: 'Otherwise, if the serial number ends in an even digit, hold it.', when: (_l, e) => !serialOdd(e), act: 'hold' },
    { text: 'Otherwise, tap it.', when: always, act: 'tap' },
  ],
  yellow: [
    { text: 'If the label says YEET and the bomb has at least one battery, tap it.', when: (l, e) => l === 'YEET' && e.batteries >= 1, act: 'tap' },
    { text: 'Otherwise, if the label says CHILL, hold it.', when: (l) => l === 'CHILL', act: 'hold' },
    { text: 'Otherwise, if the serial number has a vowel, tap it.', when: (_l, e) => serialHasVowel(e), act: 'tap' },
    { text: 'Otherwise, hold it.', when: always, act: 'hold' },
  ],
  white: [
    { text: 'If the bomb has no stickers at all, tap it.', when: (_l, e) => e.stickers.length === 0, act: 'tap' },
    { text: 'Otherwise, if the label says DETONATE, tap it.', when: (l) => l === 'DETONATE', act: 'tap' },
    { text: 'Otherwise, if there is a lit FILMY sticker, tap it.', when: (_l, e) => hasLit(e, 'FILMY'), act: 'tap' },
    { text: 'Otherwise, hold it.', when: always, act: 'hold' },
  ],
  green: [
    { text: 'If the label says PRESS, tap it.', when: (l) => l === 'PRESS', act: 'tap' },
    { text: 'Otherwise, if the bomb has 3 or more batteries, tap it.', when: (_l, e) => e.batteries >= 3, act: 'tap' },
    { text: 'Otherwise, hold it.', when: always, act: 'hold' },
  ],
}

/** Timer as shown on the bomb: whole seconds rounded up, "M:SS". */
export function timerText(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const STRIP_RULES: Record<StripColor, { text: string; ok: (timer: string) => boolean }> = {
  red: { text: 'Red strip: let go when the timer shows a 3 anywhere.', ok: (t) => t.includes('3') },
  blue: { text: 'Blue strip: let go when the timer shows a 5 anywhere.', ok: (t) => t.includes('5') },
  yellow: { text: 'Yellow strip: let go when the timer’s last digit is 0.', ok: (t) => t.endsWith('0') },
  white: { text: 'White strip: let go when both seconds digits match (like 1:22 or 0:55).', ok: (t) => t[t.length - 1] === t[t.length - 2] },
  pink: { text: 'Pink strip: let go when the timer shows a 1 anywhere.', ok: (t) => t.includes('1') },
}

// ---------------------------------------------------------------------------
// Alien Keypad — glyph ids are drawn by the web client (glyphs.tsx).
// ---------------------------------------------------------------------------

export const GLYPH_COLUMNS: number[][] = [
  [0, 1, 2, 3, 4, 5, 6],
  [7, 0, 8, 9, 6, 10, 11],
  [12, 13, 9, 14, 2, 15, 16],
  [17, 18, 19, 12, 20, 4, 21],
  [22, 21, 23, 16, 19, 24, 7],
  [25, 14, 26, 3, 18, 22, 11],
]
export const COLUMN_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

// ---------------------------------------------------------------------------
// Say What?!
// ---------------------------------------------------------------------------

/** "" is a screen showing nothing at all. */
export const SAY_DISPLAYS = [
  'THEIR', 'THERE', "THEY'RE", 'YOUR', "YOU'RE", 'U', 'YOU', 'SEE', 'C', 'SEA', 'NO', 'KNOW',
  'NOW', 'READ', 'RED', 'REED', 'BLANK', '', 'NOTHING', 'WAIT', 'WEIGHT', 'ACHHA', 'ACHA',
  'OK', 'OKAY', 'K', 'LEFT', 'LEFT?', 'HOLD ON', 'ONE', 'WON', '1',
]
export const SAY_BUTTONS = [
  'READY', 'YES', 'NO', 'WHAT', 'WHAT?', 'UHH', 'UMM', 'LEFT', 'RIGHT', 'MIDDLE', 'OKAY', 'OK',
  'WAIT', 'PRESS', 'YOU', 'U', 'YOUR', 'UR', 'SURE', 'NEXT', 'HOLD', 'DONE', 'LIKE', 'HAAN',
  'HAAN?', 'ACHHA', 'ARRE', 'ARREY', 'BAS', 'BUS',
]
export const EMPTY_SCREEN = '(EMPTY SCREEN — nothing at all)'

/** Fixed PRNG so the printed manual is identical in every game. */
function fixedRandom(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Display word → the button words to look for, in priority order. */
export const SAY_PRIORITY: Record<string, string[]> = (() => {
  const rand = fixedRandom(0xb0b5)
  const out: Record<string, string[]> = {}
  for (const d of SAY_DISPLAYS) {
    const pool = [...SAY_BUTTONS]
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
    }
    out[d] = pool.slice(0, 8)
  }
  return out
})()

// ---------------------------------------------------------------------------
// Letter Lock
// ---------------------------------------------------------------------------

export const LOCK_WORDS = [
  'BHAJI', 'BINDI', 'BLAST', 'BRAVE', 'CHAAT', 'CHILL', 'CRASH', 'CURRY', 'DHABA', 'DOSAS',
  'DRAMA', 'FLASH', 'FUSES', 'GHOST', 'GUAVA', 'KULFI', 'LASSI', 'MANGO', 'MOVIE', 'NAANS',
  'NINJA', 'PANIC', 'PIZZA', 'PLANT', 'QUICK', 'SAREE', 'SHOUT', 'SMOKE', 'SNACK', 'SPICE',
  'STEAM', 'TEMPO', 'TIKKA', 'TIMER', 'TRAIN', 'WIRES',
]
export const LOCK_SLOT_LETTERS = 6

// ---------------------------------------------------------------------------
// Diwali Disco
// ---------------------------------------------------------------------------

export const DISCO_COLORS: DiscoColor[] = ['red', 'blue', 'green', 'yellow']
/** [strikes 0 | 1 | 2+][vowel ? 0 : 1][flash] → press */
export const DISCO_MAP: Record<DiscoColor, DiscoColor>[][] = [
  [
    { red: 'blue', blue: 'yellow', green: 'green', yellow: 'red' },
    { red: 'yellow', blue: 'red', green: 'blue', yellow: 'green' },
  ],
  [
    { red: 'yellow', blue: 'green', green: 'blue', yellow: 'red' },
    { red: 'red', blue: 'green', green: 'yellow', yellow: 'blue' },
  ],
  [
    { red: 'green', blue: 'red', green: 'yellow', yellow: 'blue' },
    { red: 'blue', blue: 'yellow', green: 'red', yellow: 'green' },
  ],
]

export function discoPress(flash: DiscoColor, strikes: number, e: Edgework): DiscoColor {
  return DISCO_MAP[Math.min(strikes, 2)]![serialHasVowel(e) ? 0 : 1]![flash]
}

// ---------------------------------------------------------------------------
// Manual pages. Each module is split into "atoms" — the smallest page that
// still makes sense on its own — so the pages can be spread over 1–7 experts.
// ---------------------------------------------------------------------------

export interface ManualAtom { title: string; blocks: ManualBlock[] }

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)
const VOWEL_NOTE = 'Serial numbers never use I, O or Y, so "has a vowel" means it contains an A, E or U.'

function wireAtom(n: number): ManualAtom {
  return {
    title: `${n} wires`,
    blocks: [
      { t: 'p', text: `For a bomb with exactly ${n} wires. Count wires from the TOP. "Last" means the bottom one. Go down the list and do the FIRST rule that fits. ${VOWEL_NOTE}` },
      { t: 'rules', heading: `${n} wires`, items: WIRE_RULES[n]!.map((r) => r.text) },
    ],
  }
}

function buttonAtom(colors: ButtonColor[]): ManualAtom {
  return {
    title: colors.map(cap).join(' & ') + ' button',
    blocks: [
      { t: 'p', text: 'TAP = press and let go straight away. HOLD = keep your thumb on it; a light strip glows — the person with the "Light strip" page says when to let go. ' + VOWEL_NOTE },
      ...colors.map((c): ManualBlock => ({ t: 'rules', heading: `${cap(c)} button`, items: BUTTON_RULES[c].map((r) => r.text) })),
    ],
  }
}

function sayAtom(displays: string[]): ManualAtom {
  const first = (d: string) => (d === '' ? 'EMPTY' : d)
  return {
    title: `Screens ${first(displays[0]!)} … ${first(displays[displays.length - 1]!)}`,
    blocks: [
      { t: 'p', text: 'Read the SCREEN at the top, not the buttons. Find it below, then press the first word from its list that is on one of the four buttons. Repeat for every stage.' },
      { t: 'table', head: ['Screen says', 'Look for, in this order'], rows: displays.map((d) => [d === '' ? EMPTY_SCREEN : d, SAY_PRIORITY[d]!.join(' · ')]) },
    ],
  }
}

function sortedDisplays(): string[] {
  return [...SAY_DISPLAYS].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
}

function chunks<T>(xs: T[], n: number): T[][] {
  const size = Math.ceil(xs.length / n)
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

function discoAtom(strikes: number): ManualAtom {
  const label = strikes === 0 ? 'No strikes yet' : strikes === 1 ? 'Exactly 1 strike' : '2 or more strikes'
  return {
    title: label,
    blocks: [
      { t: 'p', text: `Use this table only while the bomb has ${label.toLowerCase()}. The lights flash a pattern; for each flash, press the colour in the table, in order. Every correct round adds one more flash. ${VOWEL_NOTE}` },
      {
        t: 'table',
        heading: label,
        head: ['Flash', 'Serial HAS a vowel → press', 'NO vowel → press'],
        rows: DISCO_COLORS.map((c) => [cap(c), cap(DISCO_MAP[strikes]![0]![c]), cap(DISCO_MAP[strikes]![1]![c])]),
      },
    ],
  }
}

export const MANUAL_ATOMS: Record<ModuleKind, ManualAtom[]> = {
  wires: [3, 4, 5, 6].map(wireAtom),
  button: [
    buttonAtom(['red', 'blue']),
    buttonAtom(['yellow']),
    buttonAtom(['white', 'green']),
    {
      title: 'Light strip (holding)',
      blocks: [
        { t: 'p', text: 'Only if the button is being HELD. A coloured strip lights up next to it. Let go at the right moment. The timer counts down like 2:47.' },
        { t: 'rules', items: STRIP_COLORS.map((c) => STRIP_RULES[c].text) },
      ],
    },
  ],
  glyphs: chunks([0, 1, 2, 3, 4, 5], 3).map((cols) => ({
    title: `Columns ${cols.map((c) => COLUMN_LABELS[c]).join(' & ')}`,
    blocks: [
      { t: 'p', text: 'The keypad has four strange symbols. Exactly ONE column in the whole manual has all four. Press them in the order they appear in that column, top to bottom. (The other columns may be on someone else’s page.)' },
      { t: 'glyphcols', cols: cols.map((c) => ({ label: `Column ${COLUMN_LABELS[c]}`, glyphs: GLYPH_COLUMNS[c]! })) },
    ],
  })),
  saywhat: chunks(sortedDisplays(), 3).map(sayAtom),
  wheels: chunks(LOCK_WORDS, 3).map((words) => ({
    title: `Words ${words[0]} … ${words[words.length - 1]}`,
    blocks: [
      { t: 'p', text: 'Each of the five letter wheels spins through six letters. Exactly ONE word in the whole manual can be spelled. Spin to it and press SUBMIT. A wrong word is a strike.' },
      { t: 'words', words },
    ],
  })),
  disco: [0, 1, 2].map(discoAtom),
}
