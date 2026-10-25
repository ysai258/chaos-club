import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { games as registry } from '../games/registry.ts'
import { testGame } from './test-game.ts'
import { createChaosServer } from './app.ts'
import { consoleLogger as log } from './log.ts'
import { statsFromEnv } from './stats.ts'

// The platform's own test game joins the lineup only for test runs.
const games = process.env.CHAOS_TEST_GAME === '1' && process.env.NODE_ENV !== 'production' ? { ...registry, [testGame.id]: testGame } : registry

const port = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 8787)

// Bundled to dist/server.mjs, the web build sits next to it in dist/web.
const here = dirname(fileURLToPath(import.meta.url))
const candidates = [process.env.STATIC_DIR, join(here, 'web'), join(here, '../../dist/web')]
const staticDir =
  process.env.NODE_ENV === 'production' || process.env.STATIC_DIR
    ? (candidates.find((d): d is string => !!d && existsSync(join(d, 'index.html'))) ?? null)
    : null

process.on('uncaughtException', (e) => log.error('uncaught exception', { error: e.stack ?? e.message }))
process.on('unhandledRejection', (e) => log.error('unhandled rejection', { error: String(e) }))

const stats = statsFromEnv()
const app = await createChaosServer({ games, log, port, staticDir, stats })
log.info('chaos club is up', { port: app.port, static: staticDir ?? '(dev: vite serves the UI)', games: Object.keys(games), stats: stats.backend.kind })

const shutdown = (signal: string) => {
  log.info('shutting down', { signal })
  void app.close().then(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
