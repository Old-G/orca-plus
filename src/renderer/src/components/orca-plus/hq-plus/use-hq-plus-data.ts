// Custom build (hq-plus-ui): what the HQ+ screen reads — the week's journal with its chats and the bell's
// decisions, the open waits and people, the dispatcher's view of the chats, the day's numbers and the
// automations still to run today — reloaded on every pulse write and on a timer.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HqSessionsResult } from '../../../../../shared/hq-sessions'
import { isHqChatLinksResult, type HqChatLinksResult } from '../../../../../shared/hq-chat-links'
import type { PulsePerson, PulseWaiting } from '../../../../../shared/pulse-types'
import {
  HQ_PLUS_FEED_WINDOW_MS,
  type HqFeedResult,
  type HqPlusScreenStats
} from '../../../../../shared/hq-plus-screen'
import { hqPlusDayStart } from '../../../../../shared/hq-plus-log'
import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import {
  isHqFeed,
  isHqScreenStats,
  isHqSessionsResult,
  isPulsePeople,
  isPulseWaitings,
  readUpcomingAutomations,
  type HqPlusUpcoming
} from '../../../../../shared/hq-plus-rpc-readers'

const RELOAD_MS = 20_000

export type HqPlusData = {
  feed: HqFeedResult | null
  waits: PulseWaiting[]
  people: PulsePerson[]
  sessions: HqSessionsResult | null
  stats: HqPlusScreenStats | null
  upcoming: HqPlusUpcoming[]
  /** Custom build (hq-plus-chat-tree): which chat started which, for «By work». */
  chatLinks: HqChatLinksResult | null
  error: string | null
  reload: () => void
}

/**
 * Custom build (hq-plus-feed-trim, owner 13.11): the same answer again sets nothing, so the screen does
 * not redraw a week of rows on every pulse write. `skip` names fields that change on every call.
 */
export function hqPlusSameAs(
  last: { current: Map<string, string> },
  key: string,
  value: unknown,
  skip?: string
): boolean {
  const text = JSON.stringify(
    value,
    skip ? (field, inner) => (field === skip ? undefined : inner) : undefined
  )
  if (last.current.get(key) === text) {
    return true
  }
  last.current.set(key, text)
  return false
}

async function call(method: string, params?: Record<string, unknown>): Promise<unknown> {
  const response = await window.api.runtime.call(params ? { method, params } : { method })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return response.result
}

export function useHqPlusData(): HqPlusData {
  const [feed, setFeed] = useState<HqFeedResult | null>(null)
  const [waits, setWaits] = useState<PulseWaiting[]>([])
  const [people, setPeople] = useState<PulsePerson[]>([])
  const [sessions, setSessions] = useState<HqSessionsResult | null>(null)
  const [stats, setStats] = useState<HqPlusScreenStats | null>(null)
  const [upcoming, setUpcoming] = useState<HqPlusUpcoming[]>([])
  const [chatLinks, setChatLinks] = useState<HqChatLinksResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const seen = useRef(new Map<string, string>())
  // Why: pulse writes come every few seconds and a read takes a while; overlapping reads only
  // queued behind each other, so one runs at a time and a request during it runs once after.
  const running = useRef(false)
  const again = useRef(false)
  const reloadRef = useRef<() => void>(() => {})

  const reload = useCallback(() => {
    if (running.current) {
      again.current = true
      return
    }
    running.current = true
    const now = Date.now()
    const since = now - HQ_PLUS_FEED_WINDOW_MS
    void Promise.allSettled([
      // Why: the feed draws no bell item raised and settled before the day began; those stay home.
      call('hq.feed', { since, settledSince: hqPlusDayStart(now) }),
      call('pulse.listWaitings', { status: 'open' }),
      call('pulse.listPeople'),
      call('hq.sessions'),
      call('hq.screenStats', {}),
      call('automation.list', {}),
      call('hq.chatLinks', {})
    ])
      .then(
        ([
          nextFeed,
          nextWaits,
          nextPeople,
          nextSessions,
          nextStats,
          nextAutomations,
          nextLinks
        ]) => {
          if (!alive.current) {
            return
          }
          const changed = (key: string, value: unknown, skip?: string): boolean =>
            !hqPlusSameAs(seen, key, value, skip)
          if (nextFeed.status === 'fulfilled') {
            if (changed('feed', nextFeed.value, 'now')) {
              setFeed(isHqFeed(nextFeed.value) ? nextFeed.value : null)
            }
            setError(null)
          } else {
            setError(
              String(nextFeed.reason instanceof Error ? nextFeed.reason.message : nextFeed.reason)
            )
          }
          if (nextWaits.status === 'fulfilled' && changed('waits', nextWaits.value)) {
            setWaits(isPulseWaitings(nextWaits.value) ? nextWaits.value : [])
          }
          if (nextPeople.status === 'fulfilled' && changed('people', nextPeople.value)) {
            setPeople(isPulsePeople(nextPeople.value) ? nextPeople.value : [])
          }
          if (nextSessions.status === 'fulfilled' && changed('sessions', nextSessions.value)) {
            setSessions(isHqSessionsResult(nextSessions.value) ? nextSessions.value : null)
          }
          if (
            nextStats.status === 'fulfilled' &&
            isHqScreenStats(nextStats.value) &&
            changed('stats', nextStats.value)
          ) {
            setStats(nextStats.value)
          }
          if (nextAutomations.status === 'fulfilled') {
            const upcomingNext = readUpcomingAutomations(nextAutomations.value, Date.now())
            if (changed('upcoming', upcomingNext)) {
              setUpcoming(upcomingNext)
            }
          }
          // Why: an older host has no links; the tree then lists every chat flat.
          if (
            nextLinks.status === 'fulfilled' &&
            isHqChatLinksResult(nextLinks.value) &&
            changed('chatLinks', nextLinks.value)
          ) {
            setChatLinks(nextLinks.value)
          }
        }
      )
      .finally(() => {
        running.current = false
        if (again.current && alive.current) {
          again.current = false
          reloadRef.current()
        }
      })
  }, [])
  reloadRef.current = reload

  useEffect(() => {
    alive.current = true
    reload()
    const timer = setInterval(reload, RELOAD_MS)
    // Why: the paired web client has no bell bridge; the timer alone keeps it fresh there.
    const unsubscribe = isWebClientLocation() ? () => {} : window.api.pulseBell.onChanged(reload)
    return () => {
      alive.current = false
      again.current = false
      clearInterval(timer)
      unsubscribe()
    }
  }, [reload])

  return { feed, waits, people, sessions, stats, upcoming, chatLinks, error, reload }
}

/** One runtime call from the screen's buttons; the error text is the method's own. */
export async function hqPlusCall(
  method: string,
  params: Record<string, unknown>
): Promise<{ ok: true; result: unknown } | { ok: false; message: string }> {
  try {
    return { ok: true, result: await call(method, params) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
