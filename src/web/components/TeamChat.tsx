import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatMessage, PlayerInfo, TeamInfo } from '../../shared/protocol.ts'
import { Avatar, Sheet, cn, playSound, COLOR } from '../ui/index.ts'

/** Floating 💬 button + bottom sheet with the private team chat. */
export function TeamChat({ messages, me, team, players, onSend }: {
  messages: ChatMessage[]
  me: PlayerInfo
  team: TeamInfo | undefined
  players: PlayerInfo[]
  onSend: (text: string) => boolean
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [seen, setSeen] = useState(() => messages.at(-1)?.id ?? null)
  const listRef = useRef<HTMLDivElement>(null)
  const last = messages.at(-1)

  const seenIdx = seen ? messages.findIndex((m) => m.id === seen) : -1
  const unread = open ? 0 : messages.slice(seenIdx + 1).filter((m) => m.playerId !== me.id).length

  useEffect(() => {
    if (open && last) setSeen(last.id)
  }, [open, last])

  useEffect(() => {
    if (!open && last && last.playerId !== me.id) playSound('ding')
    // only on a new message
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id])

  useEffect(() => {
    if (open) listRef.current?.lastElementChild?.scrollIntoView({ block: 'end' })
  }, [open, messages.length])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    if (onSend(t)) setText('')
  }

  const byId = (id: string) => players.find((p) => p.id === id)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Team chat${unread ? `, ${unread} unread` : ''}`}
        data-testid="team-chat-button"
        className={cn(
          'fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 grid size-16 place-items-center rounded-full border-3 border-ink text-3xl shadow-hard',
          'active:translate-x-1 active:translate-y-1 active:shadow-none',
          team ? COLOR[team.color].bg : 'bg-white',
        )}
      >
        <span aria-hidden className={cn(unread > 0 && 'animate-wiggle-loop')}>💬</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 grid h-7 min-w-7 animate-pop place-items-center rounded-full border-3 border-ink bg-tomato px-1 font-display text-sm font-black text-white" data-testid="team-chat-unread">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <span aria-hidden>🤫</span> {team ? `${team.name} only` : 'Team chat'}
          </span>
        }
        footer={
          <form onSubmit={submit} className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={200}
              placeholder="Psst… only your team sees this"
              aria-label="Team chat message"
              enterKeyHint="send"
              className="min-h-12 min-w-0 flex-1 rounded-2xl border-3 border-ink bg-paper px-4 text-base font-semibold focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!text.trim()}
              className="grid size-12 shrink-0 place-items-center rounded-2xl border-3 border-ink bg-sun text-xl shadow-hard-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-50"
            >
              ➤
            </button>
          </form>
        }
      >
        <div ref={listRef} className="flex min-h-48 flex-col gap-2.5" data-testid="team-chat-list">
          {messages.length === 0 && (
            <p className="py-10 text-center text-ink-soft">
              Your rivals can hear everything on the call.
              <br />
              Type the sneaky stuff here. <span aria-hidden>🕵️</span>
            </p>
          )}
          {messages.map((m) => {
            const p = byId(m.playerId)
            const mine = m.playerId === me.id
            return (
              <div key={m.id} className={cn('flex items-end gap-2', mine && 'flex-row-reverse')}>
                <Avatar emoji={p?.avatar ?? '👤'} size="xs" />
                <div
                  className={cn(
                    'max-w-[78%] rounded-2xl border-2 border-ink px-3 py-2 shadow-hard-sm',
                    mine ? `${team ? COLOR[team.color].soft : 'bg-sun-soft'} rounded-br-sm` : 'rounded-bl-sm bg-white',
                  )}
                >
                  {!mine && <p className="text-xs font-bold text-ink-soft">{p?.name ?? 'Someone'}</p>}
                  <p className="break-words">{m.text}</p>
                </div>
              </div>
            )
          })}
        </div>
      </Sheet>
    </>
  )
}
