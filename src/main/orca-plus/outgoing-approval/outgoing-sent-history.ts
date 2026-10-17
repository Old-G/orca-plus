// Custom build (hq-sent-history): approvals decided before the history kept where a call went get
// it back from what is still stored — the held call itself and the approval card's first line.
import {
  OUTGOING_APPROVAL_BELL_KIND,
  type OutgoingApprovalContext
} from '../../../shared/outgoing-approval/outgoing-approval-bell'
import {
  outgoingSentContext,
  type OutgoingSentContext
} from '../../../shared/outgoing-approval/outgoing-sent-context'
import type { PulseDecision, PulseDraft, PulseInboxItem } from '../../../shared/pulse-types'

export type SentHistorySources = {
  getDraft: (id: string) => PulseDraft | null
  /** Approval cards, answered ones included, since the oldest decision asked for. */
  approvalCards: (since: number) => PulseInboxItem[]
}

// Why: a card is raised before its decision; a day covers any wait for the owner.
const CARD_LEAD_MS = 24 * 60 * 60_000

export function withLegacySentContext(
  decisions: readonly PulseDecision[],
  sources: SentHistorySources
): PulseDecision[] {
  const legacy = decisions.filter(
    (decision) => decision.kind === 'approval' && !decision.sentContext && decision.draftId
  )
  if (legacy.length === 0) {
    return [...decisions]
  }
  const since = Math.min(...legacy.map((decision) => decision.decidedAt)) - CARD_LEAD_MS
  const heads = new Map<string, string>()
  for (const card of sources.approvalCards(since)) {
    if (card.kind === OUTGOING_APPROVAL_BELL_KIND && card.refId && card.body) {
      heads.set(card.refId, card.body.split('\n', 1)[0] ?? '')
    }
  }
  return decisions.map((decision) => {
    if (!legacy.includes(decision) || !decision.draftId) {
      return decision
    }
    const draft = sources.getDraft(decision.draftId)
    return draft
      ? {
          ...decision,
          sentContext: outgoingSentContext(draft, {}, { head: heads.get(draft.id) || null })
        }
      : decision
  })
}

export type SentHistoryBackfill = SentHistorySources & {
  describe: (draft: PulseDraft) => Promise<OutgoingApprovalContext>
  workspaceOf: (agentSessionId: string) => string | null
  save: (decisionId: string, context: OutgoingSentContext) => void
}

/**
 * Names older approvals the way a card names a new call — a card from before naming showed a bare
 * channel id — and keeps what it found. Ones nothing could be named for are retried next time.
 */
export async function backfillLegacySentContext(
  decisions: readonly PulseDecision[],
  sources: SentHistoryBackfill
): Promise<number> {
  const restored = withLegacySentContext(decisions, sources)
  let saved = 0
  for (const [index, decision] of restored.entries()) {
    const context = decision.sentContext
    const draft = decision.draftId ? sources.getDraft(decision.draftId) : null
    if (decisions[index]?.sentContext || !context || !draft) {
      continue
    }
    const named = await sources.describe(draft).catch((): OutgoingApprovalContext => ({}))
    if (!named.targetName && !named.chatName) {
      continue
    }
    sources.save(decision.id, {
      ...context,
      targetName: named.targetName ?? null,
      replyingTo: named.replyingTo ?? null,
      chatName: named.chatName ?? null,
      worktreeId: context.agentSessionId ? sources.workspaceOf(context.agentSessionId) : null
    })
    saved += 1
  }
  return saved
}
