// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

type CommentResult = { ok: true } | { ok: false; error: string }

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
      { id: 'repo-api', displayName: 'lh-api', kind: 'git', path: '/p/api' },
      { id: 'repo-web', displayName: 'lh-web', kind: 'git', path: '/p/web' },
      { id: 'notes', displayName: 'notes', kind: 'folder' }
    ],
    clickUpStatus: {
      connected: true,
      workspaces: [{ id: 'ws', name: 'Team' }],
      selectedWorkspaceId: 'ws',
      viewer: { id: 'me', username: 'gleb', email: null }
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
    launch: vi.fn(async (_args: unknown) => true),
    addComment: vi.fn(
      async (_ctx: unknown, _taskId: string, _body: string): Promise<CommentResult> => ({
        ok: true
      })
    ),
    taskComments: vi.fn(async (): Promise<unknown[]> => []),
    draftQuestions: vi.fn(async (_task: unknown) => ({ ok: true, questions: '1. Which cart?' })),
    launchHq: vi.fn((_worktreeId: string, _prompt: string) => ({ ok: true }))
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
  clickUpUpdateTaskStatus: mocks.updateStatus,
  clickUpAddTaskComment: mocks.addComment,
  clickUpTaskComments: mocks.taskComments
}))
vi.mock('./HqCommandDictation', () => ({ HqCommandDictation: () => null }))
vi.mock('./hq-today-actions', () => ({
  findHqWorktreeId: () => 'hq-wt',
  launchHqCommand: mocks.launchHq
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
    render(<HqTodayTriage now={100} />)
    expect(await screen.findByText('Fix the cart')).toBeTruthy()
    expect(screen.getByText('Plan the launch')).toBeTruthy()
    expect(screen.queryByText('Already going')).toBeNull()
    expect(screen.queryByText('Hidden one')).toBeNull()

    const selects = screen.getAllByRole<HTMLSelectElement>('combobox')
    // The suggested row also offers «+ project»; a row without a project does not.
    expect(selects.map((select) => select.value)).toEqual(['repo-api', '', ''])
    // Why: a folder project cannot hold a worktree.
    expect(screen.queryAllByRole('option', { name: 'notes' })).toHaveLength(0)
    const takeButtons = screen.getAllByRole<HTMLButtonElement>('button', { name: 'Take' })
    expect(takeButtons.map((button) => button.disabled)).toEqual([false, true])
  })

  it('hides for good, snoozes for now, and takes into the picked project', async () => {
    render(<HqTodayTriage now={100} />)
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
        promptDelivery: 'submit-after-ready',
        nativeChatSessionOptions: {
          claude: { model: 'opus', valuesByModel: { opus: { effort: 'high' } } }
        }
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
    render(<HqTodayTriage now={100} />)
    await screen.findByText('Fix the cart')
    fireEvent.click(within(rowOf('Fix the cart')).getByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(screen.queryByText('Fix the cart')).toBeNull())
    expect(mocks.state.settings.hqTriageDecisions).toMatchObject({ '1': { decision: 'hidden' } })
    expect(mocks.launch).not.toHaveBeenCalled()
    expect(mocks.updateStatus).not.toHaveBeenCalled()
  })

  it('drafts questions, sends the edited text as a comment, then waits on the author', async () => {
    mocks.state.settings = { ...mocks.state.settings, hqTriageDecisions: {} }
    Object.assign(window, { api: { hqProjects: { draftTaskQuestions: mocks.draftQuestions } } })
    render(<HqTodayTriage now={100} />)
    await screen.findByText('Fix the cart')
    fireEvent.click(within(rowOf('Fix the cart')).getByRole('button', { name: 'Questions' }))

    const box = await screen.findByRole<HTMLTextAreaElement>('textbox', {
      name: 'Questions for DEV-1'
    })
    expect(box.value).toBe('1. Which cart?')
    expect(mocks.draftQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'DEV-1', title: 'Fix the cart' })
    )
    expect(mocks.addComment).not.toHaveBeenCalled()

    fireEvent.change(box, { target: { value: '1. Which cart, web or app?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to ClickUp' }))
    await waitFor(() =>
      expect(mocks.addComment).toHaveBeenCalledWith(
        expect.anything(),
        '1',
        '1. Which cart, web or app?'
      )
    )
    expect(mocks.state.settings.hqTriageDecisions).toMatchObject({ '1': { decision: 'asked' } })
    expect(await screen.findByText('Waiting on the author')).toBeTruthy()
    expect(mocks.launch).not.toHaveBeenCalled()
  })

  it('keeps the questions and shows why when ClickUp refuses the comment', async () => {
    mocks.state.settings = { ...mocks.state.settings, hqTriageDecisions: {} }
    mocks.addComment.mockResolvedValueOnce({ ok: false, error: 'no access' })
    Object.assign(window, { api: { hqProjects: { draftTaskQuestions: mocks.draftQuestions } } })
    render(<HqTodayTriage now={100} />)
    await screen.findByText('Fix the cart')
    fireEvent.click(within(rowOf('Fix the cart')).getByRole('button', { name: 'Questions' }))
    await screen.findByRole('textbox', { name: 'Questions for DEV-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Send to ClickUp' }))
    expect(await screen.findByText('no access')).toBeTruthy()
    expect(mocks.state.settings.hqTriageDecisions).toEqual({})
  })

  it('returns a task to New tasks once someone else answers after the questions', async () => {
    mocks.state.settings = {
      ...mocks.state.settings,
      hqTriageDecisions: { '1': { decision: 'asked', at: 50 } }
    }
    mocks.taskComments.mockResolvedValue([
      { id: 'c1', body: 'my questions', author: { id: 'me' }, createdAt: 60 },
      { id: 'c2', body: 'web', author: { id: 'ann' }, createdAt: 70 }
    ])
    render(<HqTodayTriage now={100} />)
    await waitFor(() => expect(mocks.state.settings.hqTriageDecisions).toEqual({}))
    expect(await screen.findByText('Fix the cart')).toBeTruthy()
    expect(screen.queryByText('Waiting on the author')).toBeNull()
  })

  it('hands a task spanning two projects to a coordinator in the HQ workspace', async () => {
    mocks.state.settings = { ...mocks.state.settings, hqTriageDecisions: {} }
    render(<HqTodayTriage now={100} />)
    await screen.findByText('Fix the cart')
    const row = rowOf('Fix the cart')
    const [, addProject] = within(row).getAllByRole<HTMLSelectElement>('combobox')
    fireEvent.change(addProject, { target: { value: 'repo-web' } })
    expect(within(row).getByRole('button', { name: 'Remove lh-web' })).toBeTruthy()

    fireEvent.click(within(row).getByRole('button', { name: 'Take' }))
    await waitFor(() => expect(mocks.launchHq).toHaveBeenCalled())
    const [worktreeId, prompt] = mocks.launchHq.mock.calls[0]
    expect(worktreeId).toBe('hq-wt')
    expect(prompt).toContain('Ты координатор задачи ClickUp DEV-1')
    expect(prompt).toContain('lh-api')
    expect(prompt).toContain('- lh-web: `/p/web`')
    expect(mocks.launch).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(mocks.updateStatus).toHaveBeenCalledWith(expect.anything(), '1', 'in process')
    )
  })
})
