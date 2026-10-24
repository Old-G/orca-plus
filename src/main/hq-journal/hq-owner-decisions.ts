// Custom build (hq-plus-ladder): the owner's decisions as `owner.decision` journal rows — each an
// Approve answer or a button he pressed on a bell card — with the kind of action and what he chose,
// so the trust ladder can count, per kind, how often the offer was taken as it was.
import type { HqJournalInput } from '../../shared/hq-journal'
import {
  HQ_OWNER_DECISION_KIND,
  hqApprovalKind,
  hqOwnerDecisionSource,
  type HqLadderOutcome
} from '../../shared/hq-ladder'
import type { PulseDecision, PulseInboxItem } from '../../shared/pulse-types'
import type { HqJournalPlacer } from './hq-journal-adapters'
import { hqJournalPlacement, hqJournalRoom } from './hq-journal-adapters'

const APPROVAL_OUTCOME: Record<NonNullable<PulseDecision['outcome']>, HqLadderOutcome> = {
  approved: 'accepted',
  edited: 'edited',
  rejected: 'rejected'
}

// Why: these close by themselves (synced away, replaced, read) — the owner decided nothing.
const NOT_A_DECISION = new Set(['gone', 'open', 'replaced', 'superseded', 'seen'])
// Why: an agent finishing and Approve cards are counted elsewhere (Approve through its decisions).
const NOT_COUNTED_KINDS = new Set(['agent-finished', 'outgoing-approval'])
const REFUSED = /^(?:skip|skipped|dismiss|reject|rejected|not-now|not-needed|drop|dropped|cancel)$/
const LATER = /^(?:later|snooze|snoozed)$/

function decided(
  base: HqJournalInput,
  kind: string,
  outcome: HqLadderOutcome,
  ref: string
): HqJournalInput {
  return {
    ...base,
    kind: HQ_OWNER_DECISION_KIND,
    title: `${kind} · ${outcome}: ${base.title}`.slice(0, 300),
    needs: 'nobody',
    status: 'done',
    replyTo: null,
    source: hqOwnerDecisionSource(kind, outcome),
    dedupeKey: `${HQ_OWNER_DECISION_KIND}:${ref}`
  }
}

/** An Approve answer, placed where its approve.result row is. */
export function approvalOwnerDecision(
  decision: PulseDecision,
  result: HqJournalInput
): HqJournalInput | null {
  if (decision.kind !== 'approval' || decision.outcome === null) {
    return null
  }
  return decided(
    { ...result, title: decision.title },
    hqApprovalKind(decision.title),
    APPROVAL_OUTCOME[decision.outcome],
    `decision:${decision.id}`
  )
}

/** A button the owner pressed on a bell card; null for a card that closed by itself. */
export function bellOwnerDecision(
  item: PulseInboxItem,
  place: HqJournalPlacer
): HqJournalInput | null {
  const action = item.doneAction
  if (
    item.doneAt === null ||
    !action ||
    NOT_A_DECISION.has(action) ||
    NOT_COUNTED_KINDS.has(item.kind)
  ) {
    return null
  }
  const outcome: HqLadderOutcome = REFUSED.test(action)
    ? 'rejected'
    : LATER.test(action)
      ? 'deferred'
      : 'accepted'
  const where = place({})
  return decided(
    {
      workspace: hqJournalRoom(where),
      placement: hqJournalPlacement(where),
      kind: HQ_OWNER_DECISION_KIND,
      at: item.doneAt,
      project: where.project,
      address: null,
      sessionId: null,
      personId: null,
      title: `${item.title} → ${action}`,
      body: null,
      needs: 'nobody',
      status: 'done',
      replyTo: null,
      refKind: 'inbox',
      refId: item.id,
      source: 'pulse-bell',
      dedupeKey: null
    },
    `bell:${item.kind}`,
    outcome,
    `inbox:${item.id}`
  )
}
