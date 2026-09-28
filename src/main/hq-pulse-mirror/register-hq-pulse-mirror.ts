// Custom build (hq-pulse-mirror): follows pulse writes into HQ's decisions/ and people/.
import { existsSync } from 'node:fs'
import { app } from 'electron'
import type { Store } from '../persistence'
import { runProcess } from '../../shared/child-process/run-process'
import { onPulseChanged } from '../orca-plus/pulse/pulse-change-events'
import { PulseDb, pulseDbPath } from '../orca-plus/pulse/pulse-db'
import { createHqPulseMirror } from './hq-pulse-mirror'

const GIT_TIMEOUT_MS = 60_000

export function registerHqPulseMirror(store: Store): void {
  const path = pulseDbPath(app.getPath('userData'))
  let db: PulseDb | null = null
  const mirror = createHqPulseMirror({
    hqPath: () => store.getSettings().hqPath ?? null,
    // Why: the mirror follows the database; it never creates one for a user who has none.
    openDb: () => {
      if (!db && existsSync(path)) {
        db = new PulseDb(path)
      }
      return db
    },
    git: async (args, cwd) => {
      const result = await runProcess({ program: 'git', args, cwd, timeoutMs: GIT_TIMEOUT_MS })
      return { code: result.code, stdout: result.stdout, stderr: result.stderr }
    },
    log: (message) => console.log('[hq-pulse-mirror]', message)
  })
  onPulseChanged(() => mirror.schedule())
  // Why: catch up on writes that landed while HQ was unset or the app was closed mid-run.
  mirror.schedule()
}
