// Custom build (hq): in the paired web client HQ's settings (its folder, linked lists, closed
// deferred sessions) live on the Mac, so HQ pulls them into the store when it opens.
import { useEffect } from 'react'
import { useAppStore } from '@/store'

export function useHqWebSettings(): void {
  useEffect(() => {
    const load = window.api?.hqProjects?.settings
    if (!load) {
      return
    }
    let alive = true
    load().then(
      (hq) => {
        if (alive) {
          useAppStore.setState((state) =>
            state.settings ? { settings: { ...state.settings, ...hq } } : {}
          )
        }
      },
      // Why: a host without HQ settings leaves HQ on its "set an HQ folder" notes.
      () => undefined
    )
    return () => {
      alive = false
    }
  }, [])
}
