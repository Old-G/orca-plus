// Custom build (hq-request-ledger): the one way in for every reader. A message lands in its
// conversation by the ladder — same place, else the one open request to its author, else «which?» to
// the owner, else a new conversation — and one row per conversation says whose move it is.
import {
  hqPlaceKey,
  type HqConversationState,
  type HqLedgerResult,
  type HqLedgerSignal,
  type HqLedgerStep
} from '../../../shared/hq-ledger'
import type { PulseCore } from './pulse-core'
import { closeWaiting } from './pulse-waitings'

/** Why: an answer by DM to a question older than two weeks is rarely to that question. */
export const HQ_LEDGER_PERSON_WINDOW_MS = 14 * 24 * 60 * 60_000
/** Why: top-level DM lines have no thread; a day of them is one talk. */
export const HQ_LEDGER_DM_TALK_MS = 24 * 60 * 60_000

const DM_KEY = /^slack:(D[A-Z0-9]+):/

/** A top-level DM line joins the DM's talk of the last day instead of opening a conversation of one. */
function dmTalkOf(core: PulseCore, signal: HqLedgerSignal): string | null {
  const dm = DM_KEY.exec(signal.key)
  if (!dm) {
    return null
  }
  const row = core.db
    .prepare(
      `SELECT id FROM conversations WHERE key LIKE ? AND last_at >= ? ORDER BY last_at DESC LIMIT 1`
    )
    .get(`slack:${dm[1]}:%`, signal.at - HQ_LEDGER_DM_TALK_MS)
  return row ? String(row.id) : null
}

type OpenWaiting = {
  id: string
  direction: 'on-me' | 'on-them'
  personId: string | null
  key: string | null
  createdAt: number
  conversationId: string | null
  project: string | null
  title: string
}

function openWaitings(core: PulseCore): OpenWaiting[] {
  return core.db
    .prepare(
      `SELECT id, direction, person_id, source_ref, created_at, conversation_id, project, title
         FROM waitings WHERE status = 'open'`
    )
    .all()
    .map((row) => ({
      id: String(row.id),
      direction: row.direction === 'on-me' ? 'on-me' : 'on-them',
      personId: row.person_id == null ? null : String(row.person_id),
      key: hqPlaceKey(row.source_ref == null ? null : String(row.source_ref)),
      createdAt: Number(row.created_at),
      conversationId: row.conversation_id == null ? null : String(row.conversation_id),
      project: row.project == null ? null : String(row.project),
      title: String(row.title)
    }))
}

function conversationIdByKey(core: PulseCore, key: string): string | null {
  const row = core.db.prepare('SELECT id FROM conversations WHERE key = ?').get(key)
  return row ? String(row.id) : null
}

function personOf(core: PulseCore, authorId: string | null): string | null {
  if (!authorId) {
    return null
  }
  const row = core.db
    .prepare('SELECT id FROM people WHERE slack_user_id = ? OR clickup_user_id = ?')
    .get(authorId, authorId)
  return row ? String(row.id) : null
}

function createConversation(
  core: PulseCore,
  key: string,
  signal: HqLedgerSignal,
  project: string | null,
  how: string | null
): string {
  const id = core.clock.newId()
  core.db
    .prepare(
      `INSERT INTO conversations (id, key, project, project_how, title, state, created_at, last_at)
       VALUES (?, ?, ?, ?, ?, 'fyi', ?, ?)`
    )
    .run(id, key, project, how, signal.title, signal.at, signal.at)
  return id
}

/** The conversation a waiting's question lives in, made on first need. */
function conversationOfWaiting(
  core: PulseCore,
  waiting: OpenWaiting,
  signal: HqLedgerSignal
): string {
  if (waiting.conversationId) {
    return waiting.conversationId
  }
  const key = waiting.key ?? `waiting:${waiting.id}`
  const id =
    conversationIdByKey(core, key) ??
    createConversation(core, key, { ...signal, title: waiting.title }, waiting.project, 'reply')
  core.db.prepare('UPDATE waitings SET conversation_id = ? WHERE id = ?').run(id, waiting.id)
  return id
}

