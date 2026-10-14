import { describe, expect, it } from 'vitest'
import type { DashboardCard, DashboardWorkspace } from '../../../../../shared/dashboard-snapshot'
import type { Tab } from '../../../../../shared/tab-types'
import {
  buildHqChatList,
  groupHqChats,
  hqChatKey,
  hqProjectInitials,
  nextHqWaitingChat,
  pickHqChat
} from './hq-chat-list'

const workspace = (worktreeId: string, hostKind: DashboardWorkspace['hostKind'] = 'local') =>
  ({
    repoId: 'repo-1',
    worktreeId,
    repoName: 'orca-custom',
    worktreeName: 'custom',
    hostKind,
    executionHostId: 'local',
    workspaceKind: 'worktree'
  }) satisfies DashboardWorkspace

const chatTab = (id: string, worktreeId = 'wt-1', createdAt = 1): Tab => ({
  id,
  entityId: `session-${id}`,
  groupId: 'group-1',
  worktreeId,
  contentType: 'agent-session',
  agentSessionAgent: 'claude',
  label: 'Claude',
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt
})

const card = (overrides: Partial<DashboardCard>): DashboardCard => ({
  paneKey: 'tab-x:leaf-x',
  ptyId: null,
  agentType: 'claude',
  bucket: 'working',
  dotState: 'working',
  task: '',
  repoId: 'repo-1',
  worktreeId: 'wt-1',
  tabId: 'tab-x',
  leafId: 'leaf-x',
  repoName: 'orca-custom',
  worktreeName: 'custom',
  startedAt: 10,
  finishedAt: null,
  stateChangedAt: 10,
  unseen: false,
  ...overrides
})

describe('buildHqChatList', () => {
  it('groups chats by what they need: a question, work, an unread finish, the rest quiet', () => {
    const items = buildHqChatList(
      {
        workspaces: [workspace('wt-1')],
        cards: [
          card({ tabId: 'ask', paneKey: 'ask:l', bucket: 'attention', dotState: 'waiting' }),
          card({ tabId: 'work', paneKey: 'work:l' }),
          card({
            tabId: 'fresh',
            paneKey: 'fresh:l',
            bucket: 'done',
            dotState: 'done',
            unseen: true
          }),
          card({
            tabId: 'read',
            paneKey: 'read:l',
            bucket: 'done',
            dotState: 'done',
            unseen: false
          })
        ]
      },
      ['ask', 'work', 'fresh', 'read', 'new'].map((id) => chatTab(id))
    )
    const groups = groupHqChats(items)
    expect(groups.needs.map((item) => item.key)).toEqual([hqChatKey('wt-1', 'ask')])
    expect(groups.working.map((item) => item.key)).toEqual([hqChatKey('wt-1', 'work')])
    expect(groups.done.map((item) => item.key)).toEqual([hqChatKey('wt-1', 'fresh')])
    // A chat before its first turn has no card and sits with the quiet ones.
    expect(groups.quiet.map((item) => item.key).sort()).toEqual(
      [hqChatKey('wt-1', 'new'), hqChatKey('wt-1', 'read')].sort()
    )
    expect(items.every((item) => item.kind === 'chat')).toBe(true)
  })

  it('lists terminal agents by their card, and a chat once even when it has a card', () => {
    const items = buildHqChatList(
      {
        workspaces: [workspace('wt-1')],
        cards: [
          card({ tabId: 'chat', paneKey: 'chat:l' }),
          card({ tabId: 'term', paneKey: 'term:leaf', ptyId: 'pty-1', agentType: 'codex' })
        ]
      },
      [chatTab('chat')]
    )
    expect(items.map((item) => [item.kind, item.key])).toEqual([
      ['chat', hqChatKey('wt-1', 'chat')],
      ['terminal', 'term:leaf']
    ])
    expect(items[1].agentType).toBe('codex')
  })

  it('drops chats of workspaces the board no longer lists, and keeps the host kind', () => {
    const items = buildHqChatList(
      { workspaces: [workspace('wt-ssh', 'ssh')], cards: [card({ worktreeId: 'gone' })] },
      [chatTab('a', 'wt-ssh'), chatTab('b', 'gone')]
    )
    expect(items.map((item) => item.key)).toEqual([hqChatKey('wt-ssh', 'a')])
    expect(items[0].hostKind).toBe('ssh')
  })

  it('puts the latest state change first', () => {
    const items = buildHqChatList(
      {
        workspaces: [workspace('wt-1')],
        cards: [
          card({ tabId: 'old', paneKey: 'old:l', stateChangedAt: 5 }),
          card({ tabId: 'new', paneKey: 'new:l', stateChangedAt: 50 })
        ]
      },
      [chatTab('old'), chatTab('new')]
    )
    expect(items.map((item) => item.key)).toEqual([
      hqChatKey('wt-1', 'new'),
      hqChatKey('wt-1', 'old')
    ])
  })
})

describe('pickHqChat', () => {
  const items = buildHqChatList(
    {
      workspaces: [workspace('wt-1')],
      cards: [
        card({ tabId: 'work', paneKey: 'work:l', stateChangedAt: 99 }),
        card({ tabId: 'ask', paneKey: 'ask:l', bucket: 'attention', dotState: 'blocked' })
      ]
    },
    [chatTab('work'), chatTab('ask'), chatTab('idle')]
  )

  it('keeps the first candidate still listed, else opens the first that needs the user', () => {
    expect(pickHqChat(items, [hqChatKey('wt-1', 'idle'), hqChatKey('wt-1', 'work')])).toBe(
      hqChatKey('wt-1', 'idle')
    )
    expect(pickHqChat(items, ['closed', hqChatKey('wt-1', 'work')])).toBe(hqChatKey('wt-1', 'work'))
    expect(pickHqChat(items, ['closed-long-ago', null])).toBe(hqChatKey('wt-1', 'ask'))
    expect(pickHqChat([], [null])).toBeNull()
  })
})

describe('nextHqWaitingChat', () => {
  const needs = buildHqChatList(
    {
      workspaces: [workspace('wt-1')],
      cards: ['a', 'b'].map((id, index) =>
        card({ tabId: id, paneKey: `${id}:l`, bucket: 'attention', stateChangedAt: 10 - index })
      )
    },
    [chatTab('a'), chatTab('b')]
  )

  it('steps to the next waiting chat and wraps round', () => {
    expect(nextHqWaitingChat(needs, null)).toBe(hqChatKey('wt-1', 'a'))
    expect(nextHqWaitingChat(needs, hqChatKey('wt-1', 'a'))).toBe(hqChatKey('wt-1', 'b'))
    expect(nextHqWaitingChat(needs, hqChatKey('wt-1', 'b'))).toBe(hqChatKey('wt-1', 'a'))
    expect(nextHqWaitingChat([], null)).toBeNull()
  })
})

describe('hqProjectInitials', () => {
  it('takes two words or two letters', () => {
    expect(hqProjectInitials('acme_support_service')).toBe('AS')
    expect(hqProjectInitials('orca-custom')).toBe('OC')
    expect(hqProjectInitials('HQ')).toBe('HQ')
    expect(hqProjectInitials('')).toBe('?')
  })
})
