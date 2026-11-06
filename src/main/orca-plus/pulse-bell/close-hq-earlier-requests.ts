// Custom build (hq-plus-one-request): closes a talk's earlier requests once its newest is decided.
import {
  HQ_EARLIER_REQUEST_ACTION,
  hqEarlierRequestsToClose
} from '../../../shared/hq-earlier-requests'
import { HQ_SLACK_REQUEST_BELL_KIND } from '../../../shared/hq-slack-request-bell'
import type { PulseInboxItem } from '../../../shared/pulse-types'

type Inbox = {
  pulseListInbox: (includeDone?: boolean, filter?: { kind?: string }) => PulseInboxItem[]
  pulseMarkInboxDone: (id: string, action?: string) => unknown
}

export function closeHqEarlierRequests(inbox: Inbox): void {
  try {
    const all = inbox.pulseListInbox(true, { kind: HQ_SLACK_REQUEST_BELL_KIND })
    for (const id of hqEarlierRequestsToClose(all)) {
      inbox.pulseMarkInboxDone(id, HQ_EARLIER_REQUEST_ACTION)
    }
  } catch (error) {
    console.warn('[pulse-bell] closing earlier requests failed:', error)
  }
}
