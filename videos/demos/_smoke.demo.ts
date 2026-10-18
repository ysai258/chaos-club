import { test } from '@playwright/test'
import { setUpLobby, start, startFilm } from '../kit.ts'

const N = {
  a: 'This is a smoke test of the filming kit. Six friends join the room.',
  b: 'The host picks a game and splits everyone into two teams.',
  c: 'And the game begins.',
}

test('smoke', async ({ browser }) => {
  const teams = [['Asha', 'Chen', 'Esha'], ['Ben', 'Dev', 'Farhan']]
  const film = await startFilm(browser, { game: 'sketch-relay', names: ['Asha', 'Ben', 'Chen', 'Dev', 'Esha', 'Farhan'], teams, lines: Object.values(N) })
  film.caption('Getting started')
  await film.say(N.a)
  film.focus('Asha')
  await film.sayWhile(N.b, () => setUpLobby(film, { game: 'sketch-relay', teams }))
  film.spotlight('Asha')
  film.bubble('Asha', 'Okay team, nobody talk!')
  await film.pause(2500)
  film.spotlight(null)
  film.bubble('Ben', 'Let us gooo!')
  await film.cut(() => film.pause(3000), 'skipping ahead')
  film.caption('Round 1')
  film.focus(null)
  await start(film)
  await film.say(N.c)
  await film.pause(1500)
  await film.finish()
})
