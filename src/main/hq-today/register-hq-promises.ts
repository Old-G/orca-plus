// Custom build (hq-ledger-promises, plan 20.9): where the owner's promises come from. With the ledger on
// it finds them in his own lines itself; until then the scout's promises.json is read as before. One
// switch, so the two never both record the same promise.
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { hqLedgerErrorReporter } from './hq-ledger-errors'
import { startHqLedgerPromises } from './hq-ledger-promises'
import { hqPromisePerson, startHqScoutPromises } from './hq-scout-promises'
import { generateHqText } from './hq-task-questions'
import { hqLedgerMode } from '../../shared/hq-ledger-mode'

// Why sonnet: telling «гляну» that commits from «гляну» that brushes off needs more than routing.
const MODEL = 'sonnet'

export function startHqPromises(store: Store, runtime: OrcaRuntimeService): void {
  const ledgerOn = (): boolean => hqLedgerMode(store.getSettings()) === 'on'
  const people = {
    listPeople: () => runtime.pulseListPeople(),
    upsertPerson: (input: { name: string }) => runtime.pulseUpsertPerson(input)
  }
  startHqScoutPromises({
    hqPath: () => (ledgerOn() ? null : (store.getSettings().hqPath ?? null)),
    listWaitings: () => runtime.pulseListWaitings(),
    ...people,
    addWaiting: (input) => runtime.pulseAddWaiting(input),
    closeWaiting: (id, resolution) => void runtime.pulseCloseWaiting(id, 'resolved', resolution)
  })
  const promises = () => runtime.pulseAttribution().promises
  startHqLedgerPromises(
    {
      enabled: () => ledgerOn() && !!store.getSettings().hqPath,
      ownLines: (afterRow, since, limit) => promises().ownLines(afterRow, since, limit),
      lookedUpTo: () => promises().lookedUpTo(),
      looked: (upTo) => promises().looked(upTo),
      looksSince: (since) => promises().looksSince(since),
      listWaitings: () => runtime.pulseListWaitings(),
      personFor: (name, slackUserId) => hqPromisePerson(name, slackUserId, people),
      addWaiting: (input) => void runtime.pulseAddWaiting(input),
      generate: (prompt) => {
        const hqPath = store.getSettings().hqPath
        return hqPath
          ? generateHqText(
              prompt,
              { emptyResultName: 'ledger promises', operation: 'hq-ledger-promises', model: MODEL },
              {
                settings: store.getSettings(),
                cwd: hqPath,
                getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
              }
            )
          : Promise.resolve({ ok: false as const, error: 'No HQ folder is set.' })
      },
      now: Date.now
    },
    hqLedgerErrorReporter('hq-ledger-promises', 'Promises not read from the ledger', (rows) =>
      runtime.pulseRecordJournal(rows)
    )
  )
}
