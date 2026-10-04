import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const value: {
    activeView: string
    sidebarOpen: boolean
    web: boolean
    setActiveView: (view: string) => void
    setSidebarOpen: (open: boolean) => void
  } = {
    activeView: 'skills',
    sidebarOpen: true,
    web: false,
    setActiveView: (view: string) => {
      value.activeView = view
    },
    setSidebarOpen: (open: boolean) => {
      value.sidebarOpen = open
    }
  }
  return value
})
vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => state.web }))

import { closeHqScreen, openHqScreen } from './hq-view'

describe('the HQ view', () => {
  beforeEach(() => {
    state.activeView = 'skills'
    state.sidebarOpen = true
    state.web = false
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
  })

  it('opens over the current view and closes back to it', () => {
    openHqScreen()
    expect(state.activeView).toBe('hq')
    closeHqScreen()
    expect(state.activeView).toBe('skills')
  })

  it('closes to the workbench when HQ was restored at startup', () => {
    state.activeView = 'hq'
    closeHqScreen()
    expect(state.activeView).toBe('terminal')
  })

  it('folds the sidebar away in the web client at phone width only', () => {
    openHqScreen()
    expect(state.sidebarOpen).toBe(true)
    closeHqScreen()
    state.web = true
    openHqScreen()
    expect(state.sidebarOpen).toBe(false)
  })
})
