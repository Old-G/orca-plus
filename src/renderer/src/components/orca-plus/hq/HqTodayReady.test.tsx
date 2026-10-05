// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import { HQ_CLOSING_MESSAGES } from '../../../../../shared/hq-closing'
import type { HqTriageDecisions } from '../../../../../shared/hq-triage'

const mocks = vi.hoisted(() => {
  const decisions: Record<string, unknown> = {}
  const state = {
    settings: { hqTriageDecisions: decisions },
    repos: [{ id: 'repo-api', path: '/p/api' }],
    worktreesByRepo: {
      'repo-api': [{ id: 'wt-1', repoId: 'repo-api', branch: 'refs/heads/dev-1' }]
    },
    fetchHostedReviewForBranch: vi.fn(async () => ({
      provider: 'gitlab',
      number: 12,
      state: 'open',
      url: 'https://gitlab/mr/12'
    })),
    updateSettings: vi.fn(async (updates: { hqTriageDecisions: Record<string, unknown> }) => {
      state.settings = { ...state.settings, ...updates }
    })
  }
  return {
    state,
    send: vi.fn(async (_card: unknown, _text: string) => ({ ok: true as const })),
    addComment: vi.fn(async () => ({ ok: true as const })),
    setEstimate: vi.fn(async () => ({ ok: true as const })),
    listStatuses: vi.fn(async () => [
      { name: 'in proсess', type: 'custom', color: null, orderIndex: 0 },
      { name: 'check', type: 'custom', color: null, orderIndex: 1 }
    ]),
    updateStatus: vi.fn(async () => ({ ok: true as const }))
  }
})

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, string>) =>
    fallback
      .replace('{{value0}}', String(options?.value0 ?? ''))
      .replace('{{value1}}', String(options?.value1 ?? ''))
}))
vi.mock('@/store', () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
  return { useAppStore }
})
vi.mock('@/runtime/runtime-clickup-client', () => ({
  clickUpAddTaskComment: mocks.addComment,
  clickUpUpdateTaskTimeEstimate: mocks.setEstimate,
  clickUpListStatuses: mocks.listStatuses,
  clickUpUpdateTaskStatus: mocks.updateStatus
}))
vi.mock('./hq-agent-answer', () => ({
  readHqAgentAnswer: vi.fn(async () => 'Сделано: корзина\n\nПолный текст')
}))
vi.mock('./hq-today-actions', () => ({
  sendHqAgentMessage: mocks.send,
  waitForNewAgentPane: vi.fn()
}))
vi.mock('../../dashboard/reveal-dashboard-agent', () => ({ revealDashboardAgent: vi.fn() }))
vi.mock('./HqCommandDictation', () => ({ HqCommandDictation: () => null }))

const { HqTodayReady } = await import('./HqTodayReady')

const task: ClickUpTaskSummary = {
  id: '1',
  customId: null,
  identifier: 'DEV-1',
  title: 'Fix the cart',
  url: 'u',
  status: { name: 'in proсess', color: null, type: 'custom', orderIndex: 0 },
  priority: null,
  assignees: [],
  dueDate: null,
  updatedAt: null,
  listId: 'list-a',
  listName: null,
  spaceId: null,
  workspaceId: null
}

function agent(bucket: DashboardCard['bucket'], extra: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'pane-1',
    ptyId: null,
    agentType: 'claude',
    bucket,
    dotState: 'done',
    task: 'DEV-1',
    repoId: 'repo-api',
    worktreeId: 'wt-1',
    tabId: 't',
    leafId: null,
    repoName: 'lh-api',
    worktreeName: 'dev-1',
    startedAt: 1,
    finishedAt: 10,
    stateChangedAt: 10,
    unseen: false,
    ...extra
  }
}

function show(decisions: HqTriageDecisions, cards: DashboardCard[]): void {
  mocks.state.settings = { hqTriageDecisions: decisions }
  render(
    <HqTodayReady
      tasks={[task]}
      decisions={decisions}
      cards={cards}
      sourceContext={null}
      levelOf={() => 1}
    />
  )
}

const taken = {
  decision: 'taken' as const,
  at: 1,
  repoId: 'repo-api',
  worktreeId: 'wt-1',
  paneKey: 'pane-1'
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HqTodayReady', () => {
  it('stays empty while the agent still works on a task nobody started closing', () => {
    show({ 1: taken }, [agent('working')])
    expect(screen.queryByText('Ready for you')).toBeNull()
  })

  it('accepts by telling the agent, and shows the branch’s MR', async () => {
    show({ 1: taken }, [agent('done')])
    expect(await screen.findByText('!12 open')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith(
        expect.objectContaining({ paneKey: 'pane-1' }),
        HQ_CLOSING_MESSAGES.accept
      )
    )
    expect(mocks.state.updateSettings).toHaveBeenCalled()
  })

  it('merges only on a second click', async () => {
    show({ 1: { ...taken, acceptedAt: 5 } }, [agent('done')])
    fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))
    expect(mocks.send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Merge — sure?' }))
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith(expect.anything(), HQ_CLOSING_MESSAGES.merge)
    )
  })

  it('sends the agent’s comment draft to ClickUp, and allows «check» only after it', async () => {
    show({ 1: { ...taken, commentAskedAt: 5 } }, [
      agent('done', { lastAgentMessage: 'Сделано: корзина', finishedAt: 9 })
    ])
    expect(screen.getByRole('button', { name: 'Set «check»' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Review comment' }))
    expect(await screen.findByRole('textbox', { name: 'Comment for DEV-1' })).toHaveProperty(
      'value',
      'Сделано: корзина\n\nПолный текст'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send to ClickUp' }))
    await waitFor(() =>
      expect(mocks.addComment).toHaveBeenCalledWith(null, '1', 'Сделано: корзина\n\nПолный текст')
    )
    expect(mocks.state.settings.hqTriageDecisions['1']).toMatchObject({
      commentedAt: expect.any(Number)
    })
  })

  it('writes hours as the Time Estimate and moves a commented task to «check»', async () => {
    show({ 1: { ...taken, commentedAt: 7 } }, [agent('done')])
    fireEvent.click(screen.getByRole('button', { name: '2 h' }))
    await waitFor(() => expect(mocks.setEstimate).toHaveBeenCalledWith(null, '1', 2))
    fireEvent.click(screen.getByRole('button', { name: 'Set «check»' }))
    await waitFor(() => expect(mocks.updateStatus).toHaveBeenCalledWith(null, '1', 'check'))
    await waitFor(() =>
      expect(mocks.state.settings.hqTriageDecisions['1']).toMatchObject({ decision: 'closed' })
    )
  })

  it('removes a task from HQ without touching ClickUp', async () => {
    show({ 1: taken }, [agent('done')])
    fireEvent.click(screen.getByRole('button', { name: 'Remove from HQ' }))
    await waitFor(() =>
      expect(mocks.state.settings.hqTriageDecisions['1']).toMatchObject({ decision: 'closed' })
    )
    expect(mocks.updateStatus).not.toHaveBeenCalled()
  })
})
