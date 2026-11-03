// Custom build (hq-ledger-draft, plan 20.9 step 1): the ledger's card drafts wired to Orca+ — its
// conversations and the larger model. Runs in shadow too, so the day's line can hold
// its kinds against the scout's before the scout is switched off.
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { hqLedgerErrorReporter } from './hq-ledger-errors'
import { startHqLedgerDrafts } from './hq-ledger-drafts'
import { generateHqText } from './hq-task-questions'

// Why sonnet: telling a request from a thanks in a long thread needs more than routing does.
const MODEL = 'sonnet'

export function startHqLedgerDraftWriter(store: Store, runtime: OrcaRuntimeService): () => void {
  return startHqLedgerDrafts(
    {
      enabled: () => store.getSettings().hqLedger !== 'off' && !!store.getSettings().hqPath,
      cards: (since) => runtime.pulseListLedgerCards(since),
      draftOf: (id) => runtime.pulseAttribution().drafts.of(id),
      madeSince: (since) => runtime.pulseAttribution().drafts.madeSince(since),
      lines: (id) => runtime.pulseAttribution().drafts.lines(id),
      kindOf: (key) => {
        const [, channel, ts] = key.split(':')
        return channel && ts
          ? (runtime.pulseAttribution().drafts.kindOfSlack(channel, ts)?.kind ?? null)
          : null
      },
      generate: (prompt) => {
        const hqPath = store.getSettings().hqPath
        return hqPath
          ? generateHqText(
              prompt,
              { emptyResultName: 'ledger draft', operation: 'hq-ledger-draft', model: MODEL },
              {
                settings: store.getSettings(),
                cwd: hqPath,
                getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
              }
            )
          : Promise.resolve({ ok: false as const, error: 'No HQ folder is set.' })
      },
      save: (id, draft) => runtime.pulseAttribution().drafts.set(id, draft),
      quiet: (id, lastTs, why) => void runtime.pulseAttribution().drafts.quiet(id, lastTs, why),
      now: Date.now
    },
    hqLedgerErrorReporter('hq-ledger-draft', 'Ledger card drafts not written', (rows) =>
      runtime.pulseRecordJournal(rows)
    )
  )
}
