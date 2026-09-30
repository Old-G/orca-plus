// Custom build (pulse-bell): the open inbox items, refreshed whenever main reports a pulse write.
import { useEffect, useState } from 'react'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { isWebClientLocation } from '@/lib/web-client-location'

export function usePulseBellInbox(): PulseInboxItem[] {
  const [items, setItems] = useState<PulseInboxItem[]>([])
  useEffect(() => {
    // Why: the paired web client has no bell bridge; the desktop owns the inbox.
    if (isWebClientLocation()) {
      return
    }
    let alive = true
    const load = (): void => {
      window.api.pulseBell
        .list()
        .then((next) => {
          if (alive) {
            setItems(next)
          }
        })
        .catch((error: unknown) => console.warn('[pulse-bell] list failed:', error))
    }
    load()
    const unsubscribe = window.api.pulseBell.onChanged(load)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
  return items
}
