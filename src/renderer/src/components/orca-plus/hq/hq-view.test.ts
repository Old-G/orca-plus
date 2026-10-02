import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const value: { activeView: string; setActiveView: (view: string) => void } = {
    activeView: 'skills',
    setActiveView: (view: string) => {
      value.activeView = view
    }
  }
  return value
})
vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))

import { closeHqScreen, openHqScreen } from './hq-view'

describe('the HQ view', () => {
  beforeEach(() => {
    state.activeView = 'skills'
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
})
