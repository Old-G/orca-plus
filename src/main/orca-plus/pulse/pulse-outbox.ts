// Custom build (hq-request-ledger): what went out through Approve and where. An approved message is
// the owner's message in its conversation; the waiting its chat records next takes the exact text,
// the draft, the decision and the place from it, so nobody retypes «what we asked» — also from a
// message no card held, which the call's own result put in the ledger (pulse-sent.ts).
import { hqPlaceKey } from '../../../shared/hq-ledger'
import type { OutgoingSentContext } from '../../../shared/outgoing-approval/outgoing-sent-context'
import type { PulseCore } from './pulse-core'
import { ingestLedgerSignal } from './pulse-ledger'

/** Why: a chat records its waiting right after the send; older sends belong to another question. */
export const HQ_OUTBOX_PAIR_MS = 30 * 60_000

export type HqWaitingExpects = 'approve' | 'merge' | 'access' | 'data' | 'answer'

/** What a waiting waits for, from its own words. No `\b`: it does not see Cyrillic word edges. */
export function hqWaitingExpects(title: string): HqWaitingExpects {
  const text = title.toLowerCase()
  if (/(approve|\u0430\u043f\u0440\u0443\u0432|\u043e\u0434\u043e\u0431\u0440)/.test(text)) {
    return 'approve'
  }
  if (
    /(merge|\u0432\u043b\u0438\u0442\u044c|\u0432\u043b\u0435\u0439|\u043c\u0435\u0440\u0436|\u0441\u043c\u0435\u0440\u0436)/.test(
      text
    )
  ) {
    return 'merge'
  }
  if (
    /(access|\u0434\u043e\u0441\u0442\u0443\u043f|\u043a\u043b\u044e\u0447|\u0442\u043e\u043a\u0435\u043d|token|key|\u043f\u0440\u0430\u0432\u0430)/.test(
      text
    )
  ) {
    return 'access'
  }
  if (
    /(\u0444\u0430\u0439\u043b|\u0432\u044b\u0433\u0440\u0443\u0437|\u0441\u043f\u0438\u0441\u043e\u043a|\u0434\u0430\u043d\u043d\u044b\u0435|data|file|export|csv)/.test(
      text
    )
  ) {
    return 'data'
  }
  return 'answer'
}

/** The conversation an approved message went to; null for a DM opened by user id or a host call. */
export function hqSentPlaceKey(context: OutgoingSentContext | null): string | null {
  if (!context?.targetId) {
    return null
  }
  if (/^[CDG][A-Z0-9]{6,}$/.test(context.targetId) && context.threadTs) {
    return `slack:${context.targetId}:${context.threadTs}`
  }
  return context.taskId ? `clickup:${context.taskId}` : hqPlaceKey(context.taskUrl)
}

/** After an approval: the sent text joins its conversation as the owner's message. */
export function recordSentInLedger(
  core: PulseCore,
  decision: { id: string; body: string | null; decidedAt: number; project: string | null },
  context: OutgoingSentContext | null
): void {
  const key = hqSentPlaceKey(context)
  if (!key || !decision.body) {
    return
  }
  ingestLedgerSignal(core, {
    key,
    ts: `sent:${decision.id}`,
    at: decision.decidedAt,
    author: null,
    authorId: null,
    fromOwner: true,
    text: decision.body,
    link: null,
    reader: 'approve',
    forOwner: false,
    project: decision.project,
    title: (context?.taskName ?? decision.body).slice(0, 120),
    // Custom build (hq-request-ledger): the sending chat holds it; the call's result replaces this row.
    sessionId: context?.agentSessionId ?? null,
    decisionId: decision.id
  })
}

type HqOutboxSend = {
  at: number
  decisionId: string | null
  draftId: string | null
  text: string | null
  place: string | null
  /** What the waiting may keep as its `source_ref`: a place it can be opened by. */
  ref: string | null
}

function str(value: unknown): string | null {
  return value == null ? null : String(value)
}

/** The ref a waiting keeps for a place: a Slack thread, a ClickUp comment (the form the ClickUp
 *  reply poller reads), or a link that names the same place. */
function placeRef(place: string, ts: string, link: string | null): string | null {
  if (place.startsWith('slack:')) {
    return place
  }
  const comment = /^comment:([0-9A-Za-z]+)$/.exec(ts)
  if (place.startsWith('clickup:') && comment) {
    return `${place}:${comment[1]}`
  }
  return link && hqPlaceKey(link) === place ? link : null
}

/** Custom build (hq-request-ledger): the chat's latest message in the ledger that no waiting took —
 *  one the call's result recorded (ungated sends too), or an approved one — at a place `fits`. */
