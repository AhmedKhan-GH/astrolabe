import { join } from 'node:path'
import { tmpdir } from 'node:os'
// Default import, not named: outside Electron (tsx/node scripts, vitest) the
// 'electron' package's export is a path string — a named `app` import is a hard
// ESM error under strict node, while a guarded default import degrades cleanly.
import electron from 'electron'
import pino from 'pino'

const app = (electron as unknown as { app?: { getPath(name: string): string; isPackaged: boolean } })
  ?.app

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
const inElectron = app != null && typeof app.getPath === 'function'
const level = process.env['ASTROLABE_LOG_LEVEL'] ?? 'info'
const logFile = inElectron
  ? join(app!.getPath('userData'), 'logs', 'main.log')
  : join(tmpdir(), 'astrolabe-logs', 'main.log')

function createLogger(): pino.Logger {
  if (!inElectron || !app!.isPackaged) {
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
