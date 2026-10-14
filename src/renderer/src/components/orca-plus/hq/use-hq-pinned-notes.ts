// Custom build (hq-chats): the short counts beside HQ's pinned items — who waits on the user, and
// sessions left deferred.
import { useMemo } from 'react'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import { translate } from '@/i18n/i18n'
import type { HqPinnedId } from './hq-messenger-selection'
import { useHqDeferredSessions } from './use-hq-deferred-sessions'
import { useHqPulse } from './use-hq-pulse'

export function useHqPinnedNotes(
  cards: readonly DashboardCard[]
): Partial<Record<HqPinnedId, string>> {
  const pulse = useHqPulse()
  const deferred = useHqDeferredSessions(cards)
  const onMe =
    pulse.status === 'ready'
      ? pulse.pulse.waitings.filter((waiting) => waiting.direction === 'on-me').length
      : 0
  const deferredCount = deferred.sessions.length
  return useMemo(
    () => ({
      ...(onMe > 0
        ? { waiting: translate('auto.hq.pinned.onYou', '{{count}} on you', { count: onMe }) }
        : {}),
      ...(deferredCount > 0
        ? {
            agents: translate('auto.hq.pinned.deferred', '{{count}} deferred', {
              count: deferredCount
            })
          }
        : {})
    }),
    [onMe, deferredCount]
  )
}
