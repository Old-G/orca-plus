// Custom build (outgoing-approval): the bell card for a held outgoing call.
import type { PulseBellInput } from '../pulse-bell'
import type { PulseDraft } from '../pulse-types'

export const OUTGOING_APPROVAL_BELL_KIND = 'outgoing-approval'

export const OUTGOING_APPROVAL_ACTION = {
  approve: 'approve',
  edit: 'edit',
  reject: 'reject'
} as const

function lastPathSegment(path: string | null | undefined): string | null {
  const segments = path?.split(/[\\/]/) ?? []
  return segments.findLast(Boolean) ?? null
}

/** Body holds the whole text: the owner approves what they read, so it is never clipped here. */
export function outgoingApprovalBellItem(draft: PulseDraft): PulseBellInput {
  const project = lastPathSegment(draft.call?.cwd)
  const head = [
    draft.title,
    draft.target ? `→ ${draft.target}` : null,
    project ? `· ${project}` : null
  ]
    .filter(Boolean)
    .join(' ')
  return {
    kind: OUTGOING_APPROVAL_BELL_KIND,
    title: 'Approve an outgoing action',
    body: `${head}\n${draft.body}`,
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
