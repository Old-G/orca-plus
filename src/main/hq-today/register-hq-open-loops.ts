// Custom build (hq-open-loops): the open-loop detector wired to Orca+ — the ledger's
// timelines, the waitings and people pulse keeps, the HQ+ journal and the owner's setting.
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { HQ_JOURNAL_KIND } from '../../shared/hq-journal'
import { hqLedgerMode } from '../../shared/hq-ledger-mode'
import { hqOpenLoopsMode } from '../../shared/hq-open-loops-mode'
import { HQ_JOB_SOURCE_PREFIX } from '../hq-journal/hq-journal-jobs'
import { hqLedgerErrorReporter } from './hq-ledger-errors'
import { HQ_OPEN_LOOPS_JOB, runHqOpenLoops } from './hq-open-loops'

const PASS_MS = 5 * 60_000
/** Why later than the readers' first pass: the ledger catches up on Slack first. */
const FIRST_PASS_MS = 3 * 60_000

export function startHqOpenLoops(store: Store, runtime: OrcaRuntimeService): () => void {
  const loops = () => runtime.pulseAttribution().openLoops
  const failed = hqLedgerErrorReporter('hq-open-loops', 'Open loops not checked', (rows) =>
    runtime.pulseRecordJournal(rows)
  )
  const tick = (): void => {
    try {
      runHqOpenLoops({
        enabled: () =>
          hqOpenLoopsMode(store.getSettings()) !== 'off' &&
          hqLedgerMode(store.getSettings()) !== 'off',
        timelines: (since) => loops().timelines(since),
        owner: () => loops().owner(),
        records: (since) => loops().records(since),
        record: (kind, loopId, payload) => loops().record(kind, loopId, payload),
        waitings: () => runtime.pulseListWaitings(),
        people: () => runtime.pulseListPeople(),
        lastLineAt: () =>
          runtime.pulseListJournal({
            kind: HQ_JOURNAL_KIND.jobReport,
            source: `${HQ_JOB_SOURCE_PREFIX}${HQ_OPEN_LOOPS_JOB}`,
            limit: 1
          })[0]?.at ?? null,
        journal: (rows) => void runtime.pulseRecordJournal(rows),
        now: Date.now
      })
    } catch (error) {
      failed(error)
    }
  }
  const first = setTimeout(tick, FIRST_PASS_MS)
  const timer = setInterval(tick, PASS_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
