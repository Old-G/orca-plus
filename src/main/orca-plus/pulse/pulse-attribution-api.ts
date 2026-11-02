// Custom build (hq-attribution-log): what PulseDb exposes of the guess → final log, apart from the log
// itself so the model's decision (which writes guesses) can join without an import cycle.
import type { PulseCore } from './pulse-core'
import {
  attributionAccuracy,
  attributionHints,
  noteAttributionSkip,
  noteAttributionTake,
  type HqAttributionTake
} from './pulse-attribution'
import {
  ledgerDecisionsSince,
  setLedgerDecision,
  type HqLedgerDecision
} from './pulse-ledger-decision'

/** What PulseDb exposes: the owner's take and skip, the counts, and the raw rows for tests. */
export function pulseAttribution(core: () => PulseCore) {
  return {
    take: (take: HqAttributionTake) => noteAttributionTake(core(), take),
    skip: (key: string) => core().transaction(() => noteAttributionSkip(core(), key)),
    accuracy: (since: number) => attributionAccuracy(core(), since),
    hints: (keyPrefix: string) => attributionHints(core(), keyPrefix),
    /** Custom build (hq-intake-decide): the model's project, chat, kind and certainty. */
    decide: (conversationId: string, decision: HqLedgerDecision) =>
      setLedgerDecision(core(), conversationId, decision),
    decisionsSince: (since: number) => ledgerDecisionsSince(core(), since),
    records: () =>
      core()
        .db.prepare(
          'SELECT field, guess, guess_how, final, final_how FROM attribution_log ORDER BY id'
        )
        .all() as Record<string, unknown>[]
  }
}
