import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { app } from 'electron'
import pino from 'pino'

/**
 * One Pino instance for the main process (INFRASTRUCTURE-SPEC Pillar 2; conventions
 * carried from the alidate iteration: child loggers per module, error objects with
 * context — never string interpolation).
 *
 * Dev: pretty stdout + JSON file, via worker-thread transports (fine unpackaged).
 * Packaged: in-process multistream (JSON stdout + file) — pino's transport workers
 * cannot resolve their targets from inside an asar, so the packaged path must not
 * use them.
 */
// Outside Electron (vitest node-mode, the step-7 MCP server) `app` is undefined —
// fall back to a tmp log dir and unpackaged behavior.
const inElectron = typeof app?.getPath === 'function'
const level = process.env['ASTROLABE_LOG_LEVEL'] ?? 'info'
const logFile = inElectron
  ? join(app.getPath('userData'), 'logs', 'main.log')
  : join(tmpdir(), 'astrolabe-logs', 'main.log')

function createLogger(): pino.Logger {
  if (!inElectron || !app.isPackaged) {
    return pino({
      level,
      transport: {
        targets: [
          { target: 'pino-pretty', options: { colorize: true } },
          { target: 'pino/file', options: { destination: logFile, mkdir: true } },
        ],
      },
    })
  }
  return pino(
    { level },
    pino.multistream([
      { stream: process.stdout, level },
      { stream: pino.destination({ dest: logFile, mkdir: true }), level },
    ]),
  )
}

export const logger = createLogger()

/** Per-module child logger: `const log = moduleLogger('connector.zotero')`. */
export function moduleLogger(mod: string): pino.Logger {
  return logger.child({ mod })
}
