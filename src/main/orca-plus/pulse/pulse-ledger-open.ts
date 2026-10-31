// Custom build (hq-request-ledger): a project's open conversations for its card — the ones on our move
// or waiting on someone — with what we last said there, what came back, and the chat holding each.
import type { PulseCore } from './pulse-core'
import { liveSessionOf } from './pulse-chat-chain'

/** Why: the card shows six; a few more say how many it leaves out. */
const OPEN_DEPTH = 20

export type HqOpenConversation = {
  key: string
  state: 'you' | 'wait'
  title: string
  lastAt: number
  /** The last person who wrote there, else the one its waiting asks. */
  withWhom: string | null
  lastOut: { text: string; at: number } | null
  lastIn: { text: string; at: number } | null
  /** The live end of the holding chat's handoff chain, with its address when known. */
  holder: { sessionId: string; address: string | null } | null
}

function str(value: unknown): string | null {
  return value == null ? null : String(value)
}

/** Newest first: conversations of the project, or linked to its waitings, that are open. */
export function listOpenLedgerConversations(
  core: PulseCore,
  project: string
): HqOpenConversation[] {
  const last = core.db.prepare(
    `SELECT text, at, author FROM conversation_messages
      WHERE conversation_id = ? AND direction = ? AND ts NOT LIKE 'req:%'
      ORDER BY at DESC, ts DESC LIMIT 1`
  )
  const asked = core.db.prepare(
    `SELECT p.name FROM waitings w JOIN people p ON p.id = w.person_id
      WHERE w.conversation_id = ? ORDER BY w.created_at DESC LIMIT 1`
  )
  const address = core.db.prepare('SELECT address FROM sessions WHERE session_id = ?')
  return core.db
    .prepare(
      `SELECT c.* FROM conversations c
        WHERE c.state IN ('you', 'wait')
          AND (lower(c.project) = lower(?) OR EXISTS (SELECT 1 FROM waitings w
                WHERE w.conversation_id = c.id AND lower(w.project) = lower(?)))
        ORDER BY c.last_at DESC LIMIT ${OPEN_DEPTH}`
    )
    .all(project, project)
    .map((row) => {
      const id = String(row.id)
      const out = last.get(id, 'out')
      const incoming = last.get(id, 'in')
      const holder = str(row.session_id)
      const live = holder ? liveSessionOf(core, holder) : null
      return {
        key: String(row.key),
        state: row.state === 'you' ? 'you' : 'wait',
        title: String(row.title),
        lastAt: Number(row.last_at),
        withWhom: str(incoming?.author) ?? str(asked.get(id)?.name),
        lastOut: out ? { text: String(out.text), at: Number(out.at) } : null,
        lastIn: incoming ? { text: String(incoming.text), at: Number(incoming.at) } : null,
        holder: live ? { sessionId: live, address: str(address.get(live)?.address) } : null
      }
    })
}
