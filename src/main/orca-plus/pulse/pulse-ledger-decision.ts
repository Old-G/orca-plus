// Custom build (hq-intake-decide, owner 03.11, plan stage 20.3): the model's whole decision about a new
// conversation — the project, move and gist the ledger keeps, plus the chat and card kind it proposes —
// written as guesses with how sure it was and why, for the card to show and the owner to judge. A day's
// decisions are counted from the log, so a restart does not reset the limit.
import type { PulseCore } from './pulse-core'
import { setLedgerGuess, type HqLedgerGuess } from './pulse-ledger'
import { noteAttributionGuess } from './pulse-attribution'

export type HqLedgerDecision = HqLedgerGuess & {
  /** A chat's session id, or `new`. */
  chat: string
  kind: string
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
    // Why not the kind yet (Codex 03.11): only what the owner can see and change on the card is
    // counted; the kind joins with the card that shows it (plan 20.7).
  })
}

/** Custom build (hq-intake-decide): how many conversations the model decided since `since`. */
export function ledgerDecisionsSince(core: PulseCore, since: number): number {
  const row = core.db
    .prepare(
      `SELECT COUNT(DISTINCT conversation_key) n FROM attribution_log
        WHERE field = 'chat' AND guess_how = 'model' AND guessed_at >= ?`
    )
    .get(since)
  return Number(row?.n ?? 0)
}
