import { z } from 'zod'
import type { ClientMessage } from '../shared/protocol.ts'

const id = z.string().min(1).max(64)
const payload = z.record(z.string(), z.unknown())

export const MAX_NAME = 20
export const MAX_TEAM_NAME = 30
export const MAX_CHAT = 200

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    code: z.string().min(1).max(10),
    token: z.string().max(100).nullable(),
    name: z.string().max(60),
    avatar: z.string().max(32),
  }),
  z.object({ t: z.literal('room/setTeams'), count: z.number().int().min(1).max(6) }),
  z.object({ t: z.literal('room/shuffleTeams') }),
  z.object({ t: z.literal('room/movePlayer'), playerId: id, teamId: id }),
  z.object({ t: z.literal('room/renameTeam'), teamId: id, name: z.string().max(80) }),
  z.object({ t: z.literal('room/pickGame'), gameId: id }),
  z.object({ t: z.literal('room/settings'), settings: payload }),
  z.object({ t: z.literal('room/start') }),
  z.object({ t: z.literal('room/playAgain') }),
  z.object({ t: z.literal('room/backToLobby') }),
  z.object({ t: z.literal('room/kick'), playerId: id }),
  z.object({ t: z.literal('room/teamChat'), text: z.string().max(1000) }),
  z.object({ t: z.literal('game'), type: z.string().min(1).max(64), payload: payload.default({}) }),
  z.object({ t: z.literal('ping') }),
])

// Compile-time check that the schema and the frozen protocol agree.
type Parsed = z.infer<typeof clientMessageSchema>
const _check: (m: Parsed) => ClientMessage = (m) => m
void _check

export function parseClientMessage(raw: string): ClientMessage | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const r = clientMessageSchema.safeParse(json)
  return r.success ? r.data : null
}

/** Collapse whitespace, strip control chars, clamp length (by code points). */
export function cleanText(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const flat = s.replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(flat).slice(0, max).join('').trim()
}

/** Keep the first grapheme of an avatar, fall back to a default. */
export function cleanAvatar(s: string): string {
  const trimmed = s.trim()
  if (!trimmed) return '🙂'
  const seg = new Intl.Segmenter('en', { granularity: 'grapheme' })
  const first = seg.segment(trimmed)[Symbol.iterator]().next().value?.segment ?? '🙂'
  return first.length > 16 ? '🙂' : first
}
