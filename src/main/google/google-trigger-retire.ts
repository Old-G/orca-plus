// Custom build (google-disconnect-forget): a disconnect retires the Google trigger checker rather than
// editing its memory (upstream keeps the checker at its size limit). The retired checker's schedules,
// Calendar timers and backoff go with it, and a check still waiting on Google when the account went
// can neither start a bot nor write its old state back. The next tick runs a fresh checker, which reads
// the scrubbed state and rebuilds the other accounts' schedules; the run path drops repeat events.
import { GoogleTriggerChecker, type GoogleTriggerCheckerDeps } from './google-trigger-checker'

export type RetirableGoogleTriggerChecker = {
  tick(): Promise<void>
  /** Throws away the current checker and what it is doing; the next tick starts a clean one. */
  retire(): void
  stop(): void
}

export function retirableGoogleTriggerChecker(
  deps: GoogleTriggerCheckerDeps
): RetirableGoogleTriggerChecker {
  const start = () => {
    let retired = false
    const checker = new GoogleTriggerChecker({
      ...deps,
      runForEvent: (automationId, event) =>
        retired ? Promise.resolve(undefined) : deps.runForEvent(automationId, event),
      writeState: (state) => {
        if (!retired) {
          deps.writeState(state)
        }
      }
    })
    return {
      checker,
      retire: () => {
        retired = true
        checker.stop()
      }
    }
  }
  let current = start()
  let stopped = false
  return {
    tick: () => current.checker.tick(),
    retire: () => {
      current.retire()
      if (!stopped) {
        current = start()
      }
    },
    stop: () => {
      stopped = true
      current.retire()
    }
  }
}
