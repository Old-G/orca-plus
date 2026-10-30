// Custom build (hq-request-ledger): where an answer goes when the asking chat handed its work on —
// the journal's `session.handoff` rows (session_id = the new chat, ref_id = the old one) and a
// session's parent link, followed forward to the last chat of the chain.
import type { PulseCore } from './pulse-core'

const MAX_HOPS = 32

/** The chats that continued `sessionId`, newest handoff first. */
function successorsOf(core: PulseCore, sessionId: string): string[] {
  const rows = core.db
    .prepare(
      `SELECT session_id AS next FROM journal
         WHERE kind = 'session.handoff' AND ref_id = ? AND session_id IS NOT NULL
       UNION
       SELECT session_id AS next FROM sessions WHERE parent_session_id = ?`
    )
    .all(sessionId, sessionId)
  return rows.map((row) => String(row.next)).filter((next) => next !== sessionId)
}

/** The live end of the handoff chain that starts at `sessionId` (itself when nothing continued it).
 *  A fork — two chats continuing one — follows the most recently active one. */
export function liveSessionOf(core: PulseCore, sessionId: string): string {
  const seen = new Set([sessionId])
  let current = sessionId
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const next = successorsOf(core, current).filter((id) => !seen.has(id))
    if (next.length === 0) {
      return current
    }
    current = next.length === 1 ? next[0] : mostRecentlyActive(core, next)
    seen.add(current)
  }
  return current
}

function mostRecentlyActive(core: PulseCore, ids: readonly string[]): string {
  const marks = ids.map((id) => {
    const row = core.db
      .prepare('SELECT last_activity_at FROM sessions WHERE session_id = ?')
      .get(id)
    return { id, at: row ? Number(row.last_activity_at) : 0 }
  })
  marks.sort((a, b) => b.at - a.at)
  return marks[0].id
}
