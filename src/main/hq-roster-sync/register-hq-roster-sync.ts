// Custom build (hq-roster-sync): wires the project add/remove event to HQ's registry scripts.
import { existsSync } from 'node:fs'
import { app } from 'electron'
import type { Store } from '../persistence'
import { runProcess } from '../../shared/child-process/run-process'
import { createHqRosterSync, type HqRosterSync } from './hq-roster-sync'
import { onRepoRosterChanged } from './repo-roster-events'

const SCRIPT_TIMEOUT_MS = 120_000

export function registerHqRosterSync(store: Store): HqRosterSync {
  const userDataPath = app.getPath('userData')
  // Why: hq_registry.py reads projects through the `orca-plus` CLI, which targets the installed
  // app's profile unless told otherwise — a dev build must feed its own project list.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ORCA_USER_DATA_PATH: userDataPath,
    ORCA_PLUS_USER_DATA_PATH: userDataPath
  }
  const sync = createHqRosterSync({
    hqPath: () => store.getSettings().hqPath ?? null,
    fileExists: existsSync,
    run: async (program, args, cwd) => {
      const result = await runProcess({ program, args, cwd, env, timeoutMs: SCRIPT_TIMEOUT_MS })
      return { code: result.code, stdout: result.stdout, stderr: result.stderr }
    },
    platform: process.platform,
    log: (message) => console.log('[hq-roster-sync]', message)
  })
  onRepoRosterChanged(() => sync.schedule())
  return sync
}
