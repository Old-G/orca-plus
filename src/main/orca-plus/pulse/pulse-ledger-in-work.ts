// Custom build (hq-in-work, owner 03.11, plan stage 20.11): a conversation one of the owner's chats
// already works on is not his move. It leaves the cards for a line «In work in <chat>», keeps its chat
// for the thread's next messages, and the guess is judged like any other: «Not in work» puts the card
// back and counts as a change.
import { noteAttributionFinal, noteAttributionGuess } from './pulse-attribution'
import type { PulseCore } from './pulse-core'

export const HQ_IN_WORK = 'in-work'

export type HqInWorkCandidate = {
  id: string
  key: string
  title: string
  /** Its newest message: a chat counts only from then, so a new message after work began is seen. */
  lastAt: number
  /** The people's messages, oldest first. */
  texts: string[]
}

const CANDIDATE_TEXTS = 5

/** Slack conversations waiting on the owner since `since` — those a chat may have taken already. Not
 *  those with an open waiting: a person's answer to our question goes to its chat by «Send to chat». */
export function listInWorkCandidates(core: PulseCore, since: number): HqInWorkCandidate[] {
  const texts = core.db.prepare(
    `SELECT text FROM conversation_messages WHERE conversation_id = ? AND direction = 'in'
      ORDER BY at, ts LIMIT ${CANDIDATE_TEXTS}`
  )
  return core.db
    .prepare(
      `SELECT id, key, title, last_at FROM conversations c
        WHERE state = 'you' AND key LIKE 'slack:%' AND last_at >= ?
          AND NOT EXISTS (SELECT 1 FROM waitings w WHERE w.conversation_id = c.id AND w.status = 'open')
        ORDER BY last_at DESC`
    )
    .all(since)
    .map((row) => ({
      id: String(row.id),
      key: String(row.key),
      title: String(row.title),
      lastAt: Number(row.last_at),
      texts: texts.all(String(row.id)).map((m) => String(m.text))
    }))
}

/** Mark a conversation as in work in a chat; false when it no longer waits on the owner. `named` — the
 *  chat holds its link or words; `model` — the model read the chat as doing it. */
export function setConversationInWork(
  core: PulseCore,
  conversationId: string,
  sessionId: string,
  how: 'named' | 'model',
  why: string | null,
  confidence: number | null = null
): boolean {
  return core.transaction(() => {
    const row = core.db
      .prepare(`SELECT key FROM conversations WHERE id = ? AND state = 'you'`)
      .get(conversationId)
    if (!row) {
      return false
    }
    core.db
      .prepare(`UPDATE conversations SET state = 'fyi', state_why = ?, session_id = ? WHERE id = ?`)
      .run(HQ_IN_WORK, sessionId, conversationId)
    noteAttributionGuess(core, {
      key: String(row.key),
      field: 'state',
      value: HQ_IN_WORK,
      how,
      confidence,
      why
    })
    core.emit('conversation.updated', 'conversation', conversationId, {
      state: 'fyi',
      inWork: true
    })
    return true
  })
}

/** The owner says it is not in work: the card comes back as his move, and the guess counts as wrong. */
export function clearConversationInWork(core: PulseCore, conversationId: string): boolean {
  return core.transaction(() => {
    const row = core.db
      .prepare(`SELECT key FROM conversations WHERE id = ? AND state_why = ?`)
      .get(conversationId, HQ_IN_WORK)
    if (!row) {
      return false
    }
    core.db
      .prepare(`UPDATE conversations SET state = 'you', state_why = NULL WHERE id = ?`)
      .run(conversationId)
    noteAttributionFinal(core, String(row.key), 'state', 'you')
    core.emit('conversation.updated', 'conversation', conversationId, { state: 'you' })
    return true
  })
}

export type HqInWorkRow = {
  id: string
  key: string
  title: string
  lastAt: number
  sessionId: string
  address: string | null
}

/** Conversations in work in a chat since `since`, newest first — the lines HQ+ shows. */
export function listInWorkConversations(core: PulseCore, since: number): HqInWorkRow[] {
  return core.db
    .prepare(
      `SELECT c.id, c.key, c.title, c.last_at, c.session_id, s.address FROM conversations c
         LEFT JOIN sessions s ON s.session_id = c.session_id
        WHERE c.state_why = ? AND c.state = 'fyi' AND c.session_id IS NOT NULL AND c.last_at >= ?
        ORDER BY c.last_at DESC`
    )
    .all(HQ_IN_WORK, since)
    .map((row) => ({
      id: String(row.id),
      key: String(row.key),
      title: String(row.title),
      lastAt: Number(row.last_at),
      sessionId: String(row.session_id),
      address: row.address == null ? null : String(row.address)
    }))
}

const CHAT_CHECKED = 'ledger.inwork.checked'

/** A chat the model read for work in progress, and the conversations it was shown — each once per
 *  chat, kept across restarts. */
export function noteInWorkChatChecked(
  core: PulseCore,
  sessionId: string,
  conversationIds: readonly string[]
): void {
  core.transaction(() =>
    core.emit(CHAT_CHECKED, 'conversation', sessionId, { conversations: conversationIds })
  )
}

/** The conversations each chat was shown; null for a chat read whole, before they were noted. */
export function inWorkChatsChecked(
  core: PulseCore,
  since: number
): Map<string, Set<string> | null> {
  const shown = new Map<string, Set<string> | null>()
  for (const row of core.db
    .prepare('SELECT entity_id, payload FROM events WHERE kind = ? AND at >= ?')
    .all(CHAT_CHECKED, since)) {
    const sessionId = String(row.entity_id)
    const ids: unknown = Reflect.get(JSON.parse(String(row.payload ?? '{}')) ?? {}, 'conversations')
    const seen = shown.get(sessionId)
    if (!Array.isArray(ids) || seen === null) {
      shown.set(sessionId, null)
      continue
    }
    shown.set(sessionId, new Set([...(seen ?? []), ...ids.map(String)]))
  }
  return shown
}

/** What PulseDb exposes as `inWork`. */
export function pulseInWork(core: () => PulseCore) {
  return {
    candidates: (since: number) => listInWorkCandidates(core(), since),
    set: (
      conversationId: string,
      sessionId: string,
      how: 'named' | 'model',
      why: string | null,
      confidence: number | null = null
    ) => setConversationInWork(core(), conversationId, sessionId, how, why, confidence),
    clear: (conversationId: string) => clearConversationInWork(core(), conversationId),
    list: (since: number) => listInWorkConversations(core(), since),
    noteChecked: (sessionId: string, conversationIds: readonly string[]) =>
      noteInWorkChatChecked(core(), sessionId, conversationIds),
    checked: (since: number) => inWorkChatsChecked(core(), since)
  }
}
