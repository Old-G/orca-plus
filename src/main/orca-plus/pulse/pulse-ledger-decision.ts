// Custom build (hq-intake-decide, owner 03.11, plan stage 20.3): the model's whole decision about a new
// conversation — the project, move and gist the ledger keeps, plus the chat it proposes —
// written as guesses with how sure it was and why, for the card to show and the owner to judge. A day's
// decisions are counted from the log, so a restart does not reset the limit.
import type { PulseCore } from './pulse-core'
import { setLedgerGuess, type HqLedgerGuess } from './pulse-ledger'
import { noteAttributionGuess } from './pulse-attribution'

export type HqLedgerDecision = HqLedgerGuess & {
  /** A chat's session id, or `new`. */
  chat: string
  confidence: number
  why: string | null
}

export function setLedgerDecision(
  core: PulseCore,
  conversationId: string,
  decision: HqLedgerDecision
): void {
  core.transaction(() => {
    setLedgerGuess(core, conversationId, decision)
    const row = core.db
      .prepare('SELECT key, project, project_how FROM conversations WHERE id = ?')
      .get(conversationId)
    if (!row) {
      return
    }
    const key = String(row.key)
    const sure = { confidence: decision.confidence, why: decision.why }
    if (row.project_how !== 'owner') {
      noteAttributionGuess(core, {
        key,
        field: 'project',
        value: row.project == null ? null : String(row.project),
        how: decision.how,
        ...sure
      })
    }
    noteAttributionGuess(core, { key, field: 'chat', value: decision.chat, how: 'model', ...sure })
  })
}

/** Custom build (hq-intake-decide): one call to the larger model, written before it is made. */
export const LEDGER_DECISION_ATTEMPT = 'ledger.decide.attempt'

export function noteLedgerDecisionAttempt(core: PulseCore): void {
  core.transaction(() => core.emit(LEDGER_DECISION_ATTEMPT, 'conversation', 'budget', {}))
}

/** Calls to the larger model since `since`, failed or unusable ones too — they were paid for. Why in
 *  the database (Codex 03.11): a restart must not give the day a fresh budget. */
export function ledgerDecisionAttemptsSince(core: PulseCore, since: number): number {
  const row = core.db
    .prepare('SELECT COUNT(*) n FROM events WHERE kind = ? AND at >= ?')
    .get(LEDGER_DECISION_ATTEMPT, since)
  return Number(row?.n ?? 0)
}
