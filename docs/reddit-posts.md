# Reddit posts for Chaos Club

Drafts for sharing Chaos Club, ranked best fit first. Rules were read live on
2026-10-25 (Sunday) from each sub's `about/rules.json` and post-flair list.

**Live URL:** https://chaos-club-eg0v.onrender.com (free Render plan: it sleeps
after ~15 minutes idle and takes 30–60 s to wake. Open it a minute before you
post, and again now and then while comments come in.)

**Posting account:** u/Original-Fall6524 (17 post karma, 1 comment karma, made
2025-07). None of the subs below publishes a karma minimum, but automoderator
thresholds are hidden, so a post can still be filtered. If one vanishes
instantly, send a short polite modmail rather than reposting.

**Spread them out.** Post one a day at most, and reply to every comment on
the first post before making the next. Several of these subs remove posts from
devs who post and disappear, and posting the same thing to many subs in one
day looks like spam to both mods and Reddit's filters.

**Be upfront about AI.** The game was built with AI coding agents (see
`SPEC.md`), and the how-to-play videos use an AI text-to-speech narrator
(edge-tts, see `videos/README.md`). r/playmygame removes false claims, and
r/IndieGaming requires a GenAI disclosure. Each draft below has a one-line
disclosure; edit it to describe exactly what you did, but keep it.

**Videos:** narrated how-to-play videos are in `videos/out/` (git-ignored, so
upload from disk) and public on the GitHub release `how-to-play-v1`:

| File | Length | Size |
| --- | --- | --- |
| `videos/out/sketch-relay.mp4` | 3:05 | 16 MB |
| `videos/out/the-mole.mp4` | 3:42 | 23 MB |
| `videos/out/bomb-squad.mp4` | 4:33 | 24 MB |
| `videos/out/overheard.mp4` | 4:13 | 25 MB |
| `videos/out/friend-court.mp4` | 3:24 | 26 MB |
| `videos/out/pitch-wars.mp4` | 3:59 | 33 MB |

Silent Sketch Relay is the shortest and the easiest to follow without sound,
so it is the one to upload when a sub wants video.

**Checked and skipped:**

- r/WebGames, r/SideProject, r/microsaas, r/buildinpublic, r/indiehackers,
  r/IMadeThis, r/betatests: excluded by the brief (removed or posted recently).
- r/indiegames: "No generative AI posts", promotion must embed gameplay media,
  and "No promotion posts under guise of feedback" bans asking for feedback.
- r/DestroyMyGame: "No AI … Keep that Claude shit out of here too", and video
  posts only.
- r/playtesters: "No self promotion".
- r/BrowserGames and r/partygames: private (HTTP 403).

---

## 1. r/playmygame (about 149k members)

**Why it fits.** The sub exists "for indie developers to share their freely
playable games for feedback". Its rules want what Chaos Club already is:
"Your game must be playable for free … NOW", "Include a direct link to the
game", "Include a (brief) description of your game / your participation in
development", and "Be Truthful / No false claims". No karma minimum is listed.

**Limits.** "1 post per month please". No NSFW tag needed (no horror).
"Trailer Tuesday" is only for paid games, so ignore it.

**Post type:** text post (so the game link can come first, followed by the
description). **Flair:** `[Mobile] (Web)` (it is phone-first; `[PC] (Web)` also
fits).

**Title:**

> Chaos Club: six free team party games for friends on a video call, played on your phones in the browser

**Body:**

> **Play:** https://chaos-club-eg0v.onrender.com
>
> I made this to play with my friends. We hang out on Google Meet, and every
> party game we tried either needed everyone to install an app or fell apart
> because both teams can hear each other on the call. So I built one where the
> phones hold the secrets, the timers and the score, and the call is just for
> shouting.
>
> How it works: one person taps **Create a room** and shares the link or the
> 5-letter code. Everyone opens it on their phone (a laptop works too), picks a
> name and an emoji, and gets split into teams. The host picks a game and hits
> Start. No app, no sign-up.
>
> There are six games, for 2 to 16 players in 2 to 4 teams, 12 to 25 minutes each:
>
> - **Bomb Squad**: one phone has the bomb, everyone else has a scrap of the manual.
> - **Overheard**: say your secret code out loud while the other team listens.
> - **Friend Court**: your friends are on trial and the evidence is ridiculous.
> - **Pitch Wars**: sell a terrible startup to your friends, live.
> - **The Mole**: win the challenges and catch the traitor on your own team.
> - **Silent Sketch Relay**: one stroke each, no talking.
>
> Each game has a short narrated how-to-play video in the lobby. If your phone
> drops off the Wi-Fi, reopen the link and you get your seat back.
>
> My part: I built it, with AI coding tools writing a lot of the code. The
> video narration is text-to-speech. *(Edit to match exactly what you did.)*
>
> It's on a free server, so the first load can take up to a minute while it
> wakes up.
>
> If you have a group that plays games on calls, I'd love to know:
>
> 1. Which game did your group like most, and which one fell flat?
> 2. Was anything confusing in the first two minutes, before the first game started?

**First comment (optional):**

> Tip for a first game: Silent Sketch Relay needs almost no explaining and
> works with as few as 2 people. The Mole needs at least 6.

---

## 2. r/developersIndia (about 1.6M members), "I Made This" flair

**Why it fits.** An Indian developer audience, and the games have a light
desi flavour (pitches "for crores", team names like "Chai Gang"). The sub's
extended flair rules say: "Use this flair to share projects you have built"
and "Add GitHub URL or deployed project URL while posting". The repo is public
(github.com/ysai258/chaos-club), which this crowd will want to see.

**Limits.** "Always use the right flair". "I made this posts should be taken
as public launch of your project, avoid posting the same project multiple
times". "Don't create Low-Quality Posts", so include real technical detail.

