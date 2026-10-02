import { defineConfig, devices } from '@playwright/test'

/**
 * E2E against the real dev stack (tsx server + Vite), no build needed.
 *
 * Ports come from SERVER_PORT / WEB_PORT so several agents can run suites at
 * the same time without stepping on each other:
 *
 *   SERVER_PORT=8790 WEB_PORT=5290 npx playwright test tests/platform
 *
 * Set E2E_BASE_URL to test an already-running server instead (e.g. `npm start`
 * on :8787); then no webServer is started.
 */
const SERVER_PORT = Number(process.env.SERVER_PORT ?? 8787)
const WEB_PORT = Number(process.env.WEB_PORT ?? 5199)
const external = process.env.E2E_BASE_URL
const customPorts = !!process.env.SERVER_PORT || !!process.env.WEB_PORT

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  // Per-port output dir: parallel runs by other agents won't wipe our traces.
  outputDir: `test-results/${WEB_PORT}`,
  use: {
    baseURL: external ?? `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Phones first: that's how the game is played.
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    // WebKit isn't installed on the dev machine; add an iPhone project here
    // once `npx playwright install webkit` has been run.
  ],
  webServer: external
    ? undefined
    : [
        {
          command: 'npx tsx src/server/index.ts',
          env: { SERVER_PORT: String(SERVER_PORT), PORT: String(SERVER_PORT), NODE_ENV: 'development', CHAOS_TEST_GAME: '1' },
          url: `http://localhost:${SERVER_PORT}/health`,
          reuseExistingServer: !customPorts,
          timeout: 60_000,
          stdout: 'ignore',
          stderr: 'pipe',
        },
        {
          command: 'npx vite',
          env: { SERVER_PORT: String(SERVER_PORT), WEB_PORT: String(WEB_PORT) },
          url: `http://localhost:${WEB_PORT}`,
          reuseExistingServer: !customPorts,
          timeout: 60_000,
          stdout: 'ignore',
          stderr: 'ignore' // vite logs every socket a closing test context drops,
        },
      ],
})
