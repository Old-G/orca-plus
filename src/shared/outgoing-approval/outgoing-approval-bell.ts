// Custom build (outgoing-approval): the bell card for a held outgoing call.
import type { PulseBellInput } from '../pulse-bell'
import type { PulseDraft } from '../pulse-types'
import { readInputString } from './outgoing-action'
import type { OutgoingTaskRef } from './outgoing-footer'

export const OUTGOING_APPROVAL_BELL_KIND = 'outgoing-approval'

export const OUTGOING_APPROVAL_ACTION = {
  approve: 'approve',
  edit: 'edit',
  reject: 'reject'
} as const

/** Custom build (outgoing-approval-target): who the call reaches and where it comes from, named for
 *  the owner; the raw target stands in for what could not be named. */
export type OutgoingApprovalContext = {
  /** `#channel`, `DM with Name`, … */
  targetName?: string | null
  /** In a thread: who said what the call answers, when known. */
  replyingTo?: string | null
  /** The agent chat that wants to send it. */
  chatName?: string | null
  /** Custom build (outgoing-footer): the ClickUp task the message is about, when one is known. */
  task?: OutgoingTaskRef | null
}

export function lastPathSegment(path: string | null | undefined): string | null {
  const segments = path?.split(/[\\/]/) ?? []
  return segments.findLast(Boolean) ?? null
}

function fromLabel(chatName: string | null, project: string | null): string | null {
  if (chatName) {
    return project ? `from «${chatName}» (${project})` : `from «${chatName}»`
  }
  return project ? `from ${project}` : null
}

/** Custom build (hq-spaces): the project a card's first line names — its workspace's stripe. */
export function outgoingApprovalHeadProject(head: string): string | null {
  const from = head.split(' · ').at(-1) ?? ''
  const match = /^from (?:«.*» \((.+)\)|([^«\s][^\s]*))$/.exec(from)
  return match ? (match[1] ?? match[2] ?? null) : null
}

/** Custom build (hq-spaces): where the card's call goes — `slack`, `clickup`… — from its first word. */
export function outgoingApprovalHeadChannel(head: string): string | null {
  return /^([A-Za-z][\w-]*) ·/.exec(head)?.[1]?.toLowerCase() ?? null
}

/** The card's first line: what, to whom, in which thread, from which chat. */
export function outgoingApprovalHead(
  draft: PulseDraft,
  context: OutgoingApprovalContext = {}
): string {
  const target = context.targetName ?? draft.target
  const inThread = readInputString(draft.call?.toolInput, 'thread_ts')
  const thread = inThread
    ? context.replyingTo
      ? `in a thread, replying to ${context.replyingTo}`
      : 'in a thread'
    : null
  return [
    [draft.title, target ? `→ ${target}` : null].filter(Boolean).join(' '),
    thread,
    fromLabel(context.chatName ?? null, lastPathSegment(draft.call?.cwd))
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Body holds the whole text: the owner approves what they read, so it is never clipped here. */
export function outgoingApprovalBellItem(
  draft: PulseDraft,
  context?: OutgoingApprovalContext
): PulseBellInput {
  return {
    kind: OUTGOING_APPROVAL_BELL_KIND,
    title: 'Approve an outgoing action',
    body: `${outgoingApprovalHead(draft, context)}\n${draft.body}`,
    urgency: 'urgent',
    refKind: 'draft',
    refId: draft.id,
    actions: [
      { id: OUTGOING_APPROVAL_ACTION.approve, label: 'Approve' },
      ...(draft.call?.editField ? [{ id: OUTGOING_APPROVAL_ACTION.edit, label: 'Edit' }] : []),
      { id: OUTGOING_APPROVAL_ACTION.reject, label: 'Reject' }
    ],
    dedupeKey: `${OUTGOING_APPROVAL_BELL_KIND}:${draft.id}`
  }
}
