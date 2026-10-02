// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Settings = { hqProjectClickUpLists?: Record<string, unknown> }

const mocks = vi.hoisted(() => {
  const settings: Settings = {}
  const clickUpStatus: { connected: boolean; workspaces: { id: string; name: string }[] } & {
    selectedWorkspaceId: string | null
    viewer: null
  } = {
    connected: true,
    viewer: null,
    workspaces: [{ id: 'ws', name: 'Team' }],
    selectedWorkspaceId: 'ws'
  }
  const state = {
    settings,
    clickUpStatus,
    clickUpStatusChecked: true,
    clickUpStatusContextKey: 'local',
    clickUpConnectionRevision: 1,
    checkClickUpConnection: vi.fn(async () => {}),
    openModal: vi.fn(),
    updateSettings: vi.fn(async (updates: Settings) => {
      state.settings = { ...state.settings, ...updates }
      for (const listener of listeners) {
        listener()
      }
    })
  }
  const listeners = new Set<() => void>()
  return {
    state,
    listeners,
    listTasks: vi.fn(async () => [
      {
        id: 't1',
        identifier: 'DEV-7',
        title: 'Fix the cart',
        url: 'https://app.clickup.com/t/t1',
        status: { name: 'in progress', type: 'custom', color: '#0af', orderIndex: 1 },
        assignees: [{ username: 'ann', initials: 'AN' }]
      },
      {
        id: 't2',
        identifier: 'DEV-8',
        title: 'Plan the launch',
        url: 'https://app.clickup.com/t/t2',
        status: { name: 'future', type: 'custom', color: null, orderIndex: 0 },
        assignees: []
      }
    ]),
    listSpaces: vi.fn(async () => [{ id: 's1', name: 'Dev' }]),
    listLists: vi.fn(async () => [{ id: 'l1', name: 'Shop', folderName: 'Web' }]),
    getTask: vi.fn(async () => ({
      id: 't1',
      identifier: 'DEV-7',
      title: 'Fix the cart',
      url: 'https://app.clickup.com/t/t1',
      status: { name: 'in progress', type: 'custom', color: '#0af' },
      assignees: [],
      listName: 'Shop',
      description: 'full text'
    }))
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
vi.mock('@/runtime/runtime-clickup-client', () => ({
  clickUpListTasks: mocks.listTasks,
  clickUpListSpaces: mocks.listSpaces,
  clickUpListLists: mocks.listLists,
  clickUpGetTask: mocks.getTask
}))
vi.mock('@/components/clickup-connect-dialog', () => ({
  ClickUpConnectDialog: ({ open }: { open: boolean }) => (open ? <p>connect dialog</p> : null)
}))
vi.mock('@/components/task-page/clickup/TaskSheet', () => ({
  ClickUpTaskSheet: ({
    summary,
    onUse
  }: {
    summary: { title: string } | null
    onUse: (task: unknown) => void
  }) =>
    summary ? (
      <button type="button" onClick={() => onUse(summary)}>
        use {summary.title}
      </button>
    ) : null
}))
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children
  }: {
    value?: string
    onValueChange: (value: string) => void
    disabled?: boolean
    children: React.ReactNode
  }) => (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
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

import { HqProjectTasks } from './HqProjectTasks'

beforeEach(() => {
  mocks.state.settings = {}
  mocks.state.clickUpStatus.connected = true
})

afterEach(() => {
  window.localStorage.clear()
  cleanup()
  vi.clearAllMocks()
})

describe('HqProjectTasks', () => {
  it('links a list, then shows its open tasks and starts work on this project', async () => {
    render(<HqProjectTasks repoId="shop" />)
    await waitFor(() =>
      expect(screen.getAllByRole('combobox')[0].hasAttribute('disabled')).toBe(false)
    )
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 's1' } })
    await waitFor(() =>
      expect(screen.getAllByRole('combobox')[1].hasAttribute('disabled')).toBe(false)
    )
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'l1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))

    expect(await screen.findByText('Fix the cart')).toBeTruthy()
    expect(mocks.state.settings.hqProjectClickUpLists).toEqual({
      shop: { listId: 'l1', listName: 'Web / Shop', spaceId: 's1' }
    })
    expect(mocks.listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'shop' }),
      { scope: 'mine', listId: 'l1' },
      200
    )
    expect(screen.getByText('Web / Shop')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /DEV-7/ }))
    fireEvent.click(screen.getByRole('button', { name: 'use Fix the cart' }))
    await waitFor(() =>
      expect(mocks.state.openModal).toHaveBeenCalledWith(
        'new-workspace-composer',
        expect.objectContaining({ initialRepoId: 'shop' })
      )
    )
    expect(mocks.getTask).toHaveBeenCalled()
  })

  it('changes the list back to the picker, keeping the space', async () => {
    mocks.state.settings = {
      hqProjectClickUpLists: { shop: { listId: 'l1', listName: 'Web / Shop', spaceId: 's1' } }
    }
    render(<HqProjectTasks repoId="shop" />)
    await screen.findByText('Fix the cart')
    fireEvent.click(screen.getByRole('button', { name: 'Change list' }))
    await waitFor(() => expect(screen.getAllByRole('combobox')[0]).toHaveProperty('value', 's1'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Fix the cart')).toBeTruthy()
  })

  it('offers to connect ClickUp when it is not connected', () => {
    mocks.state.clickUpStatus.connected = false
    render(<HqProjectTasks repoId="shop" />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect ClickUp' }))
    expect(screen.getByText('connect dialog')).toBeTruthy()
    expect(mocks.listTasks).not.toHaveBeenCalled()
  })

  it('asks ClickUp for everyone’s tasks on request and filters by status, per project', async () => {
    mocks.state.settings = {
      hqProjectClickUpLists: { shop: { listId: 'l1', listName: 'Web / Shop', spaceId: 's1' } }
    }
    const view = render(<HqProjectTasks repoId="shop" />)
    await screen.findByText('Fix the cart')
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Everyone' }))
    await waitFor(() =>
      expect(mocks.listTasks).toHaveBeenLastCalledWith(
        expect.anything(),
        { scope: 'all', listId: 'l1' },
        200
      )
    )
    await screen.findByText('Fix the cart')

    const chips = screen
      .getAllByRole('button', { name: /future|in progress/ })
      .filter((button) => button.hasAttribute('aria-pressed'))
    expect(chips.map((chip) => chip.textContent)).toEqual(['future1', 'in progress1'])
    fireEvent.click(chips[0])
    expect(screen.queryByText('Fix the cart')).toBeNull()
    expect(screen.getByText('Plan the launch')).toBeTruthy()

    view.unmount()
    render(<HqProjectTasks repoId="shop" />)
    expect(await screen.findByText('Plan the launch')).toBeTruthy()
    expect(screen.queryByText('Fix the cart')).toBeNull()
    expect(screen.getByRole('button', { name: 'Everyone' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })
})
