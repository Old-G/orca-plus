// Custom build (hq-plus-one-request): closes a talk's earlier requests once its newest is decided.
import {
  HQ_EARLIER_REQUEST_ACTION,
  hqEarlierRequestsToClose
} from '../../../shared/hq-earlier-requests'
import {
  HQ_SLACK_REQUEST_BELL_KIND,
  readHqSlackRequestRef
} from '../../../shared/hq-slack-request-bell'
import type { PulseInboxItem } from '../../../shared/pulse-types'

type Inbox = {
  pulseListInbox: (includeDone?: boolean, filter?: { kind?: string }) => PulseInboxItem[]
  pulseMarkInboxDone: (id: string, action?: string) => unknown
}

/** Writes the scout's decision on a request, keyed by its request id (not the bell item's). */
export type RecordHqEarlierRequestDecision = (requestId: string) => Promise<void>

export function closeHqEarlierRequests(
  inbox: Inbox,
  recordDecision?: RecordHqEarlierRequestDecision
): void {
  try {
    const all = inbox.pulseListInbox(true, { kind: HQ_SLACK_REQUEST_BELL_KIND })
    const byId = new Map(all.map((item) => [item.id, item]))
    for (const id of hqEarlierRequestsToClose(all)) {
      inbox.pulseMarkInboxDone(id, HQ_EARLIER_REQUEST_ACTION)
      // Why (Codex P2, 06.11): the bell alone leaves the scout's draft undecided, and classic HQ's
      // Today kept showing it as pending. Recorded once: a closed item is not picked again.
      const requestId = readHqSlackRequestRef(byId.get(id)?.refId ?? null)?.id
      if (requestId && recordDecision) {
        void recordDecision(requestId).catch((error: unknown) =>
          console.warn('[pulse-bell] recording an earlier request decision failed:', error)
        )
      }
    }
  } catch (error) {
    console.warn('[pulse-bell] closing earlier requests failed:', error)
  }
}
