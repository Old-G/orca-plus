// Custom build (hq-attribution-log): what PulseDb exposes of the guess → final log, apart from the log
// itself so the model's decision (which writes guesses) can join without an import cycle.
import type { PulseCore } from './pulse-core'
import { pulseInWork } from './pulse-ledger-in-work'
import {
  noteAttributionSkip,
  noteAttributionTake,
  type HqAttributionTake
} from './pulse-attribution'
import { attributionAccuracy, attributionHints } from './pulse-attribution-stats'
import {
  ledgerDecisionAttemptsSince,
  noteLedgerDecisionAttempt,
  setLedgerDecision,
  type HqLedgerDecision
} from './pulse-ledger-decision'

/** What PulseDb exposes: the owner's take and skip, the counts, and the raw rows for tests. */
export function pulseAttribution(core: () => PulseCore) {
  return {
    take: (take: HqAttributionTake) => noteAttributionTake(core(), take),
    /** Custom build (hq-in-work): conversations a chat already works on — a state guess like the rest. */
    inWork: pulseInWork(core),
    skip: (key: string) => core().transaction(() => noteAttributionSkip(core(), key)),
    accuracy: (since: number) => attributionAccuracy(core(), since),
    hints: (keyPrefix: string) => attributionHints(core(), keyPrefix),
    /** Custom build (hq-intake-decide): the model's project, chat, kind and certainty. */
    decide: (conversationId: string, decision: HqLedgerDecision) =>
      setLedgerDecision(core(), conversationId, decision),
    attempt: () => noteLedgerDecisionAttempt(core()),
    attemptsSince: (since: number) => ledgerDecisionAttemptsSince(core(), since),
    records: () =>
      core()
        .db.prepare(
          'SELECT field, guess, guess_how, final, final_how FROM attribution_log ORDER BY id'
        )
        .all() as Record<string, unknown>[]
  }
}
