# How-to-play videos

One portrait video (1080×1920) per game: six phones in a 3×2 grid playing a
real game, a narrator explaining the rules, speech bubbles for what players say
out loud on the Meet call, a highlight ring on whoever is acting, and a
spotlight that enlarges one phone when its screen matters.

```bash
# 1. Film (plays the game at human speed in six recorded phones)
videos/record.sh bomb-squad 8911 5911   # at most 3 films at once (VIDEO_SLOTS)
# 2. Assemble (add --preview for a fast half-size render)
npm run video:compose -- bomb-squad
# -> videos/out/bomb-squad.mp4
```

Needs ffmpeg, and `uvx` for the narration voice (edge-tts, `en-IN-NeerjaExpressiveNeural`,
override with `VIDEO_VOICE`). Narration is cached in `videos/.cache/tts`.

## Writing a demo — `videos/demos/<game>.demo.ts`

```ts
import { test, expect } from '@playwright/test'
import { setUpLobby, start, startFilm, tap } from '../kit.ts'

const N = { intro: '...', roles: '...' }      // every narration line

test('bomb-squad', async ({ browser }) => {
  const teams = [['Asha', 'Chen', 'Esha'], ['Ben', 'Dev', 'Farhan']]
  const film = await startFilm(browser, { game: 'bomb-squad', names: ['Asha', 'Ben', 'Chen', 'Dev', 'Esha', 'Farhan'], teams, lines: Object.values(N) })
  film.caption('Setting up')
  await film.sayWhile(N.intro, () => setUpLobby(film, { game: 'bomb-squad', teams, settings: { rounds: 1 } }))
  await start(film)
  film.spotlight('Asha'); film.focus('Asha')
  await film.say(N.roles)
  await film.shout('Chen', 'Cut the second wire!')
  await film.cut(async () => { /* boring stretch, dropped from the video */ }, 'two bombs later')
  await film.finish()
})
```

| Call | Effect in the video |
| --- | --- |
| `say(text)` | Voiceover + subtitle; waits until spoken. Keep lines ≤ ~140 characters. |
| `sayWhile(text, fn)` | Narrate while the phones act. |
| `caption(text)` | Chapter heading at the top ("Round 1 · The bomb"). |
| `bubble(name, text, ms)` / `shout(...)` | Speech bubble over that phone = what they say on the call. `shout` waits for it. |
| `focus(names \| null)` | Yellow ring on those phones. |
| `spotlight(name \| null)` | That phone enlarged over the grid. Use for anything the viewer must read. |
| `cut(fn, label)` | Footage during `fn` is dropped; a ">> LABEL" card marks the jump. Never narrate inside a cut. |
| `pause(ms)` | Hold the shot. |

Text in captions/bubbles/narration is drawn with the brand fonts; emoji are stripped there (they still show on the phones).
