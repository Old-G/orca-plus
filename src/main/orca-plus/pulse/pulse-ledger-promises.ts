// Custom build (hq-ledger-promises, plan 20.9): the owner's own lines in the ledger — Slack, the ones
// sent through Approve, his ClickUp comments — for the promise finder, read once each. The scout read
// them every 15 minutes from Slack search; the ledger has them within a minute of being said.
import type { PulseCore } from './pulse-core'

/** How far the finder has read, and each call it made — the day's budget survives a restart. */
const LOOKED_EVENT = 'ledger.promise.looked'

export type HqLedgerOwnLine = {
  conversationId: string
  key: string
  ts: string
  text: string
  link: string
  at: number
  project: string | null
  /** Who the line answers: the person who last wrote before it in the same talk. */
  peer: string | null
  peerId: string | null
  /** What that person said, for the model to see what was promised to whom. */
  peerText: string | null
}

export function pulseLedgerPromises(core: () => PulseCore) {
  return {
    /** The owner's lines after `since` (ms), oldest first — only those with a link to open them by. */
    ownLines: (since: number, limit: number): HqLedgerOwnLine[] =>
      core()
        .db.prepare(
          `SELECT m.conversation_id, c.key, c.project, m.ts, m.text, m.link, m.at,
                  p.author peer, p.author_id peer_id, p.text peer_text
             FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
             LEFT JOIN conversation_messages p ON p.rowid = (
               SELECT i.rowid FROM conversation_messages i
                WHERE i.conversation_id = m.conversation_id AND i.direction = 'in' AND i.at <= m.at
                  AND i.ts NOT LIKE 'req:%'
                ORDER BY i.at DESC LIMIT 1)
            WHERE m.direction = 'out' AND m.at > ? AND m.link LIKE 'https://%'
              AND m.ts NOT LIKE 'sent:%' AND m.ts NOT LIKE 'req:%'
            ORDER BY m.at, m.ts LIMIT ?`
        )
        .all(since, limit)
        .map((row) => ({
          conversationId: String(row.conversation_id),
          key: String(row.key),
          ts: String(row.ts),
          text: String(row.text),
          link: String(row.link),
          at: Number(row.at),
          project: row.project == null ? null : String(row.project),
          peer: row.peer == null ? null : String(row.peer),
          peerId: row.peer_id == null ? null : String(row.peer_id),
          peerText: row.peer_text == null ? null : String(row.peer_text)
        })),
    /** The newest line already read; null before the first look. */
    lookedUpTo: (): number | null => {
      const row = core()
        .db.prepare('SELECT payload FROM events WHERE kind = ? ORDER BY seq DESC LIMIT 1')
        .get(LOOKED_EVENT)
      if (!row) {
        return null
      }
      try {
        const at: unknown = Reflect.get(JSON.parse(String(row.payload)) as object, 'upTo')
        return typeof at === 'number' ? at : null
      } catch {
        return null
      }
    },
    looked: (upTo: number): void =>
      core().transaction(() => core().emit(LOOKED_EVENT, 'conversation', 'promises', { upTo })),
    looksSince: (since: number): number =>
      Number(
        core()
          .db.prepare('SELECT COUNT(*) n FROM events WHERE kind = ? AND at >= ?')
          .get(LOOKED_EVENT, since)?.n ?? 0
      )
  }
}
