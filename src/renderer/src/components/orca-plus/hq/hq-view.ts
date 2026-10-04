// Custom build (hq): opening and closing Orca+'s HQ screen, a main-area view like Skills or Tasks,
// optionally on a given tab.
import type { TopLevelView } from '../../../../../shared/ui-chrome-types'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useAppStore } from '@/store'

// Why: below this width the sidebar would leave HQ a sliver; on a phone it gives way to HQ.
const NARROW_WEB_QUERY = '(max-width: 767px)'

let viewBeforeHq: TopLevelView | null = null
let requestedTab: string | null = null
const tabListeners = new Set<(tab: string) => void>()

/** Opens HQ; with `tab`, on that tab — the open screen switches, a new one starts there. */
export function openHqScreen(tab?: string): void {
  if (tab) {
    requestedTab = tab
    for (const listener of tabListeners) {
      listener(tab)
    }
  }
  const { activeView, setActiveView, setSidebarOpen } = useAppStore.getState()
  if (isWebClientLocation() && window.matchMedia?.(NARROW_WEB_QUERY).matches) {
    setSidebarOpen(false)
  }
  if (activeView === 'hq') {
    return
  }
  viewBeforeHq = activeView
  setActiveView('hq')
}

/** The tab a caller asked HQ to open on, once; null when nobody asked. */
export function takeRequestedHqTab(): string | null {
  const tab = requestedTab
  requestedTab = null
  return tab
}

export function onHqTabRequested(listener: (tab: string) => void): () => void {
  tabListeners.add(listener)
  return () => {
    tabListeners.delete(listener)
  }
}

/** Back to where HQ was opened from; the workbench after a restart restored HQ itself. */
export function closeHqScreen(): void {
  const { activeView, setActiveView } = useAppStore.getState()
  if (activeView !== 'hq') {
    return
  }
  setActiveView(viewBeforeHq ?? 'terminal')
  viewBeforeHq = null
}
