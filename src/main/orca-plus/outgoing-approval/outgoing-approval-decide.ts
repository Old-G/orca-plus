// Custom build (outgoing-footer, outgoing-venue): the owner's answer to a held call as the card gave
// it — with or without the footer, into a thread, or moved to the task or to Slack — turned into the
// gate's decision and the history's record.
import type { OutgoingApprovalContext } from '../../../shared/outgoing-approval/outgoing-approval-bell'
import type {
  OutgoingApprovalChoice,
  OutgoingApprovalOptions
} from '../../../shared/outgoing-approval/outgoing-approval-options'
import { outgoingFooterFor } from '../../../shared/outgoing-approval/outgoing-footer'
import { parseClickUpTaskReference } from '../../../shared/clickup-task-reference'
import { outgoingSentContext } from '../../../shared/outgoing-approval/outgoing-sent-context'
import {
  outgoingMove,
  outgoingMoveReason,
  outgoingThreadChoices
} from '../../../shared/outgoing-approval/outgoing-venue'
import type {
  PulseApprovalOutcome,
  PulseDecision,
  PulseDraft,
  PulseWaiting
} from '../../../shared/pulse-types'
import type { OutgoingApprovalGate } from './outgoing-approval-gate'
import type { MovedApprovals } from './outgoing-moved-approvals'

const RECENT_DECISIONS = 200

export type OutgoingDecideDeps = {
  gate: OutgoingApprovalGate
  context: (draftId: string) => OutgoingApprovalContext | undefined
  workspaceOf: (agentSessionId: string) => string | null
  moved: MovedApprovals
  decisions: (limit: number) => PulseDecision[]
  waitings: () => PulseWaiting[]
  now?: () => number
}

export function outgoingApprovalOptions(
  draft: PulseDraft,
  context: OutgoingApprovalContext,
  deps: Pick<OutgoingDecideDeps, 'decisions' | 'waitings' | 'now'>
): OutgoingApprovalOptions {
  return {
    footer: outgoingFooterFor(draft, context),
    move: outgoingMove(draft, context.task ?? null),
    threads: outgoingThreadChoices(
      draft,
      deps.decisions(RECENT_DECISIONS),
      deps.waitings(),
      (deps.now ?? Date.now)()
    )
  }
}

/** Custom build (hq-plus-ui): «Tell agent» on a held message — not sent, the owner's words instead. */
export function outgoingNoteReason(note: string): string {
  return [
    'The user has not sent this yet. They tell you:',
    '"""',
    note,
    '"""',
    'Change the message as they ask and send it again; it will be held for their approval again.'
  ].join('\n')
}

/** Returns the draft as decided and the outcome the gate recorded. */
export function decideOutgoingCall(
  deps: OutgoingDecideDeps,
  id: string,
  outcome: PulseApprovalOutcome,
  editedText: string | undefined,
  choice: OutgoingApprovalChoice
): { decided: PulseDraft; outcome: PulseApprovalOutcome } {
  const draft = deps.gate.pending().find((held) => held.id === id)
  const context = deps.context(id)
  const move =
    choice.moveTo && draft && outcome !== 'rejected'
      ? outgoingMove(draft, context?.task ?? null)
      : null
  if (choice.moveTo && move?.to !== choice.moveTo) {
    throw new Error(`outgoing-approval: ${id} cannot be moved to ${choice.moveTo}`)
  }
  const recorded: PulseApprovalOutcome = move ? 'rejected' : outcome
  // Why: the footer goes unless the owner unticked it; a moved message gets it where it lands.
  const footer =
    draft && !move && recorded !== 'rejected' && choice.footer !== false
      ? outgoingFooterFor(draft, context)
      : null
  const threadTs = move || recorded === 'rejected' ? null : (choice.threadTs ?? null)
  const movedText = move && draft ? (editedText?.trim() ? editedText : draft.body) : null
  const decided = deps.gate.decide(
    id,
    recorded,
    recorded === 'edited' ? editedText : undefined,
    (held) =>
      outgoingSentContext(held, context, {
        worktreeId: held.call?.agentSessionId ? deps.workspaceOf(held.call.agentSessionId) : null,
        footer,
        threadTs,
        movedTo: move?.to ?? null
      }),
    {
      footer,
      threadTs,
      denyReason:
        move && movedText !== null
          ? outgoingMoveReason(move, movedText)
          : recorded === 'rejected' && choice.note
            ? outgoingNoteReason(choice.note)
            : null
    }
  )
  const agentSessionId = draft?.call?.agentSessionId
  if (move && movedText !== null && agentSessionId) {
    const taskUrl = move.task?.url ?? null
    // Why: a comment may name the task by its custom id or by the id its link carries.
    const linkedId = taskUrl ? parseClickUpTaskReference(taskUrl)?.id : null
    deps.moved.add({
      agentSessionId,
      to: move.to,
      text: movedText,
      footer: choice.footer !== false,
      taskIds: move.to === 'clickup' ? [move.task.id, ...(linkedId ? [linkedId] : [])] : [],
      allowed:
        move.to === 'clickup'
          ? { mentions: true, links: [] }
          : { mentions: false, links: taskUrl ? [taskUrl] : [] }
    })
  }
  return { decided, outcome: recorded }
}
