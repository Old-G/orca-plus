// Custom build (hq-request-ledger): which chat holds a conversation — the one it was taken into from
// a card, or the one that wrote there last — so an answer finds its chat by itself.
import type { HqLedgerSignal } from '../../../shared/hq-ledger'
import type { PulseCore } from './pulse-core'

/** The chat a conversation was taken into; later messages of its thread belong with it. */
export function setConversationChat(core: PulseCore, key: string, sessionId: string): void {
  core.db.prepare('UPDATE conversations SET session_id = ? WHERE key = ?').run(sessionId, key)
}

/** Call inside the ingest, for a message an agent sent: the message keeps its chat and approval and
 *  an empty conversation project takes the sender's — also when a reader had put the same message
 *  in first. The chat holds the conversation only when this is its newest owner message, so a late
 *  report of an older send does not take it from the chat that wrote after. */
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
  if (signal.project) {
    core.db
      .prepare('UPDATE conversations SET project = COALESCE(project, ?) WHERE id = ?')
      .run(signal.project, conversationId)
  }
  if (!signal.sessionId) {
    return
  }
  const own = core.db
    .prepare('SELECT at FROM conversation_messages WHERE conversation_id = ? AND ts = ?')
    .get(conversationId, signal.ts)
  const at = own ? Number(own.at) : signal.at
  core.db
    .prepare(
      `UPDATE conversations SET session_id = ? WHERE id = ? AND NOT EXISTS (
         SELECT 1 FROM conversation_messages m WHERE m.conversation_id = ? AND m.direction = 'out'
            AND (m.at > ? OR (m.at = ? AND m.ts > ?)))`
    )
    .run(signal.sessionId, conversationId, conversationId, at, at, signal.ts)
}

/** Custom build (hq-ledger-context): when a conversation's newest message was; 0 for none. */
export function conversationLastAt(core: PulseCore, conversationId: string): number {
  const row = core.db.prepare('SELECT last_at FROM conversations WHERE id = ?').get(conversationId)
  return Number(row?.last_at ?? 0)
}
