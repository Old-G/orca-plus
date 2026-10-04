import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'

// Keep in sync with the media query in web-phone-layout.css.
const PHONE_WEB_QUERY = '(max-width: 767px)'

type NavigationState = Pick<AppState, 'activeView' | 'activeWorktreeId' | 'activeTabId'>

function didNavigate(next: NavigationState, prev: NavigationState): boolean {
  return (
    next.activeView !== prev.activeView ||
    next.activeWorktreeId !== prev.activeWorktreeId ||
    next.activeTabId !== prev.activeTabId
  )
}

// Why: on a phone each side panel covers the page, so it opens as a page of its own and folds away once a destination is picked.
export default function WebPhoneLayout(): null {
  useEffect(() => {
    const phone = window.matchMedia?.(PHONE_WEB_QUERY)
    if (!phone) {
      return
    }
    const foldPanels = (state: AppState): void => {
      if (state.sidebarOpen) {
        state.setSidebarOpen(false)
      }
      // Why safe: rightSidebarOpen is pairing-local, so this never closes the Mac's panel.
      if (state.rightSidebarOpen) {
        state.setRightSidebarOpen(false)
      }
    }
    if (phone.matches) {
      foldPanels(useAppStore.getState())
    }
    return useAppStore.subscribe((next, prev) => {
      if (phone.matches && didNavigate(next, prev)) {
        foldPanels(next)
      }
    })
  }, [])
  return null
}
