// Custom build (hq-lead-reassign, owner 16.11): a chat moved to another Lead by `orca hq reassign`.
// One row per Lead it had before; all its rows name its Lead now. A chat and a Lead are named by their
// thread address (a handoff keeps it), else by session id. Its own table, outside the schema steps:
// no version bump, so the build before this one still opens the file.
import { HQ_REASSIGN_NO_LEAD, type HqChatLink } from '../../../shared/hq-chat-links'
import type { PulseCore } from './pulse-core'

export const CHAT_LEAD_MOVES_TABLE = `
CREATE TABLE IF NOT EXISTS chat_lead_moves (
  chat TEXT NOT NULL,
  from_lead TEXT NOT NULL,
  to_lead TEXT NOT NULL,
  session_id TEXT NOT NULL,
  to_session_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (chat, from_lead)
);
`

/** Custom build (hq-lead-reassign): a moved chat hangs under its Lead now, not the chat that started it;
 *  a chat moved to no Lead (T13) hangs under none, whatever links it has. */
export function withLeadMoves(core: PulseCore, links: HqChatLink[]): HqChatLink[] {
  const moves = core.db
    .prepare(
      // Why by time: a thread can have rows under its session id and its address (taken before it had
      // one, or under an older one); the latest move is the one that holds.
      'SELECT chat, session_id, to_lead, to_session_id, MAX(at) AS at FROM chat_lead_moves ' +
        'GROUP BY chat ORDER BY at'
    )
    .all()
  if (moves.length === 0) {
    return links
  }
  let out = links
  for (const move of moves) {
    const chat = String(move.chat)
    const sessionId = String(move.session_id)
    // Why: every chat of the moved thread (a handoff's too) leaves the old parent.
    const ids = new Set([chat, ...threadSessions(core, chat, sessionId)])
    const was = out.filter((link) => ids.has(link.sessionId))
    out = out.filter((link) => !ids.has(link.sessionId))
    if (String(move.to_lead) === HQ_REASSIGN_NO_LEAD) {
      continue
    }
    out.push({
      sessionId,
      parentSessionId: String(move.to_session_id),
      via: was.some((link) => link.via === 'launch') ? 'launch' : 'send',
      at: Number(move.at)
    })
  }
  return out
}

export type HqLeadMoveInput = {
  /** The moved chat: its thread address, else its session id. */
  chat: string
  sessionId: string
  /** Its Lead until now, by thread address or session id; `none` for a chat that had no Lead (T13). */
  fromLead: string
  /** `none`: the chat has no Lead now — one row that hides its links and forwards nothing (T13). */
  toLead: string
  toSessionId: string
  at: number
}

/** Custom build (hq-lead-reassign): `chat` has `toLead` for its Lead now; every Lead it had before
 *  forwards its messages there, and `toLead` is no longer one it had before. */
export function moveChatLead(core: PulseCore, input: HqLeadMoveInput): void {
  const { chat, fromLead, toLead } = input
  if (!chat || !fromLead || !toLead || fromLead === toLead || chat === toLead) {
    return
  }
  const insert = core.db.prepare(
    'INSERT INTO chat_lead_moves (chat, from_lead, to_lead, session_id, to_session_id, at) ' +
      'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chat, from_lead) DO UPDATE SET ' +
      'to_lead = excluded.to_lead, session_id = excluded.session_id, ' +
      'to_session_id = excluded.to_session_id, at = excluded.at'
  )
  core.transaction(() => {
    if (toLead === HQ_REASSIGN_NO_LEAD) {
      // Why not just drop its rows: a link written while it had a Lead (the Lead sent it work) would
      // put it back under that Lead.
      core.db.prepare('DELETE FROM chat_lead_moves WHERE chat = ?').run(chat)
      insert.run(chat, HQ_REASSIGN_NO_LEAD, HQ_REASSIGN_NO_LEAD, input.sessionId, '', input.at)
      return
    }
    core.db
      .prepare(
        'UPDATE chat_lead_moves SET to_lead = ?, session_id = ?, to_session_id = ?, at = ? WHERE chat = ?'
      )
      .run(toLead, input.sessionId, input.toSessionId, input.at, chat)
    core.db
      .prepare('DELETE FROM chat_lead_moves WHERE chat = ? AND from_lead = ?')
      .run(chat, toLead)
    insert.run(chat, fromLead, toLead, input.sessionId, input.toSessionId, input.at)
  })
}

/** The chats of `chat`'s thread: `sessionId` and, by the thread address (`chat`, else the one
 *  `sessionId` has now), every chat on it — a handoff's too. */
function threadSessions(core: PulseCore, chat: string, sessionId: string): Set<string> {
  const address = chat.includes('/')
    ? chat
    : core.db.prepare('SELECT address FROM sessions WHERE session_id = ?').get(sessionId)?.address
  const ids = new Set([sessionId])
  if (typeof address === 'string' && address) {
    for (const row of core.db
      .prepare('SELECT session_id FROM sessions WHERE address = ?')
      .all(address)) {
      ids.add(String(row.session_id))
    }
  }
  return ids
}

/** Custom build (hq-lead-reassign): where `chat`'s message to `lead` goes instead — its Lead now,
 *  when `lead` is one it had before; null otherwise, and for a chat that has no Lead now (T13). Its rows
 *  by session id count too: a chat taken before it had a thread address keeps them. */
export function leadMoveOf(core: PulseCore, chat: string, lead: string): string | null {
  const rows = core.db
    .prepare(
      'SELECT from_lead, to_lead FROM chat_lead_moves WHERE chat = ? OR ' +
        'chat IN (SELECT session_id FROM sessions WHERE address = ?) ORDER BY at DESC'
    )
    .all(chat, chat)
  const now = rows[0] ? String(rows[0].to_lead) : null
  if (!now || now === HQ_REASSIGN_NO_LEAD || now === lead) {
    return null
  }
  return rows.some((row) => String(row.from_lead) === lead) ? now : null
}
