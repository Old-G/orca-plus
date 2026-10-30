// Custom build (hq-request-ledger): what went out through Approve and where. An approved message is
// the owner's message in its conversation; the waiting its chat records next takes the exact text,
// the draft, the decision and the place from it, so nobody retypes «what we asked».
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
    title: (context?.taskName ?? decision.body).slice(0, 120)
  })
}

/** Call inside the transaction that inserted the waiting: pairs it with its chat's latest send. */
export function pairWaitingWithSend(
  core: PulseCore,
  waiting: { id: string; title: string; agentSessionId: string | null; sourceRef: string | null },
  now: number
): void {
  core.db
    .prepare('UPDATE waitings SET expects = ? WHERE id = ?')
    .run(hqWaitingExpects(waiting.title), waiting.id)
  if (!waiting.agentSessionId) {
    return
  }
  const rows = core.db
    .prepare(
      `SELECT d.id, d.draft_id, d.body, d.decided_at, d.context FROM decisions d
        WHERE d.kind = 'approval' AND d.outcome IN ('approved', 'edited') AND d.decided_at >= ?
          AND NOT EXISTS (SELECT 1 FROM waitings w WHERE w.decision_id = d.id)
        ORDER BY d.decided_at DESC`
    )
    .all(now - HQ_OUTBOX_PAIR_MS)
  for (const row of rows) {
    let context: OutgoingSentContext | null = null
    try {
      context = row.context ? (JSON.parse(String(row.context)) as OutgoingSentContext) : null
    } catch {
      context = null
    }
    if (context?.agentSessionId !== waiting.agentSessionId) {
      continue
    }
    const place = hqSentPlaceKey(context)
    core.db
      .prepare(
        `UPDATE waitings SET decision_id = ?, draft_id = ?, sent_text = ?, sent_at = ?,
           source_ref = COALESCE(source_ref, ?) WHERE id = ?`
      )
      .run(
        String(row.id),
        row.draft_id == null ? null : String(row.draft_id),
        row.body == null ? null : String(row.body),
        Number(row.decided_at),
        place && place.startsWith('slack:') ? place : null,
        waiting.id
      )
    return
  }
}
