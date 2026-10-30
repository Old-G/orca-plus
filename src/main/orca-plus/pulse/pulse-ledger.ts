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
import { ledgerRuleOf } from './pulse-ledger-feed'

/** Why: an answer by DM to a question older than two weeks is rarely to that question. */
export const HQ_LEDGER_PERSON_WINDOW_MS = 14 * 24 * 60 * 60_000
/** Why: top-level DM lines have no thread; a day of them is one talk. */
export const HQ_LEDGER_DM_TALK_MS = 24 * 60 * 60_000

const DM_KEY = /^slack:(D[A-Z0-9]+):/
const TASK_LINK = /app\.clickup\.com\/t\/(?:\d+\/)?([\w-]+)|merge_requests\/(\d+)/g

/** Tasks and MRs a text links to, e.g. `DEV-18421`, `!314`; a bare mention is not a link. */
function linkedIn(text: string): Set<string> {
  return new Set(
    [...text.matchAll(TASK_LINK)].map((match) => (match[1] ? match[1] : `!${match[2]}`))
  )
}

/** Why: a DM that names another task (30.10, «it is over here: DEV-18421») links to is about that task, not
 *  the one open question to its author. */
function aboutOtherTask(signal: HqLedgerSignal, waiting: OpenWaiting): boolean {
  const linked = linkedIn(signal.text)
  if (linked.size === 0) {
    return false
  }
  const own = `${waiting.title} ${waiting.key ?? ''}`
  return ![...linked].some((ref) => own.includes(ref))
}

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
      // Why ask: a link to another task was right once and wrong once in the 30.10 check — the
      // owner tells which, the ledger does not guess.
      if (candidates.length === 1 && !aboutOtherTask(signal, candidates[0])) {
        step = 'person'
        conversationId = conversationOfWaiting(core, candidates[0], signal)
      } else if (candidates.length > 0) {
        step = 'which'
      }
    }
    if (!conversationId) {
      const replied = atPlace.find((waiting) => waiting.project)?.project ?? null
      // Custom build (hq-ledger-feed): the channel's rule the owner set in HQ+, after the reader's own.
      const ruled = signal.project ?? (replied ? null : ledgerRuleOf(core, signal.key))
      conversationId = createConversation(
        core,
        signal.key,
        signal,
        ruled ?? replied,
        ruled ? 'rule' : replied ? 'reply' : null
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
  sessionId: string | null
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
      messages: Number(row.n),
      sessionId: row.session_id == null ? null : String(row.session_id)
    }))
}

/** The chat a conversation was taken into; later messages of its thread belong with it. */
export function setConversationChat(core: PulseCore, key: string, sessionId: string): void {
  core.db.prepare('UPDATE conversations SET session_id = ? WHERE key = ?').run(sessionId, key)
}

/** Custom build (hq-request-ledger): who wrote last in a conversation — someone writing after the
 *  owner in his thread is answering him. Null when the conversation is new. */
export function lastLedgerDirection(core: PulseCore, key: string): 'in' | 'out' | null {
  const row = core.db
    .prepare(
      `SELECT m.direction FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.key = ? ORDER BY m.at DESC LIMIT 1`
    )
    .get(key)
  return row ? (row.direction === 'out' ? 'out' : 'in') : null
}

export type HqLedgerGuess = {
  project: string | null
  /** `named` — a link or the slug in the text; `model` — the small model's pick. */
  how: 'named' | 'model'
  state: 'you' | 'fyi'
  gist: string | null
}

/** The small model's read of a new conversation: its project (marked as a guess), whose move, its
 *  gist as the title (the sender's own words stay in its messages). A known project stays; the model
 *  may only raise «for information» to «your move» — never hide what a rule said waits on the owner,
 *  since the text it reads is written by others. Custom build (hq-ledger-feed): nor once the owner
 *  answered after the message it read — a guess comes after the pass that may have read his reply. */
export function setLedgerGuess(
  core: PulseCore,
  conversationId: string,
  guess: HqLedgerGuess
): void {
  core.db
    .prepare(
      `UPDATE conversations SET
         project_how = CASE WHEN project IS NULL AND ? IS NOT NULL THEN ? ELSE project_how END,
         project = COALESCE(project, ?),
         title = COALESCE(?, title),
         state = CASE WHEN state = 'fyi' AND ? = 'you' AND (
             SELECT direction FROM conversation_messages m WHERE m.conversation_id = conversations.id
              ORDER BY m.at DESC, m.ts DESC LIMIT 1) = 'in'
           THEN 'you' ELSE state END
       WHERE id = ?`
    )
    .run(guess.project, guess.how, guess.project, guess.gist, guess.state, conversationId)
  core.emit('conversation.updated', 'conversation', conversationId, { guess: true })
}

/** Whether a Slack message is in the ledger: as its thread's conversation or as a message of a
 *  conversation in that channel (a DM line joins the day's talk). */
export function ledgerHasSlackMessage(core: PulseCore, channel: string, ts: string): boolean {
  return (
    core.db
      .prepare(
        `SELECT 1 FROM conversations WHERE key = ?
         UNION ALL
         SELECT 1 FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.key LIKE ? AND m.ts = ? LIMIT 1`
      )
      .get(`slack:${channel}:${ts}`, `slack:${channel}:%`, ts) !== undefined
  )
}
