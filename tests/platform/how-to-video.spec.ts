import { test, expect, type Page } from '@playwright/test'
import { createRoom, pickGame, tap } from '../helpers/e2e.ts'

/**
 * "Watch how to play" opens a narrated video of the game.
 *
 * Laptops (most players) get the 1080p cut from the GitHub release beside the
 * written rules; phones get the lighter local 720p copy, full screen.
 * Playwright's bundled Chromium has no H.264, so actual playback is only
 * asserted where the browser can decode it.
 */

async function canPlayH264(page: Page): Promise<boolean> {
  return page.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.64001f, mp4a.40.2"') !== '')
}

test('lobby and in-game menu both offer the how-to-play video', async ({ browser }, info) => {
  const wide = info.project.name.startsWith('desktop')
  const room = await createRoom(browser, { players: 2, viewport: wide ? { width: 1440, height: 900 } : undefined })
  const host = room.host
  await pickGame(host, 'bomb-squad')

  // Lobby: the How to play card has the button, for guests too.
  for (const page of room.pages) await expect(page.getByTestId('how-to-video')).toBeVisible()
  await tap(host.getByTestId('how-to-video'))
  const modal = host.getByTestId('how-to-video-modal')
  await expect(modal).toBeVisible()
  const player = host.getByTestId('how-to-video-player')
  const src = await player.getAttribute('src')
  if (wide) {
    expect(src).toContain('/releases/download/how-to-play-v1/bomb-squad.mp4')
    // Rules sit beside the video on a laptop.
    await expect(modal.getByText(/Download the video/)).toBeVisible()
  } else {
    expect(src).toBe('/videos/bomb-squad.mp4')
  }
  await expect(player).toHaveAttribute('poster', '/videos/bomb-squad.jpg')

  if (await canPlayH264(host)) {
    await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 }).toBeGreaterThan(0.5)
  }

  // Escape closes the video only.
  await host.keyboard.press('Escape')
  await expect(modal).toBeHidden()

  // In game: the ⋯ menu has it as well.
  await host.getByTestId('start-game').click()
  await expect(host.getByTestId('game-view')).toBeVisible()
  await host.getByRole('button', { name: 'Room menu' }).click()
  await tap(host.getByRole('dialog').getByTestId('how-to-video'))
  await expect(host.getByTestId('how-to-video-modal')).toBeVisible()
  await host.locator('[data-testid="how-to-video-close"]:visible').click()
  await expect(host.getByTestId('how-to-video-modal')).toBeHidden()
  // The menu underneath is still open.
  await expect(host.getByRole('dialog')).toBeVisible()

  await room.close()
})

test('the local video and poster are served with byte ranges', async ({ request }) => {
  const head = await request.get('/videos/bomb-squad.mp4', { headers: { range: 'bytes=0-1023' } })
  expect([200, 206]).toContain(head.status())
  expect(head.headers()['content-type']).toContain('video/mp4')
  expect((await head.body()).length).toBeLessThanOrEqual(1024)
  expect((await request.get('/videos/bomb-squad.jpg')).headers()['content-type']).toContain('image/jpeg')
})