/** Puts one message where it belongs and moves its conversation's state. Idempotent per message. */
export function ingestLedgerSignal(core: PulseCore, signal: HqLedgerSignal): HqLedgerResult {
  const promises: string[] = []
  const result = core.transaction((): HqLedgerResult => {
    const open = openWaitings(core)
    const atPlace = open.filter((waiting) => waiting.key === signal.key)
    let step: HqLedgerStep = 'new'
    let conversationId = conversationIdByKey(core, signal.key) ?? dmTalkOf(core, signal)
    let candidates: OpenWaiting[] = []
    if (conversationId || atPlace.length > 0) {
      step = 'place'
    } else if (!signal.fromOwner && DM_KEY.test(signal.key)) {
      // Why only a DM: a message in a new channel thread starts its own talk; an answer by DM
      // to a question asked elsewhere is the case the person step is for.
      const personId = personOf(core, signal.authorId)
      candidates = personId
        ? open.filter(
            (waiting) =>
              waiting.direction === 'on-them' &&
              waiting.personId === personId &&
              signal.at - waiting.createdAt <= HQ_LEDGER_PERSON_WINDOW_MS
          )
        : []
      if (candidates.length === 1) {
        step = 'person'
        conversationId = conversationOfWaiting(core, candidates[0], signal)
      } else if (candidates.length > 1) {
        step = 'which'
      }
    }
    if (!conversationId) {
      conversationId = createConversation(
        core,
        signal.key,
        signal,
        signal.project ?? atPlace.find((waiting) => waiting.project)?.project ?? null,
        signal.project ? 'rule' : atPlace.some((w) => w.project) ? 'reply' : null
      )
    }
    for (const waiting of atPlace) {
      if (!waiting.conversationId) {
        core.db
          .prepare('UPDATE waitings SET conversation_id = ? WHERE id = ?')
          .run(conversationId, waiting.id)
      }
    }
    const added =
      core.db
        .prepare(
          `INSERT OR IGNORE INTO conversation_messages
             (conversation_id, ts, direction, author, author_id, text, link, reader, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          conversationId,
          signal.ts,
          signal.fromOwner ? 'out' : 'in',
          signal.author,
          signal.authorId,
          signal.text,
          signal.link,
          signal.reader,
          signal.at
        ).changes > 0
    const linked = core.db
      .prepare(
        `SELECT id, direction, created_at FROM waitings WHERE status = 'open' AND conversation_id = ?`
      )
      .all(conversationId)
    const asking = linked.filter((row) => row.direction === 'on-them').map((row) => String(row.id))
    if (added) {
      let state: HqConversationState
      let why: string | null = null
      if (signal.fromOwner) {
        // Why: the owner wrote in the thread after it waited on him — that settles his move.
        for (const row of linked) {
          if (row.direction === 'on-me' && Number(row.created_at) <= signal.at) {
            promises.push(String(row.id))
          }
        }
        state = asking.length > 0 ? 'wait' : 'fyi'
        step = step === 'new' ? 'owner' : step
      } else if (step === 'which') {
        state = 'you'
        why = `which:${candidates.map((waiting) => waiting.id).join(',')}`
      } else {
        state = asking.length > 0 || signal.forOwner ? 'you' : 'fyi'
      }
      core.db
        .prepare(
          `UPDATE conversations SET state = ?, state_why = ?, last_at = MAX(last_at, ?),
             project = COALESCE(project, ?) WHERE id = ?`
        )
        .run(state, why, signal.at, signal.project, conversationId)
      core.emit('conversation.updated', 'conversation', conversationId, { state, step })
    }
    const waitingIds = step === 'which' ? candidates.map((w) => w.id) : asking
    return { conversationId, step, added, waitingIds }
  })
  for (const id of promises) {
    closeWaiting(core, id, 'resolved', 'the owner answered in the thread')
  }
  return result
}

export type HqConversationRow = {
  id: string
  key: string
  project: string | null
  state: HqConversationState
  stateWhy: string | null
  title: string
  lastAt: number
  messages: number
}

export function listLedgerConversations(core: PulseCore, since = 0): HqConversationRow[] {
  return core.db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id = c.id) n
         FROM conversations c WHERE last_at >= ? ORDER BY last_at`
    )
    .all(since)
    .map((row) => ({
      id: String(row.id),
      key: String(row.key),
      project: row.project == null ? null : String(row.project),
      state: String(row.state) as HqConversationState,
      stateWhy: row.state_why == null ? null : String(row.state_why),
      title: String(row.title),
      lastAt: Number(row.last_at),
      messages: Number(row.n)
    }))
}
