// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardCard, DashboardWorkspace } from '../../../../../shared/dashboard-snapshot'
import type { Tab } from '../../../../../shared/tab-types'
import { buildHqChatList, hqChatKey, type HqChatItem } from '../hq/hq-chat-list'

type StoreView = {
  activeWorktreeId: string | null
  groupsByWorktree: Record<string, { id: string; activeTabId: string | null }[]>
}

const mocks = vi.hoisted(() => {
  const state: StoreView = { activeWorktreeId: 'wt-1', groupsByWorktree: {} }
  const items: HqChatItem[] = []
  return { state, items }
})

vi.mock('@/store', () => ({
  useAppStore: (select: (state: StoreView) => unknown) => select(mocks.state)
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('../hq/use-hq-chat-list', () => ({
  useHqChatList: () => ({ items: mocks.items, cards: [] })
}))
vi.mock('../hq/HqChatPane', () => ({
  HqChatBody: ({ item }: { item: HqChatItem }) => <div data-testid="chat">{item.key}</div>
}))
vi.mock('../hq/HqChatAvatar', () => ({
  useHqChatTitle: (item: HqChatItem) => (item.kind === 'chat' ? item.tab.label : item.key)
}))
vi.mock('@/components/AgentStateDot', () => ({ AgentStateDot: () => null }))

import CodeChatPanel, { pickCodeChat } from './CodeChatPanel'
import { chooseCodeChat } from './code-chat-panel-state'

const workspace = (worktreeId: string): DashboardWorkspace => ({
  repoId: 'repo-1',
  worktreeId,
  repoName: 'orca-custom',
  worktreeName: worktreeId,
  hostKind: 'local',
  executionHostId: 'local',
  workspaceKind: 'worktree'
})

const chatTab = (id: string, worktreeId = 'wt-1', createdAt = 1): Tab => ({
  id,
  entityId: `session-${id}`,
  groupId: 'group-1',
  worktreeId,
  contentType: 'agent-session',
  agentSessionAgent: 'claude',
  label: `Chat ${id}`,
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt
})

const card = (overrides: Partial<DashboardCard>): DashboardCard => ({
  paneKey: 'x:l',
  ptyId: null,
  agentType: 'claude',
  bucket: 'working',
  dotState: 'working',
  task: '',
  repoId: 'repo-1',
  worktreeId: 'wt-1',
  tabId: 'x',
  leafId: 'l',
  repoName: 'orca-custom',
  worktreeName: 'custom',
  startedAt: 10,
  finishedAt: null,
  stateChangedAt: 10,
  unseen: false,
  ...overrides
})

function setItems(cards: DashboardCard[], tabs: Tab[]): void {
  mocks.items = buildHqChatList({ cards, workspaces: [workspace('wt-1'), workspace('wt-2')] }, tabs)
}

afterEach(() => {
  cleanup()
  mocks.state.activeWorktreeId = 'wt-1'
  mocks.state.groupsByWorktree = {}
})

describe('CodeChatPanel', () => {
  it("shows the open workspace's working chat, never another workspace's", () => {
    setItems(
      [card({ tabId: 'work', paneKey: 'work:l' })],
      [chatTab('old', 'wt-1', 5), chatTab('work'), chatTab('elsewhere', 'wt-2', 9)]
    )
    render(<CodeChatPanel />)
    expect(screen.getByTestId('chat').textContent).toBe(hqChatKey('wt-1', 'work'))
  })

  it('keeps the chat picked for the workspace', () => {
    setItems([card({ tabId: 'work', paneKey: 'work:l' })], [chatTab('old'), chatTab('work')])
    render(<CodeChatPanel />)
    act(() => chooseCodeChat('wt-1', hqChatKey('wt-1', 'old')))
    expect(screen.getByTestId('chat').textContent).toBe(hqChatKey('wt-1', 'old'))
  })

  it('does not show a second live copy of a chat the editor area shows', () => {
    setItems([], [chatTab('solo')])
    mocks.state.groupsByWorktree = { 'wt-1': [{ id: 'g', activeTabId: 'solo' }] }
    mocks.state.activeWorktreeId = 'wt-1'
    chooseCodeChat('wt-1', hqChatKey('wt-1', 'solo'))
    render(<CodeChatPanel />)
    expect(screen.queryByTestId('chat')).toBeNull()
    expect(screen.getByText(/open in the editor area/)).toBeTruthy()
  })

  it('says so when the workspace has no agent chats', () => {
    setItems([], [chatTab('elsewhere', 'wt-2')])
    mocks.state.activeWorktreeId = 'wt-3'
    render(<CodeChatPanel />)
    expect(screen.getByText('No agent chats in this workspace yet.')).toBeTruthy()
  })
})

describe('pickCodeChat', () => {
  it('prefers the picked chat, then the one HQ showed, then what works, then the latest', () => {
    setItems(
      [card({ tabId: 'work', paneKey: 'work:l' })],
      [chatTab('a', 'wt-1', 3), chatTab('work')]
    )
    const a = hqChatKey('wt-1', 'a')
    expect(pickCodeChat(mocks.items, a, null)).toBe(a)
    expect(pickCodeChat(mocks.items, 'gone', a)).toBe(a)
    expect(pickCodeChat(mocks.items, null, null)).toBe(hqChatKey('wt-1', 'work'))
    setItems([], [chatTab('a', 'wt-1', 3), chatTab('b', 'wt-1', 7)])
    expect(pickCodeChat(mocks.items, null, null)).toBe(hqChatKey('wt-1', 'b'))
  })
})
