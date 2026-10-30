// Custom build (hq-request-ledger): the ledger's Slack conversations that wait on the owner, with the
// people's last messages — what their cards show once the ledger is switched on.
import type { PulseCore } from './pulse-core'

export type HqLedgerCardMessage = {
  ts: string
  author: string | null
  authorId: string | null
  text: string
  link: string | null
  at: number
}

export type HqLedgerCardRow = {
  id: string
  key: string
  project: string | null
  title: string
  lastAt: number
  /** The people's messages, oldest first, at most five. */
  messages: HqLedgerCardMessage[]
}

const CARD_MESSAGES = 5

/** Custom build (hq-request-ledger): Slack conversations waiting on the owner, for their cards — not
 *  the ones where a chat waits for an answer: that answer has its own card with Send to chat. */
export function listLedgerCards(core: PulseCore, since: number): HqLedgerCardRow[] {
  const messages = core.db.prepare(
    `SELECT ts, author, author_id, text, link, at FROM conversation_messages
      WHERE conversation_id = ? AND direction = 'in' AND ts NOT LIKE 'req:%'
      ORDER BY at DESC, ts DESC LIMIT ${CARD_MESSAGES}`
  )
  return core.db
    .prepare(
      `SELECT id, key, project, title, last_at FROM conversations c
        WHERE state = 'you' AND key LIKE 'slack:%' AND last_at >= ?
          AND NOT EXISTS (SELECT 1 FROM waitings w WHERE w.conversation_id = c.id
                            AND w.status = 'open' AND w.direction = 'on-them')
        ORDER BY last_at`
    )
    .all(since)
    .map((row) => ({
      id: String(row.id),
      key: String(row.key),
      project: row.project == null ? null : String(row.project),
      title: String(row.title),
      lastAt: Number(row.last_at),
      messages: messages
        .all(String(row.id))
        .map((m) => ({
          ts: String(m.ts),
          author: m.author == null ? null : String(m.author),
          authorId: m.author_id == null ? null : String(m.author_id),
          text: String(m.text),
          link: m.link == null ? null : String(m.link),
          at: Number(m.at)
        }))
        .toReversed()
    }))
    .filter((row) => row.messages.length > 0)
}

/** Custom build (hq-request-ledger): a message the owner sent or skipped from its card is handled —
 *  its conversation is no longer his move, unless someone wrote after it. */
export function settleLedgerMessage(core: PulseCore, ts: string): void {
  const rows = core.db
    .prepare(
      `SELECT c.id FROM conversations c JOIN conversation_messages m ON m.conversation_id = c.id
        WHERE c.state = 'you' AND m.ts = ? AND m.direction = 'in'
          AND NOT EXISTS (SELECT 1 FROM conversation_messages n WHERE n.conversation_id = c.id
                            AND n.direction = 'in' AND n.at > m.at)`
    )
    .all(ts)
  for (const row of rows) {
    core.db
      .prepare(`UPDATE conversations SET state = 'fyi', state_why = NULL WHERE id = ?`)
      .run(String(row.id))
    core.emit('conversation.updated', 'conversation', String(row.id), { state: 'fyi' })
  }
}
