# Chaos Club — build spec

Team party games for a group of friends who are **already on a Google Meet
call together**. Everyone opens the site on their phone (or laptop), joins a
room with a 5-letter code, gets split into teams, and plays. Voice happens on
Meet; the app holds the secrets, the timers, the buttons and the score.

> Key design fact: everyone hears everyone on the Meet. Any team discussion is
> overheard by the rival team. Games either take turns, make overhearing a
> mechanic, or use the platform's **private team chat** (text, team-only).

## Stack (fixed — dependencies are already installed; do NOT run npm install)

- Node 22, TypeScript strict, ESM. `npm run typecheck`, `npm test` (vitest), `npm run test:e2e` (playwright).
- Server: plain `node:http` + `ws`, single process, **in-memory** rooms (no database). Entry `src/server/index.ts`.
  Serves the built web app from `dist/web` in production on the same origin; WebSocket at `/ws`.
- Web: React 19 + Vite 8 + Tailwind 4 (`@tailwindcss/vite`) + wouter for routing. Root `src/web/`.
  Routes: `/` landing, `/r/:code` room (join form if no name yet).
- `canvas-confetti` is available for celebrations. No other runtime deps. If you truly need one, say so in your final report instead of installing.
- Deploy target: Render free tier, Node runtime, `npm ci && npm run build`, `npm start`. `PORT` env.

## Layout and ownership (agents work in parallel in ONE tree — stay in your lane)

| Path | Owner |
| --- | --- |
| `src/shared/protocol.ts`, `src/games/types.ts`, `src/web/games/types.ts` | **Frozen contract.** Nobody edits without the orchestrator. If you need a change, report it. |
| `src/server/**`, `src/web/**` except `src/web/games/<id>/`, `vite.config.ts`, `playwright.config.ts`, `tests/platform/**`, `README.md`, `render.yaml` | Platform agent |
| `src/games/<id>/**`, `src/web/games/<id>/**`, `tests/games/<id>/**` | That game's agent |
| `src/games/registry.ts`, `src/web/games/registry.ts` | Already wired for all six games. Don't touch. |

Game ids: `bomb-squad`, `overheard`, `friend-court`, `pitch-wars`, `the-mole`, `sketch-relay`.

## Platform responsibilities

- Rooms: create (`POST /api/rooms` → `{code}`), join by link `/r/ABCDE`. 5-letter codes without ambiguous letters.
- Identity: name + emoji avatar, session token in localStorage, reconnect restores seat. 30s grace on disconnect, then `onPlayerGone`.
- Host: first joiner; host succession to next connected player. Host picks game, settings, team count, shuffles/moves players, renames teams, starts, play again, back to lobby, kick.
- Teams: auto-balanced; silly generated names ("The Spicy Pickles", "Chai Gang"...), colors from the palette. Late joiners during a game: join the smallest team as a spectator-ish player — the game sees them only from the next game (pass only players present at `create`... games must tolerate unknown player ids by ignoring them).
- Timers: after every state change, read `deadline(state)`; a single setTimeout per room calls `tick` when due (loop while deadline <= now).
- Per-viewer broadcast of `RoomSnapshot` after every change. Events routed by `GameEvent.to`.
- Private team chat (when `meta.teamChat`), max 200 chars, rate limited, last 50 messages per team.
- Results screen: ranking (from `scores`), highlights, awards, confetti for winners, Play Again.
- Rate limiting per socket, payload size limit 16KB, validation of every client message (zod).

## Design — quirky, loud, phone-first

- Neo-brutalist sticker style: thick black outlines (3px), hard offset shadows, chunky rounded buttons that squish on press, slightly rotated cards, bold saturated palette (`tomato`, `sky`, `lime`, `grape`, `sun`, `bubblegum` + `ink` + `paper` cream background), playful display font (Google Fonts, e.g. "Bricolage Grotesque" / "Rubik Mono One") + readable body font.
- Dark mode is NOT required; one strong light theme.
- Phone first: designed at 360×740. Every tap target ≥ 44px. No horizontal scroll. Respect safe-area insets. Works in portrait. Desktop: centered column, max ~520px for game screens (a game may go wider, e.g. a drawing canvas).
- Micro-interactions: wiggle, pop, shake on error, haptics via `navigator.vibrate` where supported, optional small WebAudio blips (muted toggle).
- UI kit in `src/web/ui/` (platform-owned): `Button`, `Card`, `Input`, `Badge`, `Avatar`, `TeamPill`, `Countdown` (uses deadline), `Toast`, `Sheet`, `BigText`, etc. Game screens must use it so the site looks like one product. Until the kit lands, build with plain Tailwind and swap in kit components when `PLATFORM_READY` exists in the repo root.

## Quality bar for every game

- Original, genuinely fun design. Research the genre (WebSearch/WebFetch), think through every case: 2 teams of 1, 2 teams of 8, odd numbers, a player disconnecting mid-turn, the active player leaving, host leaving, double taps, stale actions from the previous round (include a round/turn id in actions and reject mismatches), timers expiring at the same moment as an action.
- Lots of original content (50+ items where content applies), fun for an Indian friend group in their 20s (light desi flavour welcome, nothing offensive, everything in English).
- Unit tests (vitest) in `src/games/<id>/*.test.ts`: full game playthrough, hidden-information test (assert that secrets are absent from other viewers' `view` JSON), edge cases above.
- E2E (playwright) in `tests/games/<id>/*.spec.ts` once the platform is ready: several browser contexts (mobile viewport 390×844) play a full game.
- `npm run typecheck` clean.
