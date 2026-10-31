// Custom build (hq-request-ledger): which chat holds a conversation — the one it was taken into from
// a card, or the one that wrote there last — so an answer finds its chat by itself.
import type { HqLedgerSignal } from '../../../shared/hq-ledger'
import type { PulseCore } from './pulse-core'

/** The chat a conversation was taken into; later messages of its thread belong with it. */
export function setConversationChat(core: PulseCore, key: string, sessionId: string): void {
  core.db.prepare('UPDATE conversations SET session_id = ? WHERE key = ?').run(sessionId, key)
}

/** Call inside the ingest: the chat that sent the message holds the conversation, and the message
 *  keeps its chat and approval — also when a reader had put the same message in first. */
export function noteSendingChat(
  core: PulseCore,
  conversationId: string,
  signal: HqLedgerSignal
): void {
  core.db
    .prepare(
      `UPDATE conversation_messages SET session_id = COALESCE(session_id, ?),
         decision_id = COALESCE(decision_id, ?) WHERE conversation_id = ? AND ts = ?`
    )
    .run(signal.sessionId ?? null, signal.decisionId ?? null, conversationId, signal.ts)
  core.db
    .prepare('UPDATE conversations SET session_id = ? WHERE id = ?')
    .run(signal.sessionId ?? null, conversationId)
}
