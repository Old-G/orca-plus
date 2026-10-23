// Custom build (hq-plus-ui-v4): the chips above HQ+'s feed — everything, only what waits on the owner,
// only the chats, only what came in (Slack / ClickUp / mail requests and reports). Background lines
// show in «All» only.
import type { HqPlusLogItem } from './hq-plus-log'
import { hqPlusLook, hqPlusNeedsOwner } from './hq-plus-kinds'

export const HQ_PLUS_FEED_FILTERS = ['all', 'move', 'chats', 'inbox'] as const
export type HqPlusFeedFilter = (typeof HQ_PLUS_FEED_FILTERS)[number]

export function hqPlusInFeedFilter(item: HqPlusLogItem, filter: HqPlusFeedFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'move':
      return hqPlusNeedsOwner(item)
    case 'chats': {
      const kind = hqPlusLook(item).kind
      return kind === 'chat' || kind === 'me'
    }
    case 'inbox': {
      const kind = hqPlusLook(item).kind
      return kind === 'inbox' || kind === 'report'
    }
  }
}

export function isHqPlusFeedFilter(value: unknown): value is HqPlusFeedFilter {
  return HQ_PLUS_FEED_FILTERS.some((filter) => filter === value)
}

/** Custom build (hq-plus-ui-v4): ⌘F over the feed — its words, project, thread and the person it names. */
export function hqPlusMatchesSearch(
  item: HqPlusLogItem,
  query: string,
  personName: (personId: string) => string | null
): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) {
    return false
  }
  const person =
    item.kind === 'card' && item.entry?.personId ? personName(item.entry.personId) : null
  const words =
    item.kind === 'me'
      ? [item.text]
      : item.kind === 'line'
        ? [item.title, item.body ?? '', ...(item.earlier ?? []).map((turn) => turn.title)]
        : [item.title, item.body ?? '', item.report?.ask ?? '']
  return [...words, item.project ?? '', item.address ?? '', person ?? ''].some((text) =>
    text.toLocaleLowerCase().includes(needle)
  )
}
