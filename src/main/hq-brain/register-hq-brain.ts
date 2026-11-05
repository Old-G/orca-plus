// Custom build (hq-plus-brain): starts the host side of HQ+'s «Brain» screen (`hq.brain`).
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { createHqBrain, provideHqBrain, runHqBrainPython } from './hq-brain'

export function registerHqBrain(store: Store, runtime: OrcaRuntimeService): void {
  provideHqBrain(
    createHqBrain({
      hqPath: () => store.getSettings().hqPath ?? null,
      run: runHqBrainPython,
      pulse: {
        waitings: () => runtime.pulseListWaitings({}),
        decisions: (limit) => runtime.pulseListDecisions(limit),
        people: () => runtime.pulseListPeople()
      },
      sessionWorkspace: (sessionId) => {
        try {
          const location = runtime.openedAgentSessionRecordStore()?.getRecord(sessionId)?.location
          if (!location) {
            return null
          }
          // Why: a folder workspace is addressed as `folder:<id>` in the renderer, as the journal does.
          return location.workspaceKind === 'folder' && !location.workspaceId.startsWith('folder:')
            ? `folder:${location.workspaceId}`
            : location.workspaceId
        } catch {
          return null
        }
      },
      now: Date.now
    })
  )
}
