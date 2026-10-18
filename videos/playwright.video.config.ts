import { defineConfig } from '@playwright/test'

/**
 * Films the how-to-play demos (videos/demos/*.demo.ts) against a dev stack on
 * VIDEO_SERVER_PORT / VIDEO_WEB_PORT. One demo at a time, generous timeouts:
 * a demo plays a whole game at human speed.
 *
 *   VIDEO_SERVER_PORT=8911 VIDEO_WEB_PORT=5911 npx playwright test -c videos/playwright.video.config.ts bomb-squad
 */
const SERVER_PORT = Number(process.env.VIDEO_SERVER_PORT ?? 8910)
const WEB_PORT = Number(process.env.VIDEO_WEB_PORT ?? 5910)
process.env.WEB_PORT = String(WEB_PORT)

export default defineConfig({
  testDir: './demos',
  testMatch: /.*\.demo\.ts$/,
  timeout: 30 * 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: `../test-results/video-${WEB_PORT}`,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    browserName: 'chromium',
    trace: 'off',
    // A missing element fails fast instead of holding the record lock.
    actionTimeout: 20_000,
  },
  webServer: [
    {
      command: 'npx tsx src/server/index.ts',
      cwd: '..',
      env: { SERVER_PORT: String(SERVER_PORT), PORT: String(SERVER_PORT), NODE_ENV: 'development' },
      url: `http://localhost:${SERVER_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npx vite',
      cwd: '..',
      env: { SERVER_PORT: String(SERVER_PORT), WEB_PORT: String(WEB_PORT) },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
