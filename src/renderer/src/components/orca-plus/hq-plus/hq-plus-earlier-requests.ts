// Custom build (hq-plus-one-request): a person's earlier requests in one talk wait on the newest; once
// it is decided (Done, a sent Reply, a finished To work) they close too, never before — a cancelled
// pick or a failed send closes nothing.
import { useEffect } from 'react'
import { HQ_SLACK_REQUEST_BELL_KIND } from '../../../../../shared/hq-slack-request-bell'
import type { HqPlusConversation } from '../../../../../shared/hq-plus-conversations'

export async function closeEarlierRequests(ids: readonly string[]): Promise<void> {
  const bell = window.api.pulseBell
  if (!bell || ids.length === 0) {
    return
  }
  await Promise.all(ids.map((id) => bell.markDone(id, 'done').catch(() => undefined)))
}

/** The earlier ids to close now: some, and no request of the talk is still open. */
export function earlierRequestsToClose(conversation: HqPlusConversation | null): string[] {
  const earlier = conversation?.earlierRequests ?? []
  const asking = conversation?.parts.some((part) => part.inbox?.kind === HQ_SLACK_REQUEST_BELL_KIND)
  return asking ? [] : earlier
}

export function useCloseEarlierRequests(
  conversation: HqPlusConversation | null,
  onChanged: () => void
): void {
  const settled = earlierRequestsToClose(conversation).join(',')
  useEffect(() => {
    if (settled) {
      void closeEarlierRequests(settled.split(',')).then(onChanged)
    }
    // Why: onChanged is new on every render; the ids are what matter.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [settled])
}
