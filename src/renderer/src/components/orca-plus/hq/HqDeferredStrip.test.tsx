// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import type { HqDeferredSession } from './hq-deferred-sessions'

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => ({ ok: true as const })),
  launchHandoff: vi.fn(async () => {}),
  reveal: vi.fn()
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, string>) =>
    fallback.replace('{{value0}}', options?.value0 ?? '')
}))
vi.mock('./hq-today-actions', () => ({ sendHqAgentMessage: mocks.send }))
vi.mock('@/app-shell/use-claude-handoff-offers', () => ({
  launchClaudeHandoffOffer: mocks.launchHandoff
}))
vi.mock('../../dashboard/reveal-dashboard-agent', () => ({ revealDashboardAgent: mocks.reveal }))

import { HqDeferredStrip } from './HqDeferredStrip'

function session(
  paneKey: string,
  reasons: HqDeferredSession['reasons'],
  handoffId: string | null = null
): HqDeferredSession {
  const card: DashboardCard = {
    paneKey,
    ptyId: null,
    agentType: 'claude',
    bucket: 'done',
    dotState: 'done',
    task: `Task ${paneKey}`,
    repoId: 'r',
    worktreeId: 'w',
    tabId: 't',
    leafId: null,
    repoName: 'shop',
    worktreeName: 'main',
    startedAt: 0,
    finishedAt: 0,
    stateChangedAt: 0,
    unseen: false,
    lastAgentMessage: 'Пушить?'
  }
  return { card, silentSince: 0, reasons, handoffId }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HqDeferredStrip', () => {
  it('shows nothing when no session is deferred', () => {
    const { container } = render(<HqDeferredStrip sessions={[]} now={0} onClose={vi.fn()} />)
    expect(container.textContent).toBe('')
  })

  it('names why each session looks unfinished and acts on it', async () => {
    const onClose = vi.fn()
    const dirty = session('a', [{ kind: 'changes', count: 3 }, { kind: 'asks' }])
    const handed = session('b', [{ kind: 'handoff' }], 'offer-1')
    render(<HqDeferredStrip sessions={[dirty, handed]} now={0} onClose={onClose} />)

    const first = screen.getByText('Task a').closest('li')!
    expect(within(first).getByText('3 uncommitted')).toBeTruthy()
    expect(within(first).getByText('asks you')).toBeTruthy()
    fireEvent.click(within(first).getByRole('button', { name: 'Continue' }))
    expect(mocks.send).toHaveBeenCalledWith(dirty.card, 'Continue')
    await waitFor(() => expect(within(first).getByRole('button', { name: 'Sent.' })).toBeTruthy())
    fireEvent.click(within(first).getByRole('button', { name: 'Open' }))
    expect(mocks.reveal).toHaveBeenCalledWith(expect.objectContaining({ worktreeId: 'w' }))
    fireEvent.click(within(first).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledWith(dirty)

    const second = screen.getByText('Task b').closest('li')!
    expect(within(second).queryByRole('button', { name: 'Continue' })).toBeNull()
    fireEvent.click(within(second).getByRole('button', { name: 'New session' }))
    expect(mocks.launchHandoff).toHaveBeenCalledWith('offer-1')
  })
})
