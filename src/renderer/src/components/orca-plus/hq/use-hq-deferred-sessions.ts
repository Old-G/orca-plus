// Custom build (hq): the live deferred-session list — quiet agents judged against their workspace's
// git state, interrupts, limit stops and waiting handoffs, minus the spells the user closed.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import type { HqWorktreeGitState } from '../../../../../shared/hq-project-pages'
import { useNow } from '@/hooks/use-now'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useAppStore } from '@/store'
import {
  HQ_DEFERRED_DEFAULT_MINUTES,
  buildHqDeferredSessions,
  hqDeferredCandidates,
  pruneHqDeferredDismissed,
  type HqDeferredSession
} from './hq-deferred-sessions'

const TICK_MS = 60_000
const NO_DISMISSED: Readonly<Record<string, number>> = {}

type LimitStop = { paneKey: string | null; worktreeId: string }
type Handoff = { id: string; worktreeId: string }

function useLimitStops(): LimitStop[] {
  const [stops, setStops] = useState<LimitStop[]>([])
  useEffect(() => {
    if (isWebClientLocation()) {
      return
    }
    const apply = (
      list: { kind: 'terminal' | 'native-chat'; key: string; worktreeId: string | null }[]
    ): void =>
      setStops(
        list.flatMap((stop) =>
          stop.worktreeId
            ? [{ paneKey: stop.kind === 'terminal' ? stop.key : null, worktreeId: stop.worktreeId }]
            : []
        )
      )
    void window.api.claudeLimitGuard.list().then(apply, () => undefined)
    return window.api.claudeLimitGuard.onStopsChanged(apply)
  }, [])
  return stops
}

function useHandoffs(): Handoff[] {
  const [handoffs, setHandoffs] = useState<Handoff[]>([])
  useEffect(() => {
    if (isWebClientLocation()) {
      return
    }
    const apply = (offers: { id: string; worktreeId: string }[]): void =>
      setHandoffs(offers.map((offer) => ({ id: offer.id, worktreeId: offer.worktreeId })))
    void window.api.claudeHandoff.list().then(apply, () => undefined)
    return window.api.claudeHandoff.onOffersChanged(apply)
  }, [])
  return handoffs
}

/** Local checkouts only: a remote workspace's git state is not read from here. */
function useLocalWorktreePaths(): Map<string, string> {
  const repos = useAppStore((s) => s.repos)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  return useMemo(() => {
    const paths = new Map<string, string>()
    for (const repo of repos) {
      const remote =
        Boolean(repo.connectionId) ||
        Boolean(repo.executionHostId && repo.executionHostId !== 'local')
      if (remote) {
        continue
      }
      for (const worktree of worktreesByRepo[repo.id] ?? []) {
        paths.set(worktree.id, worktree.path)
      }
    }
    return paths
  }, [repos, worktreesByRepo])
}

function useGitStates(
  candidates: readonly DashboardCard[],
  paths: Map<string, string>,
  now: number
): Record<string, HqWorktreeGitState | null> {
  const [states, setStates] = useState<Record<string, HqWorktreeGitState | null>>({})
  const wanted = useMemo(() => {
    const byPath = new Map<string, string>()
    for (const card of candidates) {
      const path = paths.get(card.worktreeId)
      if (path) {
        byPath.set(path, card.worktreeId)
      }
    }
    return byPath
  }, [candidates, paths])
  const key = [...wanted.keys()].sort().join('\n')
  // Why: re-read every five minutes; main caches each path for one.
  const period = Math.floor(now / (5 * TICK_MS))
  useEffect(() => {
    if (!key || isWebClientLocation()) {
      return
    }
    let alive = true
    const byPath = new Map(wanted)
    window.api.hqProjects
      .gitState([...byPath.keys()])
      .then((result) => {
        if (alive) {
          setStates(
            Object.fromEntries(
              [...byPath].map(([path, worktreeId]) => [worktreeId, result[path] ?? null])
            )
          )
        }
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` and `period` stand for `wanted` and the clock.
  }, [key, period])
  return states
}

export function useHqDeferredSessions(cards: readonly DashboardCard[]): {
  sessions: HqDeferredSession[]
  close: (session: HqDeferredSession) => void
} {
  const now = useNow(TICK_MS)
  const threshold = useAppStore(
    (s) => s.settings?.hqDeferredAfterMinutes ?? HQ_DEFERRED_DEFAULT_MINUTES
  )
  const dismissed = useAppStore((s) => s.settings?.hqDeferredDismissed ?? NO_DISMISSED)
  const statuses = useAppStore((s) => s.agentStatusByPaneKey)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const interrupted = useMemo(
    () =>
      new Set(
        Object.entries(statuses).flatMap(([paneKey, entry]) =>
          entry?.interrupted ? [paneKey] : []
        )
      ),
    [statuses]
  )
  const limitStops = useLimitStops()
  const handoffs = useHandoffs()
  const paths = useLocalWorktreePaths()
  const candidates = useMemo(
    () => hqDeferredCandidates(cards, now, threshold),
    [cards, now, threshold]
  )
  const gitStates = useGitStates(candidates, paths, now)
  const sessions = useMemo(
    () =>
      buildHqDeferredSessions({
        cards,
        now,
        thresholdMinutes: threshold,
        gitStates,
        interruptedPaneKeys: interrupted,
        limitStops,
        handoffs,
        dismissed
      }),
    [cards, now, threshold, gitStates, interrupted, limitStops, handoffs, dismissed]
  )
  const close = useCallback(
    (session: HqDeferredSession) => {
      void updateSettings({
        hqDeferredDismissed: {
          ...pruneHqDeferredDismissed(dismissed, cards),
          [session.card.paneKey]: session.silentSince
        }
      })
    },
    [cards, dismissed, updateSettings]
  )
  return { sessions, close }
}
