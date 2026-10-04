// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../store'
import WebPhoneLayout from './web-phone-layout'

const initialState = useAppStore.getState()

function mountAt(phone: boolean): void {
  vi.stubGlobal('matchMedia', () => ({ matches: phone }))
  useAppStore.setState({
    sidebarOpen: true,
    rightSidebarOpen: true,
    activeView: 'terminal',
    activeWorktreeId: 'wt-1'
  })
  render(<WebPhoneLayout />)
}

describe('the phone web layout', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    useAppStore.setState(initialState, true)
  })

  it('starts on the page and folds either panel away once a destination is picked', () => {
    mountAt(true)
    expect(useAppStore.getState().sidebarOpen).toBe(false)
    expect(useAppStore.getState().rightSidebarOpen).toBe(false)

    act(() => useAppStore.getState().setSidebarOpen(true))
    expect(useAppStore.getState().sidebarOpen).toBe(true)

    act(() => useAppStore.setState({ activeWorktreeId: 'wt-2' }))
    expect(useAppStore.getState().sidebarOpen).toBe(false)

    act(() => useAppStore.getState().setSidebarOpen(true))
    act(() => useAppStore.setState({ activeView: 'automations' }))
    expect(useAppStore.getState().sidebarOpen).toBe(false)

    act(() => useAppStore.getState().setRightSidebarOpen(true))
    expect(useAppStore.getState().rightSidebarOpen).toBe(true)
    act(() => useAppStore.setState({ activeTabId: 'tab-2' }))
    expect(useAppStore.getState().rightSidebarOpen).toBe(false)
  })

  it('leaves the sidebar alone on a wide screen', () => {
    mountAt(false)
    act(() => useAppStore.setState({ activeWorktreeId: 'wt-2' }))
    expect(useAppStore.getState().sidebarOpen).toBe(true)
    expect(useAppStore.getState().rightSidebarOpen).toBe(true)
  })
})
