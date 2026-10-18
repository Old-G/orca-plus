// Custom build (hq-chats): the short counts beside HQ's pinned items — what waits for the user in a
// colour of its own, what is merely new since the item was last opened in grey.
import { useEffect, useMemo, useState } from 'react'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import {
  HQ_PINNED_SEEN_IDS,
  hqCountText,
  readHqPinnedCounts,
  type HqPinnedCounts
} from '../../../../../shared/hq-pinned-counts-wire'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import type { HqPinnedId } from './hq-messenger-selection'
import { useHqDeferredSessions } from './use-hq-deferred-sessions'

export type HqPinnedNote = { text: string; tone: 'needs' | 'new' }

// Why: reports are files and the paired web client hears no pulse writes; both are polled.
const POLL_MS = 60_000
const seenListeners = new Set<() => void>()

/** The pinned item just opened or left, so its «new» count starts over. */
export function markHqPinnedSeen(id: HqPinnedId): void {
  const seenId = HQ_PINNED_SEEN_IDS.find((entry) => entry === id)
  if (!seenId) {
    return
  }
  void window.api.runtime
    .call({ method: 'hqProjects.markPinnedSeen', params: { id: seenId } })
    .then(() => seenListeners.forEach((listener) => listener()))
    .catch((error: unknown) => console.warn('[hq] marking a pinned item seen failed:', error))
}

function useHqPinnedCounts(space: string | null): HqPinnedCounts | null {
  const [counts, setCounts] = useState<HqPinnedCounts | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      window.api.runtime
        .call({ method: 'hqProjects.pinnedCounts', params: { space } })
        .then((response) => {
          if (alive && response.ok) {
            setCounts(readHqPinnedCounts(response.result))
          }
        })
        .catch((error: unknown) => console.warn('[hq] pinned counts failed:', error))
    }
    load()
    seenListeners.add(load)
    const unsubscribe = isWebClientLocation() ? () => {} : window.api.pulseBell.onChanged(load)
    const poll = setInterval(load, POLL_MS)
    return () => {
      alive = false
      seenListeners.delete(load)
      unsubscribe()
      clearInterval(poll)
    }
  }, [space])
  return counts
}

export function hqPinnedNotes(
  counts: HqPinnedCounts | null,
  deferred: number
): Partial<Record<HqPinnedId, HqPinnedNote>> {
  const notes: Partial<Record<HqPinnedId, HqPinnedNote>> = {}
  const fresh = (count: number): string =>
    translate('auto.hq.pinned.new', '{{shown}} new', { shown: hqCountText(count) })
  if (counts && counts.today > 0) {
    notes.today = {
      text: translate('auto.hq.pinned.requests', '{{shown}} to decide', {
        shown: hqCountText(counts.today)
      }),
      tone: 'needs'
    }
  }
  if (counts && (counts.onYou > 0 || counts.remind > 0)) {
    const parts = [
      counts.onYou > 0
        ? translate('auto.hq.pinned.onYou', '{{count}} on you', { count: counts.onYou })
        : null,
      counts.remind > 0
        ? translate('auto.hq.pinned.remind', '{{count}} to remind', { count: counts.remind })
        : null
    ]
    notes.waiting = { text: parts.filter(Boolean).join(' · '), tone: 'needs' }
  }
  if (counts && counts.reports > 0) {
    notes.reports = { text: fresh(counts.reports), tone: 'needs' }
  }
  if (counts && counts.feed > 0) {
    notes.feed = { text: fresh(counts.feed), tone: 'new' }
  }
  if (counts && counts.journal > 0) {
    notes.journal = { text: fresh(counts.journal), tone: 'new' }
  }
  if (deferred > 0) {
    notes.agents = {
      text: translate('auto.hq.pinned.deferred', '{{count}} deferred', { count: deferred }),
      tone: 'needs'
    }
  }
  return notes
}

export function useHqPinnedNotes(
  cards: readonly DashboardCard[],
  space: string | null = null
): Partial<Record<HqPinnedId, HqPinnedNote>> {
  const counts = useHqPinnedCounts(space)
  const deferred = useHqDeferredSessions(cards).sessions.length
  return useMemo(() => hqPinnedNotes(counts, deferred), [counts, deferred])
}
