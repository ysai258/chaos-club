# The Chaos Club platform, for game builders

Everything a game agent needs: how your server game is driven, what your
`<Screen>` receives, the UI kit, how to run the stack on your own ports, and
the e2e helpers.

Contract files (frozen): `src/shared/protocol.ts`, `src/games/types.ts`,
`src/web/games/types.ts`. This doc describes how the platform *uses* them.

---

## 1. How the server drives your `GameDefinition`

| When | The platform calls |
| --- | --- |
| Lobby shows settings | `parseSettings(raw)` (on pick and on every host change; merged with previous values) |
| Host taps Start | `create({ ...ctx, settings })` |
| After every state change, and for every connected viewer | `view(state, viewerId, ctx)` |
| A player sends `send(type, payload)` | `action(state, playerId, { type, payload }, ctx)` |
| After every change | `deadline(state)` → one `setTimeout` per room |
| When the deadline is due | `tick(state, ctx)` — repeated while `deadline(state) <= now` (so ticks can chain) |
| A player has been disconnected for 30 s, or is kicked | `onPlayerGone(state, playerId, ctx)` |
| After every change | `isOver(state)`; when true: `scores(state)` + `results(state, ctx)`, phase → results |
| Every broadcast | `scores(state)` for the header scoreboard |

Details that matter:

