// Custom build (approval-toast): every held outgoing call pops bottom-right with its decision and
// stays until it is decided — here, in the bell, or anywhere else — because its agent waits on it.
import { toast } from 'sonner'
import { OUTGOING_APPROVAL_BELL_KIND } from '../../../../../shared/outgoing-approval/outgoing-approval-bell'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { OutgoingApprovalToast } from './OutgoingApprovalCard'

const toastId = (itemId: string): string => `outgoing-approval-toast-${itemId}`

/** Pops the held calls not shown yet and closes the ones decided since; `shown` is the caller's
 *  memory of what is up. Calls held at launch pop too: their agents are already waiting. */
export function syncOutgoingApprovalToasts(
  items: readonly PulseInboxItem[],
  shown: Set<string>
): void {
  const held = items.filter((item) => item.kind === OUTGOING_APPROVAL_BELL_KIND)
  const open = new Set(held.map((item) => item.id))
  for (const id of shown) {
    if (!open.has(id)) {
      toast.dismiss(toastId(id))
      shown.delete(id)
    }
  }
  for (const item of held) {
    if (shown.has(item.id)) {
      continue
    }
    shown.add(item.id)
    toast.custom(() => <OutgoingApprovalToast item={item} />, {
      id: toastId(item.id),
      duration: Number.POSITIVE_INFINITY,
      unstyled: true,
      // Why: sonner measures a toast while it sits scaled down in the stack and pins that height
      // when the stack opens on hover, so a tall card slid down past the window (owner, 18.10).
      className: 'data-[expanded=true]:h-auto!',
      dismissible: false,
      closeButton: false
    })
  }
}
