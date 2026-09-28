import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { refreshStrataStatuses } from '@/lib/strata-status-store'
import { isWebClientLocation } from '@/lib/web-client-location'

const REFRESH_INTERVAL_MS = 60_000

/**
 * Custom build (strata-status): keeps the sidebar's Strata badges current. A merge that adds the
 * wiki happens outside Orca's own events, so the status is re-read on focus and once a minute.
 */
export function useStrataStatusRefresh(): void {
  const repoIdsKey = useAppStore((s) => s.repos.map((repo) => repo.id).join('\n'))

  useEffect(() => {
    // Why: the paired web client has no Strata bridge; the desktop reads the project files.
    if (isWebClientLocation() || !repoIdsKey) {
      return
    }
    const repoIds = repoIdsKey.split('\n')
    const refresh = (): void => {
      void refreshStrataStatuses(repoIds).catch((error: unknown) => {
        console.warn('[strata] status refresh failed:', error)
      })
    }
    refresh()
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [repoIdsKey])
}
