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

/** Custom build (hq-approve-source, U5): the line a Slack reply answers, whole, as the ledger kept it.
 *  In a thread: the thread's newest line from someone else (the root when nobody else spoke). In a DM
 *  without a thread: the newest incoming line of that DM. A top-level post in a channel answers
 *  nothing, so it has no source. */
export type LedgerSlackSource = {
  author: string | null
  at: number
  text: string
  link: string | null
}

export function slackSourceMessage(
  core: PulseCore,
  channel: string,
  threadTs: string | null
): LedgerSlackSource | null {
  const columns = `SELECT m.author, m.at, m.text, m.link
       FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id`
  const row = threadTs
    ? core.db
        .prepare(
          `${columns} WHERE c.key = ? AND m.direction = 'in'
           ORDER BY m.at DESC, m.ts DESC LIMIT 1`
        )
        .get(`slack:${channel}:${threadTs}`)
    : /^D[A-Z0-9]+$/.test(channel)
      ? core.db
          .prepare(
            `${columns} WHERE c.key LIKE ? AND m.direction = 'in'
             ORDER BY m.at DESC, m.ts DESC LIMIT 1`
          )
          .get(`slack:${channel}:%`)
      : undefined
  if (!row) {
    return null
  }
  return {
    author: row.author == null ? null : String(row.author),
    at: Number(row.at),
    text: String(row.text),
    link: row.link == null ? null : String(row.link)
  }
}
