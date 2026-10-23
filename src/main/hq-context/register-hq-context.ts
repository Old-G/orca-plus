// Custom build (hq-plus-context): starts the project cards and room context for `orca hq context`,
// the SessionStart hook, `orca hq step`, `orca hq where` and `orca hq workspace add`.
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { HqJournalService } from '../hq-journal/hq-journal-service'
import { createHqContextService, provideHqContext } from './hq-context'

export function registerHqContext(
  store: Store,
  runtime: OrcaRuntimeService,
  journal: HqJournalService
): void {
  provideHqContext(
    createHqContextService({
      enabled: () => store.getSettings().hqPlusJournalEnabled !== false,
      hqPath: () => store.getSettings().hqPath ?? null,
      sources: () => journal.sources(),
      pulse: {
        listWaitings: () => runtime.pulseListWaitings({}),
        listDecisions: (limit) => runtime.pulseListDecisions(limit),
        listSessionsByProject: (project) => runtime.pulseListSessionsByProject(project),
        list: (query) => runtime.pulseListJournal(query),
        record: (inputs) => runtime.pulseRecordJournal(inputs),
        listPeople: () => runtime.pulseListPeople()
      },
      now: Date.now
    })
  )
}
