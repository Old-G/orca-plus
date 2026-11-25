// Custom build (google-disconnect-forget): what HQ keeps of Google mail once the mailbox is
// disconnected, or once a mail thread has been quiet for 30 days — the conversation's own id, project,
// chat and times. The letters, subjects, senders, the model's gist and drafts, and a reply copied into
// a waiting are removed (Google Workspace AI Tools Addendum: no user data after a disconnect, no
// derived findings kept past 30 days).
import { LEDGER_DRAFT_EVENT } from './pulse-ledger-draft'
import type { PulseCore } from './pulse-core'

/** How long a quiet mail thread keeps its text. */
export const HQ_MAIL_KEEP_MS = 30 * 24 * 60 * 60_000

/** The title a forgotten mail thread shows in HQ's history. */
export const FORGOTTEN_MAIL_TITLE = 'Mail thread (removed)'

/** Every ledger conversation of a Gmail thread is keyed `gmail:<thread id>`. */
const MAIL_KEY = 'gmail:%'

/** A waiting answered by a letter keeps that it was answered and when (`replied_at`), not the words. */
const FORGET_REPLY =
  'reply = NULL, reply_author = NULL, reply_author_id = NULL, reply_link = NULL, reply_ts = NULL'

export type HqMailForgetResult = { conversations: number; messages: number }

/**
 * `before` absent: every mail thread (the mailbox was disconnected). `before` set: threads with nothing
 * since then are forgotten whole, and older letters leave the threads still going.
 */
export function forgetLedgerMail(core: PulseCore, before?: number): HqMailForgetResult {
  // Why: a deleted row's bytes otherwise stay in the file's free pages.
  core.db.pragma('secure_delete = ON')
  const result = core.transaction((): HqMailForgetResult => {
    const quiet = core.db
      .prepare(
        before === undefined
          ? 'SELECT id, key FROM conversations WHERE key LIKE ?'
          : 'SELECT id, key FROM conversations WHERE key LIKE ? AND last_at < ?'
      )
      .all(...(before === undefined ? [MAIL_KEY] : [MAIL_KEY, before]))
      .map((row) => ({ id: String(row.id), key: String(row.key) }))
    let messages = 0
    for (const conversation of quiet) {
      messages += forgetConversation(core, conversation)
    }
    if (before !== undefined) {
      messages += forgetOldLetters(core, before)
    }
    return { conversations: quiet.length, messages }
  })
  if (result.conversations > 0 || result.messages > 0) {
    // Why: the WAL still holds the old pages until it is folded into the file.
    core.db.pragma('wal_checkpoint(TRUNCATE)')
  }
  return result
}

function forgetConversation(core: PulseCore, { id, key }: { id: string; key: string }): number {
  core.db
    .prepare(
      `UPDATE waitings SET ${FORGET_REPLY}
        WHERE conversation_id = ? AND reply_ts IN
          (SELECT ts FROM conversation_messages WHERE conversation_id = ?)`
    )
    .run(id, id)
  const messages = Number(
    core.db.prepare('DELETE FROM conversation_messages WHERE conversation_id = ?').run(id).changes
  )
  core.db
    .prepare("DELETE FROM events WHERE kind = ? AND entity = 'conversation' AND entity_id = ?")
    .run(LEDGER_DRAFT_EVENT, id)
  // Why keep the rows: they count how often a guess was right; the model's reason read the letter.
  const forgotten = `gmail-removed:${id}`
  core.db
    .prepare(
      'UPDATE attribution_log SET conversation_key = ?, why = NULL WHERE conversation_key = ?'
    )
    .run(forgotten, key)
  core.db
    .prepare(
      `UPDATE conversations SET key = ?, title = ?, state = 'done', state_why = NULL WHERE id = ?`
    )
    .run(forgotten, FORGOTTEN_MAIL_TITLE, id)
  core.emit('conversation.updated', 'conversation', id, { state: 'done', forgotten: true })
  return messages
}

/** Letters older than `before` in threads that are still going; the newest letter is never older. */
function forgetOldLetters(core: PulseCore, before: number): number {
  const old = `SELECT m.conversation_id, m.ts FROM conversation_messages m
                 JOIN conversations c ON c.id = m.conversation_id
                WHERE c.key LIKE ? AND m.at < ?`
  core.db
    .prepare(
      `UPDATE waitings SET ${FORGET_REPLY}
        WHERE (conversation_id, reply_ts) IN (${old})`
    )
    .run(MAIL_KEY, before)
  return Number(
    core.db
      .prepare(`DELETE FROM conversation_messages WHERE (conversation_id, ts) IN (${old})`)
      .run(MAIL_KEY, before).changes
  )
}
