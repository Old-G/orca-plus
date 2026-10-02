// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

type BoardProps = {
  onAckAgent: (paneKey: string) => void
  onRevealAgent: (args: unknown) => void
}

const mocks = vi.hoisted(() => {
  const board: { props: BoardProps | null } = { props: null }
  return {
    acknowledgeAgents: vi.fn(),
    revealDashboardAgent: vi.fn(),
    board,
    activeView: 'terminal',
    setActiveView: vi.fn()
  }
})

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => false }))
vi.mock('@/store', () => {
  const state = () => ({
    activeView: mocks.activeView,
    setActiveView: mocks.setActiveView,
    acknowledgeAgents: mocks.acknowledgeAgents
  })
  const useAppStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state())
  useAppStore.getState = state
  return { useAppStore }
})
vi.mock('../../dashboard/useLiveDashboardSnapshot', () => ({
  useLiveDashboardSnapshot: () => ({})
}))
vi.mock('./HqWaitingTab', () => ({ HqWaitingTab: () => <div>waiting tab</div> }))
vi.mock('./HqProjectsTab', () => ({ HqProjectsTab: () => <div>projects tab</div> }))
vi.mock('./HqWikiTab', () => ({ HqWikiTab: () => <div>wiki tab</div> }))
vi.mock('./HqMapTab', () => ({ HqMapTab: () => <div>map tab</div> }))
vi.mock('./HqTodayTab', () => ({ HqTodayTab: () => <div>today tab</div> }))
vi.mock('./HqDeferredStrip', () => ({ HqDeferredStrip: () => null }))
vi.mock('./HqDeferredBell', () => ({ HqDeferredBell: () => null }))
vi.mock('./use-hq-deferred-sessions', () => ({
  useHqDeferredSessions: () => ({ sessions: [], close: () => {} })
}))
vi.mock('../../dashboard/reveal-dashboard-agent', () => ({
  revealDashboardAgent: mocks.revealDashboardAgent
}))
vi.mock('../../dashboard-popout/AgentKanbanBoard', () => ({
  AgentKanbanBoard: (props: BoardProps) => {
    mocks.board.props = props
    return <div>agent board</div>
  }
}))

import HqScreen from './HqScreen'
import { HqSidebarEntry } from './HqSidebarEntry'
import { openHqScreen } from './hq-view'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.activeView = 'terminal'
})

describe('HqScreen', () => {
  it('shows the agent board on its Agents tab, acting on this window', () => {
    render(<HqScreen />)
    expect(screen.getByText('agent board')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Agents' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Projects' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('tab', { name: 'Today' }).hasAttribute('disabled')).toBe(false)
    mocks.board.props?.onAckAgent('tab-1:leaf-1')
    expect(mocks.acknowledgeAgents).toHaveBeenCalledWith(['tab-1:leaf-1'])
    mocks.board.props?.onRevealAgent({ worktreeId: 'wt-1' })
    expect(mocks.revealDashboardAgent).toHaveBeenCalledWith({ worktreeId: 'wt-1' })
  })
})

describe('opening HQ on a tab', () => {
  it('starts a new screen on the asked tab, and switches an open one', () => {
    openHqScreen('today')
    const { unmount } = render(<HqScreen />)
    expect(screen.getByText('today tab')).toBeTruthy()
    unmount()

    render(<HqScreen />)
    expect(screen.getByText('agent board')).toBeTruthy()
    act(() => openHqScreen('today'))
    expect(screen.getByText('today tab')).toBeTruthy()
  })
})

describe('HqSidebarEntry', () => {
  it('opens HQ, and marks itself current while HQ is shown', () => {
    const { rerender } = render(<HqSidebarEntry />)
    const button = screen.getByRole('button', { name: 'HQ' })
    expect(button.getAttribute('aria-current')).toBeNull()
    fireEvent.click(button)
    expect(mocks.setActiveView).toHaveBeenCalledWith('hq')

    mocks.activeView = 'hq'
    rerender(<HqSidebarEntry />)
    expect(screen.getByRole('button', { name: 'HQ' }).getAttribute('aria-current')).toBe('page')
  })
})
