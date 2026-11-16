// Custom build (hq-lead-reassign, owner 16.11): a chat moved to another Lead by `orca hq reassign`.
// One row per Lead it had before; all its rows name its Lead now. A chat and a Lead are named by their
// thread address (a handoff keeps it), else by session id. Its own table, outside the schema steps:
// no version bump, so the build before this one still opens the file.
import type { HqChatLink } from '../../../shared/hq-chat-links'
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

/** Custom build (hq-lead-reassign): a moved chat hangs under its Lead now, not the chat that started it. */
export function withLeadMoves(core: PulseCore, links: HqChatLink[]): HqChatLink[] {
  const moves = core.db
    .prepare('SELECT chat, session_id, to_session_id, at FROM chat_lead_moves GROUP BY chat')
    .all()
  if (moves.length === 0) {
    return links
  }
  const sessionsOf = core.db.prepare('SELECT session_id FROM sessions WHERE address = ?')
  let out = links
  for (const move of moves) {
    const chat = String(move.chat)
    const sessionId = String(move.session_id)
    // Why: every chat of the moved thread (a handoff's too) leaves the old parent.
    const ids = new Set([chat, sessionId])
    if (chat.includes('/')) {
      for (const row of sessionsOf.all(chat)) {
        ids.add(String(row.session_id))
      }
    }
    const was = out.filter((link) => ids.has(link.sessionId))
    out = out.filter((link) => !ids.has(link.sessionId))
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
  /** Its Lead until now, by thread address or session id. */
  fromLead: string
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
  core.transaction(() => {
    core.db
      .prepare(
        'UPDATE chat_lead_moves SET to_lead = ?, session_id = ?, to_session_id = ?, at = ? WHERE chat = ?'
      )
      .run(toLead, input.sessionId, input.toSessionId, input.at, chat)
    core.db
      .prepare('DELETE FROM chat_lead_moves WHERE chat = ? AND from_lead = ?')
      .run(chat, toLead)
    core.db
      .prepare(
        'INSERT INTO chat_lead_moves (chat, from_lead, to_lead, session_id, to_session_id, at) ' +
          'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chat, from_lead) DO UPDATE SET ' +
          'to_lead = excluded.to_lead, session_id = excluded.session_id, ' +
          'to_session_id = excluded.to_session_id, at = excluded.at'
      )
      .run(chat, fromLead, toLead, input.sessionId, input.toSessionId, input.at)
  })
}

/** Custom build (hq-lead-reassign): where `chat`'s message to `lead` goes instead — its Lead now,
 *  when `lead` is one it had before; null otherwise. */
export function leadMoveOf(core: PulseCore, chat: string, lead: string): string | null {
  const row = core.db
    .prepare('SELECT to_lead FROM chat_lead_moves WHERE chat = ? AND from_lead = ?')
    .get(chat, lead)
  return row ? String(row.to_lead) : null
}
