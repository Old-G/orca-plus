// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const status = (name: string, type: string) => ({ name, type, color: null, orderIndex: 0 })
  const task = (id: string, title: string, type: string, listId: string) => ({
    id,
    identifier: `DEV-${id}`,
    title,
    url: `https://app.clickup.com/t/${id}`,
    status: status(type === 'open' ? 'to do' : 'review', type),
    assignees: [],
    listId,
    listName: 'IT / AI'
  })
  const settings: Record<string, unknown> = {
    hqPath: null,
    hqProjectClickUpLists: { 'repo-api': { listId: 'list-a', listName: 'A', spaceId: 's' } },
    hqTriageDecisions: { '4': { decision: 'hidden', at: 1 } }
  }
  const state = {
    settings,
    repos: [
      { id: 'repo-api', displayName: 'lh-api', kind: 'git' },
      { id: 'repo-web', displayName: 'lh-web', kind: 'git' },
      { id: 'notes', displayName: 'notes', kind: 'folder' }
    ],
    clickUpStatus: {
      connected: true,
      workspaces: [{ id: 'ws', name: 'Team' }],
      selectedWorkspaceId: 'ws'
    },
    clickUpStatusChecked: true,
    clickUpStatusContextKey: 'local',
    clickUpConnectionRevision: 1,
    checkClickUpConnection: vi.fn(async () => {}),
    openModal: vi.fn(),
    updateSettings: vi.fn(async (updates: Record<string, unknown>) => {
      state.settings = { ...state.settings, ...updates }
      for (const listener of listeners) {
        listener()
      }
    })
  }
  return {
    state,
    listeners,
    listTasks: vi.fn(async () => [
      task('1', 'Fix the cart', 'open', 'list-a'),
      task('2', 'Plan the launch', 'open', 'list-z'),
      task('3', 'Already going', 'custom', 'list-a'),
      task('4', 'Hidden one', 'open', 'list-a')
    ]),
    getTask: vi.fn(async () => null),
    listStatuses: vi.fn(async () => [status('in process', 'custom')]),
    updateStatus: vi.fn(async () => ({ ok: true })),
    launch: vi.fn(async (_args: unknown) => true)
  }
})

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, string>) =>
    fallback.replace('{{value0}}', options?.value0 ?? '')
}))
vi.mock('@/store', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (listener: () => void) => {
    mocks.listeners.add(listener)
    return () => mocks.listeners.delete(listener)
  }
  return {
    useAppStore: Object.assign(
      (selector: (s: typeof mocks.state) => unknown) =>
        useSyncExternalStore(subscribe, () => selector(mocks.state)),
      { getState: () => mocks.state }
    )
  }
})
vi.mock('@/lib/provider-runtime-context', () => ({ getProviderRuntimeContextKey: () => 'local' }))
vi.mock('@/lib/launch-work-item-direct', () => ({ launchWorkItemDirect: mocks.launch }))
vi.mock('@/runtime/runtime-clickup-client', () => ({
  clickUpListTasks: mocks.listTasks,
  clickUpGetTask: mocks.getTask,
  clickUpListStatuses: mocks.listStatuses,
  clickUpUpdateTaskStatus: mocks.updateStatus
}))
vi.mock('@/components/task-page/clickup/TaskSheet', () => ({ ClickUpTaskSheet: () => null }))
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children
  }: {
    value?: string
    onValueChange: (value: string) => void
    children: React.ReactNode
  }) => (
    <select value={value ?? ''} onChange={(event) => onValueChange(event.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  )
}))

import { HqTodayTriage } from './HqTodayTriage'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function rowOf(title: string): HTMLElement {
  const row = screen.getByText(title).closest('li')
  if (!row) {
    throw new Error(`no row for ${title}`)
  }
  return row
}

describe('HqTodayTriage', () => {
  it('lists only fresh, undecided tasks with the bound project suggested', async () => {
    render(<HqTodayTriage />)
    expect(await screen.findByText('Fix the cart')).toBeTruthy()
    expect(screen.getByText('Plan the launch')).toBeTruthy()
    expect(screen.queryByText('Already going')).toBeNull()
    expect(screen.queryByText('Hidden one')).toBeNull()

    const selects = screen.getAllByRole<HTMLSelectElement>('combobox')
    expect(selects.map((select) => select.value)).toEqual(['repo-api', ''])
    // Why: a folder project cannot hold a worktree.
    expect(screen.queryAllByRole('option', { name: 'notes' })).toHaveLength(0)
    const takeButtons = screen.getAllByRole<HTMLButtonElement>('button', { name: 'Take' })
    expect(takeButtons.map((button) => button.disabled)).toEqual([false, true])
  })

  it('hides for good, snoozes for now, and takes into the picked project', async () => {
    render(<HqTodayTriage />)
    await screen.findByText('Fix the cart')

    fireEvent.click(within(rowOf('Fix the cart')).getByRole('button', { name: 'Not now' }))
    expect(screen.queryByText('Fix the cart')).toBeNull()
    expect(mocks.state.updateSettings).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'repo-web' } })
    fireEvent.click(screen.getByRole('button', { name: 'Take' }))
    await waitFor(() => expect(mocks.updateStatus).toHaveBeenCalled())
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 'repo-web',
        agentOverride: 'claude',
        promptDelivery: 'submit-after-ready'
      })
    )
    expect(mocks.updateStatus).toHaveBeenCalledWith(expect.anything(), '2', 'in process')
    expect(mocks.state.settings.hqTriageDecisions).toMatchObject({
      '2': { decision: 'taken', repoId: 'repo-web' }
    })
    expect(screen.queryByText('Plan the launch')).toBeNull()
  })

  it('records a hidden task so it stays gone', async () => {
    mocks.state.settings = { ...mocks.state.settings, hqTriageDecisions: {} }
    render(<HqTodayTriage />)
    await screen.findByText('Fix the cart')
    fireEvent.click(within(rowOf('Fix the cart')).getByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(screen.queryByText('Fix the cart')).toBeNull())
    expect(mocks.state.settings.hqTriageDecisions).toMatchObject({ '1': { decision: 'hidden' } })
    expect(mocks.launch).not.toHaveBeenCalled()
    expect(mocks.updateStatus).not.toHaveBeenCalled()
  })
})
