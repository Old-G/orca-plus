// Custom build (hq-plus-ui-v4): the chips above HQ+'s feed (All · Your move · Chats · Inbox, kept per
// viewer) and the pinned «Your move · N ▸» line that walks through the owner's open cards one by one.
import { useRef } from 'react'
import { translate } from '@/i18n/i18n'
import {
  HQ_PLUS_FEED_FILTERS,
  isHqPlusFeedFilter,
  type HqPlusFeedFilter
} from '../../../../../shared/hq-plus-feed-filter'

const FILTER_KEY = 'orca-plus.hq-plus-feed-filter'

export function readHqPlusFeedFilter(): HqPlusFeedFilter {
  try {
    const stored = localStorage.getItem(FILTER_KEY)
    return isHqPlusFeedFilter(stored) ? stored : 'all'
  } catch {
    return 'all'
  }
}

export function saveHqPlusFeedFilter(filter: HqPlusFeedFilter): void {
  try {
    localStorage.setItem(FILTER_KEY, filter)
  } catch {
    // Why: a window without storage keeps the choice until it closes.
  }
}

function filterLabel(filter: HqPlusFeedFilter, moves: number): string {
  switch (filter) {
    case 'all':
      return translate('auto.hqPlus.filter.all', 'All')
    case 'move':
      return translate('auto.hqPlus.filter.move', 'Your move ({{count}})', { count: moves })
    case 'chats':
      return translate('auto.hqPlus.filter.chats', 'Chats')
    case 'inbox':
      return translate('auto.hqPlus.filter.inbox', 'Inbox')
  }
}

export function HqPlusFeedChips({
  filter,
  moves,
  onFilter
}: {
  filter: HqPlusFeedFilter
  moves: number
  onFilter: (filter: HqPlusFeedFilter) => void
}): React.JSX.Element {
  return (
    <div
      className="hqp-chips"
      role="group"
      aria-label={translate('auto.hqPlus.filter.label', 'Show in the feed')}
    >
      {HQ_PLUS_FEED_FILTERS.map((name) => (
        <button
          key={name}
          type="button"
          className="hqp-chip-btn"
          aria-pressed={filter === name}
          onClick={() => onFilter(name)}
        >
          {filterLabel(name, moves)}
        </button>
      ))}
    </div>
  )
}

/** Each click goes to the next open card that waits on the owner, from the oldest, and round again. */
export function HqPlusYourMoveLine({
  ids,
  onGo
}: {
  ids: readonly string[]
  onGo: (id: string) => void
}): React.JSX.Element | null {
  const next = useRef(0)
  if (ids.length === 0) {
    return null
  }
  return (
    <button
      type="button"
      className="hqp-ymove"
      onClick={() => {
        const at = next.current % ids.length
        next.current = at + 1
        onGo(ids[at])
      }}
    >
      {translate('auto.hqPlus.yourMove', 'Your move · {{count}}', { count: ids.length })}
      <span aria-hidden="true"> ▸</span>
    </button>
  )
}

/** What came while the owner was away; each click goes to the first one not yet seen. */
export function HqPlusSinceLine({
  ids,
  onGo
}: {
  ids: readonly string[]
  onGo: (id: string) => void
}): React.JSX.Element | null {
  if (ids.length === 0) {
    return null
  }
  return (
    <button type="button" className="hqp-ymove" data-kind="new" onClick={() => onGo(ids[0])}>
      {translate('auto.hqPlus.sinceLeft', 'Since you left: {{count}} new', { count: ids.length })}
      <span aria-hidden="true"> ▸</span>
    </button>
  )
}
