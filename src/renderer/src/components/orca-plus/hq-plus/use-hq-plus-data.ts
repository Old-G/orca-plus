// Custom build (hq-plus-ui): what the HQ+ screen reads — the week's journal with its chats and the bell's
// decisions, the open waits and people, the dispatcher's view of the chats, the day's numbers and the
// automations still to run today — reloaded on every pulse write and on a timer.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HqSessionsResult } from '../../../../../shared/hq-sessions'
import type { PulsePerson, PulseWaiting } from '../../../../../shared/pulse-types'
import {
  HQ_PLUS_FEED_WINDOW_MS,
  type HqFeedResult,
  type HqPlusScreenStats
} from '../../../../../shared/hq-plus-screen'
import { isWebClientLocation } from '@/lib/web-client-location'
import {
  isHqFeed,
  isHqScreenStats,
  isHqSessionsResult,
  isPulsePeople,
  isPulseWaitings,
  readUpcomingAutomations,
  type HqPlusUpcoming
} from './hq-plus-rpc-readers'

const RELOAD_MS = 20_000

export type HqPlusData = {
  feed: HqFeedResult | null
  waits: PulseWaiting[]
  people: PulsePerson[]
  sessions: HqSessionsResult | null
  stats: HqPlusScreenStats | null
  upcoming: HqPlusUpcoming[]
  error: string | null
  reload: () => void
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
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  const reload = useCallback(() => {
    const since = Date.now() - HQ_PLUS_FEED_WINDOW_MS
    void Promise.allSettled([
      call('hq.feed', { since }),
      call('pulse.listWaitings', { status: 'open' }),
      call('pulse.listPeople'),
      call('hq.sessions'),
      call('hq.screenStats', {}),
      call('automation.list', {})
    ]).then(([nextFeed, nextWaits, nextPeople, nextSessions, nextStats, nextAutomations]) => {
      if (!alive.current) {
        return
      }
      if (nextFeed.status === 'fulfilled') {
        setFeed(isHqFeed(nextFeed.value) ? nextFeed.value : null)
        setError(null)
      } else {
        setError(
          String(nextFeed.reason instanceof Error ? nextFeed.reason.message : nextFeed.reason)
        )
      }
      if (nextWaits.status === 'fulfilled') {
        setWaits(isPulseWaitings(nextWaits.value) ? nextWaits.value : [])
      }
      if (nextPeople.status === 'fulfilled') {
        setPeople(isPulsePeople(nextPeople.value) ? nextPeople.value : [])
      }
      if (nextSessions.status === 'fulfilled') {
        setSessions(isHqSessionsResult(nextSessions.value) ? nextSessions.value : null)
      }
      if (nextStats.status === 'fulfilled' && isHqScreenStats(nextStats.value)) {
        setStats(nextStats.value)
      }
      if (nextAutomations.status === 'fulfilled') {
        setUpcoming(readUpcomingAutomations(nextAutomations.value, Date.now()))
      }
    })
  }, [])

  useEffect(() => {
    alive.current = true
    reload()
    const timer = setInterval(reload, RELOAD_MS)
    // Why: the paired web client has no bell bridge; the timer alone keeps it fresh there.
    const unsubscribe = isWebClientLocation() ? () => {} : window.api.pulseBell.onChanged(reload)
    return () => {
      alive.current = false
      clearInterval(timer)
      unsubscribe()
    }
  }, [reload])

  return { feed, waits, people, sessions, stats, upcoming, error, reload }
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
