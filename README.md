# 🎉 Chaos Club

> **You're invited.**
> **What:** team party games, played on your phones
> **Where:** the Google Meet call you're already on
> **Dress code:** competitive
> **RSVP:** open the link. That's it. No apps, no sign-ups.

Everyone hears everyone on the call, so the app keeps the secrets, the
timers, the buttons and the score. You bring the shouting.

## How a night goes

1. Someone opens Chaos Club and taps **Create a room**. They're the host 👑.
2. They hit **Invite** and drop the link (or the 5-letter code) in the Meet chat.
3. Everyone picks a name and an emoji face and lands in the lobby.
4. The host shuffles teams (or lets people pick a side), picks a game, taps **Start**.
5. Phones buzz, timers tick, friendships are tested. Podium, confetti, **Play again**.

Phone dropped off the Wi-Fi? Reopen the link: you get your seat back. Gone for
more than 30 seconds mid-game? The game carries on without you, and you're back
in for the next one.

## The lineup

| | Game | The pitch | Players | Teams | Time |
| --- | --- | --- | --- | --- | --- |
| 💣 | **Bomb Squad** | One phone has the bomb. Everyone else has a scrap of the manual. Talk fast. | 2–16 | 2–4 | ~20 min |
| 👂 | **Overheard** | Say your secret code out loud. The other team is listening. | 4–16 | 2 | ~25 min |
| ⚖️ | **Friend Court** | Your friends are on trial. The evidence is ridiculous. Argue anyway. | 3–16 | 2–4 | ~15 min |
| 🦈 | **Pitch Wars** | Sell a terrible startup to your friends. Live. For crores. | 2–16 | 2–4 | ~15 min |
| 🐀 | **The Mole** | Crack the challenges. Catch the traitor on your own team. | 6–16 | 2–4 | ~15 min |
| ✏️ | **Silent Sketch Relay** | One stroke each. No talking. Your teammate just ruined the elephant. | 2–16 | 2–4 | ~12 min |

Games marked for it get a **private team chat** (💬), because on a shared
call the other team hears every whisper.

## Run it

Node 22+.

```bash
npm install
npm run dev          # server on :8787, web on :5199 → open http://localhost:5199
```

Other ports (handy when several stacks run at once):

```bash
SERVER_PORT=8801 WEB_PORT=5301 npm run dev
```

Play on your phone on the same Wi-Fi: Vite listens on all interfaces, so open
`http://<your-laptop-ip>:5199`.

| Command | What it does |
| --- | --- |
| `npm run dev` | tsx-watched server + Vite with HMR (proxies `/api` and `/ws`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | vitest: platform server + every game's rules |
| `npm run test:e2e` | Playwright on a phone (Pixel 7) and desktop Chrome; starts its own dev stack on `SERVER_PORT`/`WEB_PORT` |
| `npm run build` | web → `dist/web`, server → `dist/server.mjs` |
| `npm start` | production server: API + WebSocket + the built app on one port (`PORT`, default 8787) |

## How it's built

- **One Node process**, plain `node:http` + `ws`, rooms **in memory**. No
  database: a room lives while people use it (closed after 10 minutes empty
  or 2 hours idle). A restart ends games in progress.
- **The server owns all truth.** Each phone gets its own snapshot, so secrets
  the viewer may not see are absent from the bytes, not hidden by CSS.
- **Games are plug-ins.** A game is a pure reducer (`src/games/<id>/`) plus a
  React screen (`src/web/games/<id>/`). The contract lives in
  `src/games/types.ts` and `src/web/games/types.ts`; the platform handles
  rooms, teams, timers, reconnects, chat and the results screen.
- **Web:** React 19, Vite, Tailwind 4, wouter. Neo-brutalist sticker UI kit in
  `src/web/ui/`, documented in [docs/platform-for-games.md](docs/platform-for-games.md).

```
src/
  shared/      wire protocol (frozen) + start rules shared by server & lobby
  server/      http + ws, rooms, teams, timers, rate limits, test game
  games/       one folder per game: rules, content, tests
  web/         app shell, pages, UI kit, one folder per game screen
tests/
  helpers/     e2e helpers (createRoom, setTeams, pickGame, startGame, …)
  platform/    platform e2e
  games/       per-game e2e
```

## Deploy (Render, free)

The repo carries a Blueprint: [`render.yaml`](render.yaml).

1. Push to GitHub.
2. Render → **New** → **Blueprint** → pick the repo → **Apply**.
3. Wait for the first build (`npm ci --include=dev && npm run build`), then open the URL.

That's one free web service in Singapore running `npm start`, with `/health`
as the health check. The app, API and WebSocket share one origin, so there's
no CORS or proxy to set up.

Free-tier things to know:

- The service **sleeps after ~15 minutes without traffic** and takes 30–60 s to
  wake. Open the site a minute before the party.
- Rooms are in memory, so a **redeploy or restart ends games in progress**.
  Don't deploy during game night.

## Fair play

Server-side validation on every message, per-socket rate limits, a 16 KB
message cap, and a host who can kick. Be nice anyway.
