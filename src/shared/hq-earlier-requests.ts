// Custom build (hq-plus-one-request): a person's several requests in one talk (comments in one ClickUp
// task, messages in one Slack thread) ask once. When the newest is decided — by any path: Done, a sent
// Reply, a finished To work, the scout dropping it — the earlier ones still open close with it.
import { hqPlaceKey } from './hq-ledger'
import { HQ_SLACK_REQUEST_BELL_KIND } from './hq-slack-request-bell'
import type { PulseInboxItem } from './pulse-types'

export const HQ_EARLIER_REQUEST_ACTION = 'with-newest'

function placeOf(item: PulseInboxItem): string | null {
  try {
    const parsed: unknown = item.refId ? JSON.parse(item.refId) : null
    const link: unknown =
      parsed && typeof parsed === 'object'
        ? (Reflect.get(parsed, 'link') ?? Reflect.get(parsed, 'permalink'))
        : null
    return typeof link === 'string' ? hqPlaceKey(link) : null
  } catch {
    return null
  }
}

/** Ids of open requests older than a decided newest request of the same place. */
export function hqEarlierRequestsToClose(items: readonly PulseInboxItem[]): string[] {
  const newest = new Map<string, PulseInboxItem>()
  const requests = items.flatMap((item) => {
    const place = item.kind === HQ_SLACK_REQUEST_BELL_KIND ? placeOf(item) : null
    return place ? [{ item, place }] : []
  })
  for (const { item, place } of requests) {
    const kept = newest.get(place)
    if (!kept || item.createdAt >= kept.createdAt) {
      newest.set(place, item)
    }
  }
  return requests.flatMap(({ item, place }) => {
    const top = newest.get(place)
    return top && top !== item && top.doneAt !== null && item.doneAt === null ? [item.id] : []
  })
}
