// Custom build (hq): HQ's project pages, read again whenever the HQ folder setting changes.
import { useEffect, useState } from 'react'
import type { HqProjectPage } from '../../../../../shared/hq-project-pages'
import { useAppStore } from '@/store'
import { isWebClientLocation } from '@/lib/web-client-location'

export type HqProjectPagesState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; pages: HqProjectPage[] }
  | { status: 'error'; message: string }

type Loaded = { hqPath: string; state: HqProjectPagesState }

export function useHqProjectPages(): HqProjectPagesState {
  // Why: the HQ folder lives on the desktop; a paired web client has no bridge to it.
  const hqPath = useAppStore((s) => (isWebClientLocation() ? null : (s.settings?.hqPath ?? null)))
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  useEffect(() => {
    if (!hqPath) {
      return
    }
    let alive = true
    const settle = (state: HqProjectPagesState): void => {
      if (alive) {
        setLoaded({ hqPath, state })
      }
    }
    window.api.hqProjects
      .list()
      .then((result) =>
        settle(
          result.ok
            ? { status: 'ready', pages: result.pages }
            : { status: 'error', message: result.error }
        )
      )
      .catch((error: unknown) => settle({ status: 'error', message: String(error) }))
    return () => {
      alive = false
    }
  }, [hqPath])
  if (!hqPath) {
    return { status: 'off' }
  }
  return loaded?.hqPath === hqPath ? loaded.state : { status: 'loading' }
}