- **Who exists for your game**: `ctx.players` and `ctx.teams` are the players
  who were **connected and on a team when Start was pressed**, frozen for the
  whole game (their `connected` flag stays live). Players who join mid-game
  are parked on the smallest team as spectators: they get your `view(...)`
  with an id you have never seen (render a spectator view, don't crash), and
  their `send` is rejected by the platform with "You're watching this round".
  Kicked players stay in `ctx.players` with `connected: false`.
- **Teams are locked during a game** (no moves/renames until back in lobby).
- **`ctx.random`** is a seeded mulberry32 PRNG, fresh per call. `ctx.now` is
  `Date.now()` at call time.
- **Events**: `Step.events` are sent *after* the new snapshot. `to: { teamId }`
  reaches the players who started the game on that team (never a late
  joiner). `to: { playerIds }` reaches exactly those players. No `to` = all.
- **Errors**: `Step.error` → that player gets an error toast with your text
  (state unchanged). If your code **throws**, the platform catches it, logs
  it, and the player sees "The game tripped over that". If `tick` throws 5
  times in a row the room goes back to the lobby. If `view` throws, that
  viewer gets `{ error: 'view_failed' }` as the view.
- **Deadline guard**: if `tick` runs 50 times without moving the deadline into
  the future, the platform backs off and retries after 1 s. Always move the
  deadline forward (or to `null`) in `tick`.
- **Ranking** is computed from `scores(state)`: higher is better, ties share
  a rank (1, 1, 3). Teams missing from `scores` count as 0.
- `results(state, ctx)` → `{ highlights: string[], awards?: [...] }`.
  Highlights render as sticker cards; awards as player cards (name + avatar
  are looked up by `playerId`).
- **Team chat**: if `meta.teamChat` is true, a 💬 button appears in-game and
  `room.teamChat` holds the viewer's own team's last 50 messages (max 200
  chars each, rate limited). Chat is cleared at each Start.
- **Start rules** (enforced on the server, explained in the lobby): connected
  players between `minPlayers` and `maxPlayers`, team count within
  `meta.teams`, every team with at least `max(1, minTeamSize)` connected
  players. Picking your game auto-clamps the team count into `meta.teams`.

## 2. Your `<Screen>`: `GameScreenProps`

```tsx
import type { GameScreenProps, WebGame } from '../types.ts'
import type { MyView } from '../../../games/my-game/shared.ts' // TYPES ONLY

function Screen({ view, me, deadline, send, onEvent, team }: GameScreenProps<MyView>) {
  useEffect(() => onEvent((type, data) => {
    if (type === 'boom') { playSound('boom'); haptic('buzz') }
  }), [onEvent])
  return <Button onClick={() => send('cut', { wire: 2, round: view.round })}>Cut</Button>
}
export const myGameWeb: WebGame = { id: 'my-game', Screen }
```

| Prop | What it is |
| --- | --- |
| `view` | Whatever your server `view()` returned for this viewer. |
| `me` | This viewer's `PlayerInfo` (`id`, `name`, `avatar`, `teamId`, `connected`, `isHost`). |
| `players`, `teams` | Everyone in the room (including late joiners), and all teams with colours/emojis. |
| `deadline` | Your `deadline(state)` as **server epoch ms**, or null. |
| `now()` | **Server-corrected** `Date.now()`. `deadline - now()` = ms left on every phone alike. Use this, not `Date.now()`, for anything compared with server times (including deadlines you put in your view). |
| `scores` | `scores(state)` per team id. |
| `send(type, payload?)` | Sends `{ t: 'game', type, payload }`. Fire-and-forget: the new view arrives in the next snapshot; a rejection (`Step.error`) shows as a toast automatically. If the socket is down the player gets a "Reconnecting…" toast and nothing is sent. Include a round/turn id in payloads so stale taps can be rejected. |
| `onEvent(handler)` | Subscribe to your game's events. Returns the unsubscribe function — return it from `useEffect`. Stable identity across renders. |
| `player(id)`, `team(id)` | Lookups into `players` / `teams`. |
| `room` | The full `RoomSnapshot` if you need anything else. |

The platform already renders, around your screen: sticky header (room code,
team score pills, mute, ⋯ menu with how-to-play and host "End game"), a
countdown bar under the header whenever `deadline` is non-null, a reconnect
banner, the team chat button (bottom-right, 64 px — keep the bottom-right
corner free when `meta.teamChat` is on; the main area already has bottom
padding for it), and an error boundary. Your screen sits in a centred column,
`max-width: 520px`, with side padding. To go wider (drawing canvas), use
negative margins or `w-screen max-w-3xl` carefully and run
`expectNoHorizontalScroll`.

`id` attributes are not needed by the platform. Prefer `data-testid` for e2e.

## 3. The UI kit — `src/web/ui/`

```tsx
import { Button, Card, Badge, Avatar, TeamPill, Countdown, BigText, Sheet, toast,
  Input, Spinner, Stepper, Segmented, Toggle, MuteToggle,
  useCountdown, useNow, useClock, haptic, playSound, useSound, celebrate,
  COLOR, colorVar, cn } from '../../ui/index.ts'
```

(Path is relative to `src/web/games/<id>/index.tsx`.)

### Design tokens (Tailwind 4, in `src/web/styles.css`)

- Colours: `tomato`, `sky`, `lime`, `grape`, `sun`, `bubblegum`, plus `ink`
  (text/outlines) and `paper` (cream background). Each palette colour has a
  `-soft` tint: `bg-sky-soft`. Also `ink-soft` (muted text), `paper-deep`.
- Fonts: `font-display` (Bricolage Grotesque, headings/buttons),
  `font-body` (DM Sans, default), `font-chunky` (Rubik Mono One, codes/scores — use sparingly).
- Shadows: `shadow-hard-sm` (2px), `shadow-hard` (4px), `shadow-hard-lg` (6px), `shadow-hard-xl`.
- Outlines: `border-3 border-ink` is the house style (`border-2` for small things).
- Animations: `animate-wiggle`, `animate-wiggle-loop`, `animate-pop`, `animate-shake`,
  `animate-float`, `animate-slide-up`, `animate-fade-in`, `animate-pulse-soft`, `animate-bounce-dot`.
  Re-trigger an animation by changing the element's `key`.
- Utilities: `text-outline` / `text-outline-thick` (ink stroke on letters), `safe-top`, `safe-bottom`, `safe-x`, `no-scrollbar`.
- **Team colours dynamically**: never write `` `bg-${team.color}` `` — Tailwind
  won't generate it. Use `COLOR[team.color].bg` / `.soft` / `.text` / `.border` / `.fill`,
  or inline `style={{ background: colorVar(team.color) }}`.

Phone rules: tap targets ≥ 44 px (`min-h-11`, `size-11`), inputs ≥ 16 px text
(the base CSS enforces it), no horizontal scroll, design at 360–390 px wide.

### `Button`

Props: all `<button>` props, plus `variant` (`'primary'` sun / `'secondary'`
white / `'danger'` tomato / `'success'` lime / `'dark'` ink / `'ghost'`),
`color?: TeamColor` (overrides the variant colour), `size` (`'sm'` 44px,
`'md'` 48px, `'lg'` 56px, `'xl'` 64px), `block` (full width), `loading`,
`icon` (emoji before the label), `feedback` (haptic + click sound, default true).
Squishes into its shadow on press.

```tsx
<Button size="xl" block icon="✂️" onClick={cut}>Cut the wire</Button>
<Button color={team.color} icon={team.emoji}>Vote {team.name}</Button>
<Button variant="secondary" size="sm" loading={busy}>Skip</Button>
```

`IconButton` — square icon-only button: `<IconButton label="Close" onClick={...}>✕</IconButton>` (`size: 'sm' | 'md'`).

### `Card`

Props: div props + `color` (`TeamColor | 'white' | 'paper' | 'ink'`, default white),
`soft` (use the tint), `tilt` (`'left' | 'right' | 'none'`), `shadow` (`'none'|'sm'|'md'|'lg'`), `padding` (`'none'|'sm'|'md'|'lg'`).

```tsx
<Card color="sky" soft tilt="left">Your word is <b>{view.word}</b></Card>
```

### `Input`

Input props + `label`, `hint`, `error` (red text + shake), `wrapperClassName`.

```tsx
<Input label="Your guess" value={g} onChange={(e) => setG(e.target.value)} maxLength={40} enterKeyHint="send" />
```

### `Badge`

`color` (`TeamColor | 'ink' | 'white'`), `size` (`'sm' | 'md'`).
`<Badge color="lime">+2</Badge>`

### `Avatar`

`emoji`, `color?: TeamColor`, `size` (`'xs' | 'sm' | 'md' | 'lg' | 'xl'`),
`host` (crown), `connected` (dims + 💤 when false), `name` (label under),
`active` (pulsing ring, e.g. current turn).

```tsx
<Avatar emoji={p.avatar} name={p.name} color={team(p.teamId!)?.color} active={p.id === view.turn} connected={p.connected} />
```

### `TeamPill`

`team` (`{ name, emoji, color }`), `score?`, `active?` (lifts + wiggles),
`compact?` (emoji only), `size` (`'sm' | 'md'`).
`<TeamPill team={t} score={scores[t.id]} active={t.id === view.turnTeam} />`

### `Countdown`

`deadline: number | null` (server epoch ms — pass `deadline` straight from
props, or a deadline from your view), `variant` (`'bar'` | `'badge'` | `'big'`),
`warnAt` (seconds, default 5: turns red and shakes), `tickSound` (tick each
second in the warning zone). Uses the room's server-corrected clock
automatically. The header already shows a bar for the main `deadline`; use
`badge`/`big` inside your screen for emphasis.

```tsx
<Countdown deadline={deadline} variant="big" tickSound />
```

Hooks: `useCountdown(deadline)` → `{ msLeft, secondsLeft, fraction, running }`;
`useNow(intervalMs = 250)` re-renders and returns server-corrected now;
`useClock()` returns the `now()` function.

### `BigText`

Shouty outlined headline. `color` (`TeamColor | 'white' | 'ink'`, default sun),
`size` (`'md' | 'lg' | 'xl'`), `font` (`'display' | 'chunky'`), `animate`
(pop in, default true), `as` (tag, default h2).

```tsx
<BigText key={view.round} color="tomato" size="xl">BOOM!</BigText>
```

### `Sheet`

Bottom sheet on phones, dialog on desktop. `open`, `onClose`, `title?`,
`footer?` (sticky area, e.g. input), `maxHeight?` (default `85dvh`).
Closes on backdrop / Escape / ✕.

```tsx
<Sheet open={open} onClose={() => setOpen(false)} title="Your secret card">
  <p>{view.secret}</p>
</Sheet>
```

### `toast(message, { kind?, emoji?, durationMs? })`

Call from anywhere; no hook. `kind`: `'info' | 'success' | 'error'` (error
buzzes and plays a sound). Server errors already toast automatically.
`toast('Nice one!', { kind: 'success', emoji: '🔥' })`

### `Spinner`

`size` (`'sm' | 'md' | 'lg'`), `label`.

### Form controls

- `Stepper` — `value`, `onChange`, `min`, `max`, `step?`, `disabled?`, `suffix?`, `label?`
- `Segmented` — `value`, `options: { value, label }[]`, `onChange`, `color?`, `disabled?`, `label?`
- `Toggle` — `checked`, `onChange`, `disabled?`, `label?`
- `MuteToggle` — 🔊/🔇 button (already in the header).

### Feedback

- `haptic(kind)` / `useHaptics()` — `'tap' | 'success' | 'error' | 'buzz' | 'heavy'`
  (`navigator.vibrate`; silently no-op on iOS; respects mute).
- `playSound(name)` / `useSound()` → `{ play, muted, toggle, setMuted }` — synthesized
  WebAudio blips: `'tap' | 'pop' | 'success' | 'error' | 'tick' | 'boom' | 'win' | 'buzz' | 'whoosh' | 'ding'`.
  Muted state is persisted (`localStorage['chaos:muted']`).
- `celebrate('big' | 'small')` — palette confetti. The platform fires it only on the results screen, only for the winning team. In-game confetti is yours to fire — keep it for genuinely good moments for the viewer (not every reveal).

### Misc

`cn(...classes)`, `COLOR`, `PALETTE`, `colorVar(color, soft?)`.

## 4. Running the stack

```bash
npm run dev                                  # server :8787 + web :5199
SERVER_PORT=8801 WEB_PORT=5301 npm run dev   # your own ports (Vite proxies /api and /ws to SERVER_PORT)
```

Ports are strict: if one is taken, Vite fails instead of hopping. Open
`http://localhost:<WEB_PORT>`. In dev `/api` and `/ws` are proxied to the server.

Handy endpoints: `POST /api/rooms` → `{ code }`, `GET /api/rooms/:code`,
`GET /api/games`, `GET /health`.

## 5. E2E

```bash
SERVER_PORT=8801 WEB_PORT=5301 npx playwright test tests/games/my-game --project=mobile-chrome
```

`playwright.config.ts` starts the dev stack itself (no build) on those ports;
with custom ports it never reuses an existing server. Projects:
`mobile-chrome` (Pixel 7) and `desktop-chrome`. WebKit is not installed here.
Default workers: 2 (`E2E_WORKERS` overrides).

Helpers in `tests/helpers/e2e.ts`:

| Helper | What it does |
| --- | --- |
| `createRoom(browser, { players?, names?, viewport?, baseURL? })` → `E2ERoom` | Creates a room via the API and joins N phones (separate contexts, 390×844, touch). Host = first. Default names: Asha, Ben, Chen, Dev, … Teams are auto-balanced in join order (Asha→team 0, Ben→team 1, Chen→team 0, …). |
| `room.code`, `room.host`, `room.pages`, `room.players` (`{ name, page, context }`), `room.page('Ben')`, `room.close()` | |
| `setTeams(room, [['Asha','Chen'], ['Ben','Dev']])` | Arranges teams by name through the host's lobby UI (also sets the team count). Call `pickGame` first if your game needs >2 teams. |
| `pickGame(host, 'bomb-squad', { rounds: 3, mode: 'Chaos', hints: true })` | Picks the game and sets settings through the generic form. The control type is detected from the row (switch / options / stepper); select values use the option **label**. Numeric option values are fine in `settingsSpec`: the form compares with `String()` and sends back the option's original value. |
| `startGame(room)` | Taps Start (fails with the blocker reason if disabled) and waits for every phone to show the game. |
| `waitForResults(page, timeout?)` | Waits for the results screen. |
| `endGame(room)` | Host ends the game from the ⋯ menu; everyone back in lobby. |
| `joinRoom(page, code, name, avatarIndex?)` | Join one more page (e.g. a late joiner). |
| `expectNoHorizontalScroll(page)` | Fails if the page scrolls sideways. |
| `expectTapTargets(page, min = 44)` | Fails listing any visible control smaller than 44 px. |
| `getEvents(page)` | Game events this page has received so far (last 200, oldest first): `{ type, data, at }[]`. Works at any time (the client records them on `window.__chaosEvents`). |
| `clearEvents(page)` | Forget recorded events, e.g. right before the action you want to observe. |
| `waitForEvent(page, type, where?, timeout?)` | Polls until an event of `type` (optionally matching `where(data)`) arrives; returns it. |
| `tap(locator)` | Scrolls the element to the middle of the screen, then clicks. Use it for anything near the sticky header/footer. |

**Clicking reliably.** Playwright refuses to click a button that is
animating forever (`element is not stable`). Never put an infinite animation
(`animate-wiggle-loop`, `animate-pulse-soft`, `animate-float`) on a button
itself: animate an inner `<span>` instead. One-shot animations are fine.

**No overflow, not even for one frame.** On phones, if anything pokes past
the screen edge even during an animation, mobile Chrome widens the layout
viewport for good: the page can then pan sideways and fixed/sticky bars drift
off their hit areas (clicks land on the wrong element). Don't scale or
translate full-width blocks beyond their gutter (the kit's `animate-pop`
overshoots only 4%). `expectNoHorizontalScroll` catches this on touch contexts.
Also: a bare `grid` (no `grid-cols-*`) sizes its implicit column to the
content's max width, so a long name with `truncate` inside a card can push the
card past the screen. Write `grid grid-cols-1` (= `minmax(0, 1fr)`) and give
flex children that hold text `min-w-0`. When it fails, the helper's message
lists the elements that overflow.

**The test game.** E2E runs start the server with `CHAOS_TEST_GAME=1`, which
adds the platform's own "Test Lab" (`test-lab`, src/server/test-game.ts +
src/web/pages/TestLabScreen.tsx) to the lobby picker, after the six real
games. It never appears on the landing page or in production. Its screen is a
compact example of a game built from the kit.

Useful test ids: `lobby`, `game-view`, `results`, `scoreboard`, `room-code`,
`team-0..n`, `team-name`, `player-chip`, `start-game`, `start-blocker`,
`game-card-<id>`, `game-info-<id>`, `setting-<key>`, `team-chat-button`,
`team-chat-unread`, `team-chat-list`, `play-again`, `back-to-lobby`,
`podium-score`, `my-rank`, `connection-banner`.

Example:

```ts
import { test, expect } from '@playwright/test'
import { createRoom, pickGame, startGame, waitForResults, expectNoHorizontalScroll } from '../../helpers/e2e.ts'

test('two teams play a full game', async ({ browser }) => {
  const room = await createRoom(browser, { players: 4 })
  await pickGame(room.host, 'my-game', { rounds: 1 })
  await startGame(room)
  for (const p of room.pages) await expectNoHorizontalScroll(p)
  await room.page('Ben').getByRole('button', { name: 'Buzz' }).click()
  // ...
  await waitForResults(room.host)
  await room.close()
})
```