**Post type:** text post. **Flair:** `I Made This`.

**Title:**

> I built a set of team party games my friends play on Google Meet: phones hold the secrets, the call is for shouting

**Body:**

> **Live:** https://chaos-club-eg0v.onrender.com
> **Code:** https://github.com/ysai258/chaos-club
>
> My friends and I hang out on Google Meet, and most party games break there:
> everyone hears everyone, so the other team hears every whisper, and nobody
> wants to install an app. I made Chaos Club to fix that for us.
>
> One person creates a room and drops the link in the Meet chat. Everyone opens
> it on their phone, picks a name, and gets put on a team. The host picks one of
> six games (2 to 16 players): Bomb Squad, Overheard, Friend Court, Pitch Wars,
> The Mole and Silent Sketch Relay. No sign-up.
>
> How it's built:
>
> - One Node process (`node:http` + `ws`) with rooms in memory and no database.
>   The app, API and WebSocket share one origin on Render's free plan.
> - The server owns all the game state and sends each phone its own snapshot,
>   so secrets the viewer shouldn't see are missing from the bytes, not hidden
>   with CSS.
> - Each game is a pure reducer plus a React screen. The platform handles
>   rooms, teams, timers, reconnects (30 s grace), private team chat and results.
> - React 19, Vite, Tailwind 4. Vitest for the rules and Playwright for
>   multi-phone end-to-end runs.
> - The how-to-play videos are recorded by Playwright driving six browsers and
>   narrated with text-to-speech.
>
> I used AI coding agents heavily to build it, and I'm happy to talk about how
> that went.
>
> It's on a free instance, so the first load can take a minute.
>
> Two questions if you try it with your group:
>
> 1. Which game worked for your group, and which didn't?
> 2. Did anything break on your phone or browser? Reconnecting after a dropped
>    network is the part I most want tested.

**First comment (optional):**

> Biggest lesson: on a shared call, "hidden information" is really about the
> wire. Each phone gets its own view from the server, and the tests check that
> one team's secret never shows up in another team's JSON.

---

## 3. r/IndianGaming (about 651k members)

**Why it fits.** "For discussions related to the Indian gaming scenario …
pretty much anything in and around videogames". It's a free game built for an
Indian friend group, and there's no rule against sharing your own game.

**Rules to follow.** "Headlines and Titles of Posts: 3.1. Posts should contain
more than 3 words. 3.2. Posts should not contain emojis in the title." "Quality
Control: … Low effort posts are removed", so write a proper body. "Mode of
Communication: Please use English".

**Post type:** video post (upload `videos/out/sketch-relay.mp4`, 16 MB, 3:05)
with the text below as the body, or as the first comment if the video
composer has no body field. A plain text post also works. **Flair:**
`Gameplay` for the video post, `Discussion` for a text post.

**Title (no emojis):**

> I made free party games for friend groups on Google Meet, played on your phones

**Body:**

> Link: https://chaos-club-eg0v.onrender.com
>
> Our group does game nights on Meet, and I got tired of party games that need
> an app install or a paid licence, or that break because the other team hears
> everything. So I made Chaos Club. One person creates a room and shares the
> link, everyone joins from their phone, and you get split into teams. No
> sign-up.
>
> Six games, 2 to 16 players:
>
> - Bomb Squad: one phone has the bomb, the rest of you have the manual.
> - Overheard: say your secret code out loud without the other team cracking it.
> - Friend Court: put your friends on trial over ridiculous evidence.
> - Pitch Wars: sell a terrible startup to your friends for crores.
> - The Mole: catch the traitor on your own team.
> - Silent Sketch Relay: draw together, one stroke each, no talking. (That's
>   the video.)
>
> It's free with no ads. I built it with the help of AI coding tools, and the
> narration in the video is text-to-speech. It runs on a free server, so give
> the first load up to a minute.
>
> If your gang tries it, which game was the most fun, and what would you add
> for a group of 8 to 10?

---

## 4. r/IndieGaming (optional, higher risk)

**Why it fits.** It accepts "Original content" from devs and "Discussion
oriented text posts", and the account meets "Your account must be at least 1
week old and have an actual posting history".

**Why it's last.** "Generative AI: If your game heavily utilizes or relies on
GenAI, please do not post it here. If GenAI was involved in any aspect of your
game's development or promotion, you MUST declare its usage". AI-written code
and TTS narration may count as heavy use, so mods could remove it. Skip this
one if you'd rather not test that. Also: "Users may only make 1 submission
every 2 weeks", and "Store pages with no/little context" are banned.

**Post type:** text post. **Flair:** the flair list wasn't readable
(HTTP 403), so pick whatever the composer offers for your own game, if it asks.

**Title:**

> I made a free set of browser party games for friends on video calls: phones hold the secrets, the call is for talking

**Body:**

> https://chaos-club-eg0v.onrender.com
>
> I made this to play with my friends on Google Meet. Party games on a shared
> call have one big problem: both teams hear everything. In Chaos Club each
> phone shows only what that player is allowed to see, keeps the timers and
> keeps the score. Some games use the overhearing on purpose: in Overheard you
> have to say your code out loud while the other team listens.
>
> Create a room, share the link, everyone joins in the browser on their phone,
> and you get split into teams. No app or account. Six games for 2 to 16
> players, each 12 to 25 minutes, each with a short how-to-play video.
>
> **GenAI disclosure:** AI coding tools wrote a large part of the code, and the
> how-to-play videos use a text-to-speech narrator. *(Edit this to say
> exactly what you did and what the AI did.)*
>
> I'm after feedback from groups who game on calls: does the first room take
> too long to set up, and which of the six would you cut?
