// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    setActiveView: vi.fn(),
    updateSettings: vi.fn(async () => {})
  }
})

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => false }))
vi.mock('@/store', () => {
  const state = () => ({
    activeView: mocks.activeView,
    setActiveView: mocks.setActiveView,
    acknowledgeAgents: mocks.acknowledgeAgents,
    settings: {},
    updateSettings: mocks.updateSettings
  })
  const useAppStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state())
  useAppStore.getState = state
  return { useAppStore }
})
vi.mock('../../dashboard/useLiveDashboardSnapshot', () => ({
  useLiveDashboardSnapshot: () => ({ cards: [] })
}))
vi.mock('./use-hq-spaces', () => ({
  useHqSpaces: () => ({ active: null, shows: () => true })
}))
vi.mock('./HqMessengerScreen', () => ({ HqMessengerScreen: () => <div>messenger view</div> }))
vi.mock('../hq-plus/HqPlusScreen', () => ({ HqPlusScreen: () => <div>hq+ view</div> }))
vi.mock('./HqDeferredStrip', () => ({ HqDeferredStrip: () => null }))
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
import { HqAgentsTab } from './HqAgentsTab'
import { HqSidebarEntry } from './HqSidebarEntry'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.activeView = 'terminal'
})

describe('HqScreen', () => {
  it('shows the messenger view', () => {
    render(<HqScreen />)
    expect(screen.getByText('messenger view')).toBeTruthy()
  })
})

describe('HqAgentsTab', () => {
  it('shows the agent board, acting on this window', () => {
    render(<HqAgentsTab />)
    expect(screen.getByText('agent board')).toBeTruthy()
    mocks.board.props?.onAckAgent('tab-1:leaf-1')
    expect(mocks.acknowledgeAgents).toHaveBeenCalledWith(['tab-1:leaf-1'])
    mocks.board.props?.onRevealAgent({ worktreeId: 'wt-1' })
    expect(mocks.revealDashboardAgent).toHaveBeenCalledWith({ worktreeId: 'wt-1' })
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
