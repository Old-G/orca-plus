// Custom build (hq-request-ledger): small reads of the ledger's rows its ingest ladder needs — the
// conversation of a place, the person behind an author id, and whose move a person's line leaves.
import type { HqConversationState } from '../../../shared/hq-ledger'
import type { PulseCore } from './pulse-core'

export function conversationIdByKey(core: PulseCore, key: string): string | null {
  const row = core.db.prepare('SELECT id FROM conversations WHERE key = ?').get(key)
  return row ? String(row.id) : null
}

export function personOf(core: PulseCore, authorId: string | null): string | null {
  if (!authorId) {
    return null
  }
  const row = core.db
    .prepare('SELECT id FROM people WHERE slack_user_id = ? OR clickup_user_id = ?')
    .get(authorId, authorId)
  return row ? String(row.id) : null
}

/** The state a person's newest line leaves: his move when it is to him or answers his question, and
 *  still his when it was — Custom build (hq-ledger-owner-move, owner 11.11): a colleague tagged him, another
 *  answered in the thread six minutes later, and the ask left his move with no card. Only the owner's
 *  own line or the model's read of the whole talk (hq-ledger-drafts) takes it off him. */
export function incomingState(
  core: PulseCore,
  conversationId: string,
  toOwner: boolean
): { state: HqConversationState; why: string | null } {
  if (toOwner) {
    return { state: 'you', why: null }
  }
  const was = core.db
    .prepare('SELECT state, state_why FROM conversations WHERE id = ?')
    .get(conversationId)
  return was?.state === 'you'
    ? { state: 'you', why: was.state_why == null ? null : String(was.state_why) }
    : { state: 'fyi', why: null }
}
