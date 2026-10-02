/**
 * Bomb Squad — module generators, solvers and faces. SERVER ONLY.
 * Pure functions: randomness comes in as `rand`, time as `now`.
 */
import {
  BUTTON_COLORS, BUTTON_LABELS, BUTTON_RULES, COLUMN_LABELS, DISCO_COLORS, GLYPH_COLUMNS, LOCK_SLOT_LETTERS,
  LOCK_WORDS, MANUAL_ATOMS, MODULE_NAMES, SAY_BUTTONS, SAY_DISPLAYS, SAY_PRIORITY, SERIAL_LETTERS, STICKER_LABELS,
  STRIP_COLORS, STRIP_RULES, TAP_MAX_MS, WIRE_COLORS, WIRE_RULES, discoPress, serialHasVowel, timerText,
  type ButtonAct,
} from './content.ts'
import type {
  ButtonColor, DiscoColor, Edgework, ManualSection, ModuleFace, ModuleKind, Solution, StripColor, WireColor,
} from './shared.ts'

export type Rand = () => number

export const int = (rand: Rand, n: number) => Math.floor(rand() * n)
export const pick = <T>(rand: Rand, xs: readonly T[]): T => xs[int(rand, xs.length)]!
export function shuffle<T>(rand: Rand, xs: readonly T[]): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(rand, i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

// ---------------------------------------------------------------------------
// Module state (contains the secrets)
// ---------------------------------------------------------------------------

interface Base { id: number; solved: boolean }
export type ModuleState =
  | (Base & { kind: 'wires'; wires: WireColor[]; cut: boolean[]; answer: number; rule: number })
  | (Base & { kind: 'button'; color: ButtonColor; label: string; strip: StripColor; act: ButtonAct; rule: number; heldSince: number | null })
  | (Base & { kind: 'glyphs'; glyphs: number[]; order: number[]; pressed: boolean[]; column: number })
  | (Base & { kind: 'saywhat'; stage: number; stages: { display: string; buttons: string[]; answer: string }[] })
  | (Base & { kind: 'wheels'; slots: string[][]; index: number[]; word: string })
  | (Base & { kind: 'disco'; seq: DiscoColor[]; stage: number; entered: number })

/** Difficulty 1 (first round) .. 4 (round 4+). */
export type Difficulty = 1 | 2 | 3 | 4

export function makeEdgework(rand: Rand): Edgework {
  let serial = ''
  for (let i = 0; i < 5; i++) {
    serial += rand() < 0.55 ? pick(rand, [...SERIAL_LETTERS]) : String(int(rand, 10))
  }
  serial += String(int(rand, 10))
  const batteries = pick(rand, [0, 1, 1, 2, 2, 3, 4])
  const labels = shuffle(rand, STICKER_LABELS).slice(0, pick(rand, [0, 1, 1, 2, 2, 3]))
  return { serial, batteries, stickers: labels.map((label) => ({ label, lit: rand() < 0.5 })) }
}

export function solveWires(wires: WireColor[], e: Edgework): { answer: number; rule: number } {
  const rules = WIRE_RULES[wires.length]!
  const rule = rules.findIndex((r) => r.when(wires, e))
  return { answer: rules[rule]!.cut(wires, e), rule }
}

export function solveButton(color: ButtonColor, label: string, e: Edgework): { act: ButtonAct; rule: number } {
  const rules = BUTTON_RULES[color]
  const rule = rules.findIndex((r) => r.when(label, e))
  return { act: rules[rule]!.act, rule }
}

/** Every 4-glyph pick from one column that no other column also fully contains. */
export function glyphColumnsContaining(glyphs: number[]): number[] {
  return GLYPH_COLUMNS.flatMap((col, i) => (glyphs.every((g) => col.includes(g)) ? [i] : []))
}

export function spellable(slots: string[][], word: string): boolean {
  return [...word].every((ch, i) => slots[i]!.includes(ch))
}

export function sayAnswer(display: string, buttons: string[]): string | undefined {
  return SAY_PRIORITY[display]!.find((w) => buttons.includes(w))
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function generateModule(kind: ModuleKind, id: number, d: Difficulty, e: Edgework, rand: Rand): ModuleState {
  switch (kind) {
    case 'wires': {
      const counts = d === 1 ? [3, 4] : d === 2 ? [3, 4, 5] : d === 3 ? [4, 5, 6] : [5, 6]
      const wires = Array.from({ length: pick(rand, counts) }, () => pick(rand, WIRE_COLORS))
      const { answer, rule } = solveWires(wires, e)
      return { kind, id, solved: false, wires, cut: wires.map(() => false), answer, rule }
    }
    case 'button': {
      const color = pick(rand, BUTTON_COLORS)
      const label = pick(rand, BUTTON_LABELS)
      const { act, rule } = solveButton(color, label, e)
      return { kind, id, solved: false, color, label, strip: pick(rand, STRIP_COLORS), act, rule, heldSince: null }
    }
    case 'glyphs': {
      for (;;) {
        const column = int(rand, GLYPH_COLUMNS.length)
        const chosen = shuffle(rand, GLYPH_COLUMNS[column]!).slice(0, 4)
        if (glyphColumnsContaining(chosen).length !== 1) continue
        const order = GLYPH_COLUMNS[column]!.filter((g) => chosen.includes(g))
        return { kind, id, solved: false, glyphs: chosen, order, pressed: [false, false, false, false], column }
      }
    }
    case 'saywhat': {
      const n = d <= 2 ? 2 : 3
      const stages = Array.from({ length: n }, () => {
        const display = pick(rand, SAY_DISPLAYS)
        const buttons = shuffle(rand, SAY_BUTTONS).slice(0, 4)
        if (!sayAnswer(display, buttons)) {
          const options = SAY_PRIORITY[display]!.filter((w) => !buttons.includes(w))
          buttons[int(rand, 4)] = pick(rand, options)
        }
        return { display, buttons, answer: sayAnswer(display, buttons)! }
      })
      return { kind, id, solved: false, stage: 0, stages }
    }
    case 'wheels': {
      const word = pick(rand, LOCK_WORDS)
      const slots = [...word].map((ch) => {
        const others = shuffle(rand, [...ALPHABET].filter((c) => c !== ch)).slice(0, LOCK_SLOT_LETTERS - 1)
        return shuffle(rand, [ch, ...others])
      })
      // Knock out letters until the target is the only spellable word.
      for (let guard = 0; guard < 500; guard++) {
        const rival = LOCK_WORDS.find((w) => w !== word && spellable(slots, w))
        if (!rival) break
        const i = [...rival].findIndex((ch, k) => ch !== word[k])
        const slot = slots[i]!
        const spare = [...ALPHABET].filter((c) => !slot.includes(c))
        slot[slot.indexOf(rival[i]!)] = pick(rand, spare)
      }
      const index = slots.map(() => int(rand, LOCK_SLOT_LETTERS))
      if (slots.every((s, i) => s[index[i]!] === word[i])) index[0] = (index[0]! + 1) % LOCK_SLOT_LETTERS
      return { kind, id, solved: false, slots, index, word }
    }
    case 'disco': {
      const len = d <= 2 ? 3 : d === 3 ? 4 : 5
      return { kind, id, solved: false, seq: Array.from({ length: len }, () => pick(rand, DISCO_COLORS)), stage: 1, entered: 0 }
    }
  }
}

// ---------------------------------------------------------------------------
// Faces & solutions
// ---------------------------------------------------------------------------

export function faceOf(m: ModuleState): ModuleFace {
  switch (m.kind) {
    case 'wires': return { kind: 'wires', wires: m.wires.map((color, i) => ({ color, cut: m.cut[i]! })) }
    case 'button': return { kind: 'button', color: m.color, label: m.label, held: m.heldSince !== null, strip: m.heldSince !== null ? m.strip : null }
    case 'glyphs': return { kind: 'glyphs', glyphs: [...m.glyphs], pressed: [...m.pressed] }
    case 'saywhat': {
      const s = m.stages[Math.min(m.stage, m.stages.length - 1)]!
      return { kind: 'saywhat', stage: m.stage, stages: m.stages.length, display: m.solved ? '✓' : s.display, buttons: [...s.buttons] }
    }
    case 'wheels': return { kind: 'wheels', slots: m.slots.map((letters, i) => ({ letters: [...letters], index: m.index[i]! })) }
    case 'disco': return { kind: 'disco', stage: m.stage, stages: m.seq.length, flashes: m.seq.slice(0, Math.min(m.stage, m.seq.length)), entered: m.entered }
  }
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)
const ordinal = (n: number) => ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'][n] ?? `#${n + 1}`

export function solutionOf(m: ModuleState, e: Edgework, strikes: number): Solution {
  switch (m.kind) {
    case 'wires':
      return {
        text: `Cut the ${ordinal(m.answer)} wire (${m.wires[m.answer]})`,
        why: `${m.wires.length} wires, rule ${m.rule + 1}: ${WIRE_RULES[m.wires.length]![m.rule]!.text}`,
      }
    case 'button': {
      const why = `${cap(m.color)} button: ${BUTTON_RULES[m.color][m.rule]!.text}`
      return m.act === 'tap'
        ? { text: 'TAP it', why }
        : { text: `HOLD it. ${STRIP_RULES[m.strip].text}`, why }
    }
    case 'glyphs':
      return { text: 'Press in this order', glyphs: [...m.order], why: `Only column ${COLUMN_LABELS[m.column]} has all four` }
    case 'saywhat': {
      const s = m.stages[Math.min(m.stage, m.stages.length - 1)]!
      return { text: `Stage ${Math.min(m.stage, m.stages.length - 1) + 1}: press ${s.answer}`, why: `Screen says ${s.display === '' ? 'nothing (empty)' : `“${s.display}”`}` }
    }
    case 'wheels':
      return { text: `Spell ${m.word}` }
    case 'disco': {
      const presses = m.seq.slice(0, m.stage).map((c) => cap(discoPress(c, strikes, e)))
      return {
        text: `Press ${presses.join(' → ')}`,
        why: `${strikes} strike${strikes === 1 ? '' : 's'}, serial ${serialHasVowel(e) ? 'has' : 'has no'} vowel`,
      }
    }
  }
}

export const moduleName = (k: ModuleKind) => MODULE_NAMES[k]

// ---------------------------------------------------------------------------
// Playing a module
// ---------------------------------------------------------------------------

export type Outcome = 'ok' | 'solved' | 'strike'
export interface ModuleStep { module: ModuleState; outcome: Outcome; error?: string }

export interface PlayCtx {
  now: number
  explodeAt: number
  strikes: number
  edgework: Edgework
}

/** Moments checked on a button release, to forgive network lag. */
const RELEASE_LAG_MS = [0, 250, 500, 750]

export function playModule(m: ModuleState, type: string, p: Record<string, unknown>, c: PlayCtx): ModuleStep {
  const fail = (error: string): ModuleStep => ({ module: m, outcome: 'ok', error })
  if (m.solved) return fail('That module is already disarmed')
  const index = typeof p.index === 'number' && Number.isInteger(p.index) ? p.index : -1

  switch (m.kind) {
    case 'wires': {
      if (type !== 'cut') return fail('Wrong control')
      if (index < 0 || index >= m.wires.length) return fail('No such wire')
      if (m.cut[index]) return fail('That wire is already cut')
      const cut = m.cut.map((x, i) => x || i === index)
      const right = index === m.answer
      return { module: { ...m, cut, solved: right }, outcome: right ? 'solved' : 'strike' }
    }
    case 'button': {
      if (type === 'buttonDown') {
        if (m.heldSince !== null) return { module: m, outcome: 'ok' }
        return { module: { ...m, heldSince: c.now }, outcome: 'ok' }
      }
      if (type !== 'buttonUp') return fail('Wrong control')
      if (m.heldSince === null) return { module: m, outcome: 'ok' }
      const held = c.now - m.heldSince
      const released = { ...m, heldSince: null }
      let right: boolean
      if (m.act === 'tap') right = held <= TAP_MAX_MS
      else right = held > TAP_MAX_MS && RELEASE_LAG_MS.some((lag) => STRIP_RULES[m.strip].ok(timerText(c.explodeAt - (c.now - lag))))
      return { module: { ...released, solved: right }, outcome: right ? 'solved' : 'strike' }
    }
    case 'glyphs': {
      if (type !== 'glyph') return fail('Wrong control')
      if (index < 0 || index > 3) return fail('No such key')
      if (m.pressed[index]) return fail('Already pressed')
      const done = m.pressed.filter(Boolean).length
      if (m.glyphs[index] !== m.order[done]) return { module: m, outcome: 'strike' }
      const pressed = m.pressed.map((x, i) => x || i === index)
      const solved = pressed.every(Boolean)
      return { module: { ...m, pressed, solved }, outcome: solved ? 'solved' : 'ok' }
    }
    case 'saywhat': {
      if (type !== 'say') return fail('Wrong control')
      const s = m.stages[m.stage]!
      if (index < 0 || index > 3) return fail('No such button')
      if (s.buttons[index] !== s.answer) return { module: m, outcome: 'strike' }
      const stage = m.stage + 1
      const solved = stage >= m.stages.length
      return { module: { ...m, stage: solved ? m.stage : stage, solved }, outcome: solved ? 'solved' : 'ok' }
    }
    case 'wheels': {
      if (type === 'wheel') {
        const slot = typeof p.slot === 'number' && Number.isInteger(p.slot) ? p.slot : -1
        const dir = p.dir === 1 || p.dir === -1 ? p.dir : 0
        if (slot < 0 || slot >= m.slots.length || dir === 0) return fail('No such wheel')
        const n = m.slots[slot]!.length
        const next = m.index.map((v, i) => (i === slot ? (v + dir + n) % n : v))
        return { module: { ...m, index: next }, outcome: 'ok' }
      }
      if (type !== 'submitWheels') return fail('Wrong control')
      const word = m.slots.map((s, i) => s[m.index[i]!]).join('')
      const right = word === m.word
      return { module: { ...m, solved: right }, outcome: right ? 'solved' : 'strike' }
    }
    case 'disco': {
      if (type !== 'disco') return fail('Wrong control')
      const color = p.color
      if (!DISCO_COLORS.includes(color as DiscoColor)) return fail('No such light')
      const expected = discoPress(m.seq[m.entered]!, c.strikes, c.edgework)
      if (color !== expected) return { module: { ...m, entered: 0 }, outcome: 'strike' }
      const entered = m.entered + 1
      if (entered < m.stage) return { module: { ...m, entered }, outcome: 'ok' }
      const stage = m.stage + 1
      if (stage > m.seq.length) return { module: { ...m, entered: 0, solved: true }, outcome: 'solved' }
      return { module: { ...m, stage, entered: 0 }, outcome: 'ok' }
    }
  }
}

/** A dropped defuser must not leave a button "held" for the new one. */
export function releaseHolds(m: ModuleState): ModuleState {
  return m.kind === 'button' && m.heldSince !== null ? { ...m, heldSince: null } : m
}

// ---------------------------------------------------------------------------
// Manual splitting
// ---------------------------------------------------------------------------

export interface SectionDef { id: string; kind: ModuleKind; atoms: number[] }

/**
 * Split the manual for these module kinds into pages for `experts` people.
 * Starts with one page per module and halves the biggest page until there is
 * a page per expert (or nothing left to split).
 */
export function makeSections(kinds: ModuleKind[], experts: number): SectionDef[] {
  let sections: SectionDef[] = kinds.map((kind) => ({ id: '', kind, atoms: MANUAL_ATOMS[kind].map((_, i) => i) }))
  while (sections.length < experts) {
    let big = -1
    sections.forEach((s, i) => { if (s.atoms.length > 1 && (big < 0 || s.atoms.length > sections[big]!.atoms.length)) big = i })
    if (big < 0) break
    const s = sections[big]!
    const half = Math.ceil(s.atoms.length / 2)
    sections = [...sections.slice(0, big), { ...s, atoms: s.atoms.slice(0, half) }, { ...s, atoms: s.atoms.slice(half) }, ...sections.slice(big + 1)]
  }
  return sections.map((s) => ({ ...s, id: `${s.kind}:${s.atoms.join('')}` }))
}

export interface Holding { sectionId: string; copy: boolean }

/** Deal pages to experts: whole modules stay together, extra experts get backup copies. */
export function dealSections(sections: SectionDef[], experts: string[]): Record<string, Holding[]> {
  const out: Record<string, Holding[]> = Object.fromEntries(experts.map((p) => [p, []]))
  if (experts.length === 0) return out
  const load = experts.map(() => 0)
  for (const s of sections) {
    let best = 0
    load.forEach((l, i) => { if (l < load[best]!) best = i })
    out[experts[best]!]!.push({ sectionId: s.id, copy: false })
    load[best]! += s.atoms.length
  }
  experts.forEach((p, i) => {
    if (out[p]!.length === 0) out[p]!.push({ sectionId: sections[i % sections.length]!.id, copy: true })
  })
  return out
}

export function renderSection(s: SectionDef, extra: Partial<ManualSection> = {}): ManualSection {
  const atoms = s.atoms.map((i) => MANUAL_ATOMS[s.kind][i]!)
  const whole = s.atoms.length === MANUAL_ATOMS[s.kind].length
  return {
    id: s.id,
    kind: s.kind,
    module: MODULE_NAMES[s.kind],
    title: whole ? 'Full page' : atoms.map((a) => a.title).join(' + '),
    blocks: atoms.flatMap((a, i) => (i === 0 ? a.blocks : a.blocks.filter((b) => b.t !== 'p'))),
    ...extra,
  }
}
