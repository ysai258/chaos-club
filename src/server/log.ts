export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): void
  warn(msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
}

function line(level: string, msg: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra })
}

export const consoleLogger: Logger = {
  info: (m, e) => console.log(line('info', m, e)),
  warn: (m, e) => console.warn(line('warn', m, e)),
  error: (m, e) => console.error(line('error', m, e)),
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} }