function latestLedgerSend(
  core: PulseCore,
  sessionId: string,
  since: number,
  fits: (place: string | null) => boolean
): HqOutboxSend | null {
  const rows = core.db
    .prepare(
      `SELECT m.text, m.at, m.ts, m.link, m.decision_id, c.key, d.draft_id
         FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
         LEFT JOIN decisions d ON d.id = m.decision_id
        WHERE m.session_id = ? AND m.direction = 'out' AND m.at >= ?
          AND NOT EXISTS (SELECT 1 FROM waitings w
                           WHERE w.conversation_id = m.conversation_id AND w.sent_at = m.at)
          AND (m.decision_id IS NULL
               OR NOT EXISTS (SELECT 1 FROM waitings w WHERE w.decision_id = m.decision_id))
        ORDER BY m.at DESC`
    )
    .all(sessionId, since)
  const row = rows.find((candidate) => fits(String(candidate.key)))
  if (!row) {
    return null
  }
  const place = String(row.key)
  return {
    at: Number(row.at),
    decisionId: str(row.decision_id),
    draftId: str(row.draft_id),
    text: str(row.text),
    place,
    ref: placeRef(place, String(row.ts), str(row.link))
  }
}

/** The chat's latest approval that is not in the ledger as a message of its own. */
function latestApproval(
  core: PulseCore,
  sessionId: string,
  since: number,
  fits: (place: string | null) => boolean
): HqOutboxSend | null {
  const rows = core.db
    .prepare(
      `SELECT d.id, d.draft_id, d.body, d.decided_at, d.context FROM decisions d
        WHERE d.kind = 'approval' AND d.outcome IN ('approved', 'edited') AND d.decided_at >= ?
          AND NOT EXISTS (SELECT 1 FROM waitings w WHERE w.decision_id = d.id)
          AND NOT EXISTS (SELECT 1 FROM conversation_messages m WHERE m.decision_id = d.id)
        ORDER BY d.decided_at DESC`
    )
    .all(since)
  for (const row of rows) {
    let context: OutgoingSentContext | null = null
    try {
      context = row.context ? (JSON.parse(String(row.context)) as OutgoingSentContext) : null
    } catch {
      context = null
    }
    if (context?.agentSessionId !== sessionId) {
      continue
    }
    const place = hqSentPlaceKey(context)
    if (!fits(place)) {
      continue
    }
    return {
      at: Number(row.decided_at),
      decisionId: String(row.id),
      draftId: str(row.draft_id),
      text: str(row.body),
      place,
      ref: place && place.startsWith('slack:') ? place : null
    }
  }
  return null
}

/** Call inside the transaction that inserted the waiting: pairs it with its chat's latest send. */
export function pairWaitingWithSend(
  core: PulseCore,
  waiting: {
    id: string
    title: string
    direction?: 'on-me' | 'on-them'
    agentSessionId: string | null
    sourceRef: string | null
  },
  now: number
): void {
  core.db
    .prepare('UPDATE waitings SET expects = ? WHERE id = ?')
    .run(hqWaitingExpects(waiting.title), waiting.id)
  if (!waiting.agentSessionId) {
    return
  }
  const since = now - HQ_OUTBOX_PAIR_MS
  // Why: a waiting that names its own place (thread B) is not about the chat's send elsewhere (A).
  const own = hqPlaceKey(waiting.sourceRef)
  const fits = (place: string | null): boolean => !own || !place || place === own
  const recorded = latestLedgerSend(core, waiting.agentSessionId, since, fits)
  const approved = latestApproval(core, waiting.agentSessionId, since, fits)
  const send = recorded && (!approved || recorded.at >= approved.at) ? recorded : approved
  if (!send) {
    return
  }
  const conversation = send.place
    ? core.db.prepare('SELECT id FROM conversations WHERE key = ?').get(send.place)
    : undefined
  const conversationId = conversation ? String(conversation.id) : null
  core.db
    .prepare(
      `UPDATE waitings SET decision_id = ?, draft_id = ?, sent_text = ?, sent_at = ?,
         source_ref = COALESCE(source_ref, ?), conversation_id = COALESCE(conversation_id, ?)
       WHERE id = ?`
    )
    .run(send.decisionId, send.draftId, send.text, send.at, send.ref, conversationId, waiting.id)
  // Custom build (hq-request-ledger): asked there and waiting — the conversation is on them now.
  if (conversationId && waiting.direction !== 'on-me') {
    const moved = core.db
      .prepare(
        `UPDATE conversations SET state = 'wait', state_why = NULL
          WHERE id = ? AND state IN ('fyi', 'done')`
      )
      .run(conversationId).changes
    if (moved > 0) {
      core.emit('conversation.updated', 'conversation', conversationId, { state: 'wait' })
    }
  }
}
