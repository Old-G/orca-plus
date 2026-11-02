// Custom build (hq-ledger-answer-dedup): a person's message that the waiting-reply reader took as the
// answer to a waiting belongs to that waiting's conversation story — the ledger's conversation holding it
// takes the waiting's project when it has none, and the waiting points at it. Either may come first: the
// ledger reads the message, or the reply reader pairs it (01.11: an owner's nudge in an old DM thread
// opened a conversation with no project, and the person's answer became an Unsorted card beside its own
// answer card).
import type { PulseCore } from './pulse-core'
import { noteConversationProjectGuess } from './pulse-attribution'

/** Links the conversation holding the message `ts` and the waiting answered by it, if both exist. */
export function linkWaitingAnswer(core: PulseCore, waitingId: string, ts: string): void {
  const conversation = core.db
    .prepare(
      `SELECT c.id, c.project FROM conversations c
         JOIN conversation_messages m ON m.conversation_id = c.id
        WHERE m.ts = ? AND m.direction = 'in' LIMIT 1`
    )
    .get(ts)
  const waiting = core.db
    .prepare('SELECT project, conversation_id FROM waitings WHERE id = ?')
    .get(waitingId)
  if (!conversation || !waiting) {
    return
  }
  const conversationId = String(conversation.id)
  if (waiting.conversation_id == null) {
    core.db
      .prepare('UPDATE waitings SET conversation_id = ? WHERE id = ?')
      .run(conversationId, waitingId)
  }
  if (conversation.project == null && waiting.project != null) {
    core.db
      .prepare(`UPDATE conversations SET project = ?, project_how = 'reply' WHERE id = ?`)
      .run(String(waiting.project), conversationId)
    noteConversationProjectGuess(core, conversationId)
    core.emit('conversation.updated', 'conversation', conversationId, {
      project: String(waiting.project)
    })
  }
}

/** The waitings already answered by the message `ts`, for the ledger that reads it after the pairing. */
export function waitingsAnsweredBy(core: PulseCore, ts: string): string[] {
  return core.db
    .prepare('SELECT id FROM waitings WHERE reply_ts = ?')
    .all(ts)
    .map((row) => String(row.id))
}
