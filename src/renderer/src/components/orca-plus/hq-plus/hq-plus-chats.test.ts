import { describe, expect, it } from 'vitest'
import type {
  DashboardCard,
  DashboardWorkspace
} from '../../../../../shared/agent-status/presentation/dashboard-snapshot'
import type { Tab } from '../../../../../shared/workspace-layout/tab-groups/tab-types'
import { buildHqChatList } from '../hq/hq-chat-list'
import {
  hqPlusChatIsIdle,
  hqPlusChatWaitingFor,
  hqPlusChatWaitingLabel,
  hqPlusProjectChats,
  hqPlusTerminalTabMates
} from './hq-plus-chats'

const workspace: DashboardWorkspace = {
  repoId: 'repo-1',
  worktreeId: 'wt-1',
  repoName: 'acme',
  worktreeName: 'main',
  hostKind: 'local',
  executionHostId: 'local',
  workspaceKind: 'worktree'
}

const chatTab = (id: string): Tab => ({
  id,
  entityId: `session-${id}`,
  groupId: 'group-1',
  worktreeId: 'wt-1',
  contentType: 'agent-session',
  agentSessionAgent: 'claude',
  label: 'Claude',
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: 1
})

const card = (tabId: string, bucket: DashboardCard['bucket'], at: number): DashboardCard => ({
  paneKey: `${tabId}:leaf`,
  ptyId: null,
  agentType: 'claude',
  bucket,
  dotState: bucket === 'working' ? 'working' : 'done',
  task: '',
  repoId: 'repo-1',
  worktreeId: 'wt-1',
  tabId,
  leafId: 'leaf',
  repoName: 'acme',
  worktreeName: 'main',
  startedAt: at,
  finishedAt: null,
  stateChangedAt: at,
  unseen: false
})

describe('HQ+ chats', () => {
  // Custom build (hq-stable-chat-order, owner 25.11): the column never reorders itself.
  it('keeps every chat and project in place whatever the chats do; a new chat takes the top of its project', () => {
    const beta: DashboardWorkspace = {
      ...workspace,
      repoId: 'repo-2',
      worktreeId: 'wt-2',
      repoName: 'beta'
    }
    const tab = (id: string, createdAt: number, worktreeId = 'wt-1'): Tab => ({
      ...chatTab(id),
      worktreeId,
      createdAt
    })
    const tabs = [tab('a1', 10), tab('a2', 20), tab('a3', 30), tab('b1', 15, 'wt-2')]
    const inBeta = (c: DashboardCard): DashboardCard => ({
      ...c,
      repoId: 'repo-2',
      worktreeId: 'wt-2'
    })
    const order = (side: ReturnType<typeof hqPlusProjectChats>): string[][] =>
      side.projects.map((project) => [
        project.repoId,
        ...project.items.map((item) => (item.kind === 'chat' ? item.tab.id : item.key))
      ])
    const repoOrder = ['repo-2', 'repo-1']
    const before = hqPlusProjectChats(
      buildHqChatList(
        {
          workspaces: [workspace, beta],
          cards: [
            card('a1', 'done', 100),
            card('a2', 'working', 90),
            inBeta(card('b1', 'done', 80))
          ]
        },
        tabs
      ),
      [],
      [],
      repoOrder
    )
    expect(order(before)).toEqual([
      ['repo-2', 'b1'],
      ['repo-1', 'a3', 'a2', 'a1']
    ])

    // The oldest chat starts asking, the newest starts working, beta finishes: nothing moves.
    const busy = hqPlusProjectChats(
      buildHqChatList(
        {
          workspaces: [workspace, beta],
          cards: [
            card('a1', 'attention', 500),
            card('a2', 'done', 400),
            card('a3', 'working', 600),
            { ...inBeta(card('b1', 'done', 700)), unseen: true }
          ]
        },
        tabs
      ),
      [],
      [],
      repoOrder
    )
    expect(order(busy)).toEqual(order(before))

    const opened = hqPlusProjectChats(
      buildHqChatList({ workspaces: [workspace, beta], cards: [card('a1', 'attention', 500)] }, [
        ...tabs,
        tab('a4', 40)
      ]),
      [],
      [],
      repoOrder
    )
    expect(order(opened)).toEqual([
      ['repo-2', 'b1'],
      ['repo-1', 'a4', 'a3', 'a2', 'a1']
    ])
  })

  it('lifts a marked chat out of its project and keeps it there when it starts asking', () => {
    const items = (bucket: DashboardCard['bucket']) =>
      buildHqChatList(
        {
          workspaces: [workspace],
          cards: [card('tab-a', 'working', 50), card('tab-b', bucket, 40)]
        },
        [chatTab('tab-a'), chatTab('tab-b')]
      )
    const marked = items('working').find((item) => item.key.includes('tab-b'))?.key ?? ''

    for (const bucket of ['working', 'attention'] as const) {
      const side = hqPlusProjectChats(items(bucket), [], [marked])
      expect(side.marked.map((item) => item.key)).toEqual([marked])
      expect(side.projects[0]?.items.map((item) => item.key)).not.toContain(marked)
    }
  })

  it('folds as idle only chats that finished and were read, not unread, working or just opened', () => {
    const now = 60 * 60_000
    const opened = { ...chatTab('tab-opened'), createdAt: now - 1000 }
    const items = buildHqChatList(
      {
        workspaces: [workspace],
        cards: [
          card('tab-read', 'done', 40),
          { ...card('tab-unread', 'done', 40), unseen: true },
          card('tab-working', 'working', 40)
        ]
      },
      [
        chatTab('tab-read'),
        chatTab('tab-unread'),
        chatTab('tab-working'),
        opened,
        chatTab('tab-stale')
      ]
    )

    const idle = items.filter((item) => hqPlusChatIsIdle(item, now)).map((item) => item.key)

    expect(idle).toHaveLength(2)
    expect(idle.some((key) => key.includes('tab-read'))).toBe(true)
    expect(idle.some((key) => key.includes('tab-stale'))).toBe(true)
  })

  it('keeps a row for every project with a chat open, however long it has been quiet', () => {
    const day = 24 * 60 * 60_000
    const now = 30 * day
    const projects = ['a', 'b', 'c', 'd', 'e', 'f'].map((name, index) => ({
      ...workspace,
      repoId: `repo-${name}`,
      worktreeId: `wt-${name}`,
      repoName: name,
      at: now - (index + 1) * day
    }))
    const items = buildHqChatList(
      {
        workspaces: projects,
        cards: projects.map((p) => ({
          ...card(`tab-${p.repoName}`, 'done', p.at),
          repoId: p.repoId,
          worktreeId: p.worktreeId
        }))
      },
      projects.map((p) => ({ ...chatTab(`tab-${p.repoName}`), worktreeId: p.worktreeId }))
    )

    const side = hqPlusProjectChats(items, [], [])

    expect(side.projects.map((project) => project.repoId).sort()).toEqual(
      projects.map((p) => p.repoId).sort()
    )
    expect(side.quiet).toEqual([])
  })

  // Custom build (hq-plus-all-open-chats, owner 02.11): no cap, no time window, no Quiet fold.
  it('lists every open chat under its project, however many and however old', () => {
    const day = 24 * 60 * 60_000
    const tabs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => `tab-${name}`)
    const items = buildHqChatList(
      {
        workspaces: [workspace],
        cards: tabs.map((tab, index) => card(tab, 'done', index * day))
      },
      tabs.map(chatTab)
    )

    const side = hqPlusProjectChats(items, [], [])

    expect(side.projects).toHaveLength(1)
    expect(side.projects[0]?.items).toHaveLength(tabs.length)
    expect(side.quiet).toEqual([])
  })

  // Custom build (hq-plus-close-terminal): × on a terminal agent names who closes with it.
  it('counts the other agents sharing a terminal tab, none for a native chat', () => {
    const split = { ...card('term-1', 'working', 5), paneKey: 'term-1:leaf-2', leafId: 'leaf-2' }
    const items = buildHqChatList(
      {
        cards: [
          card('term-1', 'done', 4),
          split,
          card('term-2', 'done', 3),
          card('tab-chat', 'done', 2)
        ],
        workspaces: [workspace]
      },
      [chatTab('tab-chat')]
    )
    const terminal = items.find((item) => item.key === 'term-1:leaf')
    const alone = items.find((item) => item.key === 'term-2:leaf')
    const chat = items.find((item) => item.kind === 'chat')
    expect(terminal && hqPlusTerminalTabMates(items, terminal)).toBe(1)
    expect(alone && hqPlusTerminalTabMates(items, alone)).toBe(0)
    expect(chat && hqPlusTerminalTabMates(items, chat)).toBe(0)
  })
})

// Custom build (hq-plus-chat-waiting, owner 02.11).
describe('a chat that asks to stay open', () => {
  it('reads what it waits for from the end of its last turn', () => {
    expect(
      hqPlusChatWaitingFor('Сделал макет.\n\nНе закрывай: жду твоего решения по макету.')
    ).toBe('жду твоего решения по макету')
    expect(hqPlusChatWaitingFor('Итог.\n**Не закрывай, жду ответа от Ann**')).toBe(
      'жду ответа от Ann'
    )
    expect(hqPlusChatWaitingFor("Done.\nDon't close: waiting for Bob")).toBe('waiting for Bob')
  })

  it('says nothing when the chat may be closed or the line is far above', () => {
    expect(hqPlusChatWaitingFor('Готово.\nЧат можно закрывать.')).toBeNull()
    expect(hqPlusChatWaitingFor('Не закрывай: жду Ann\na\nb\nc\nd')).toBeNull()
    expect(hqPlusChatWaitingFor(null)).toBeNull()
  })

  // Custom build (hq-plus-waiting-after-read, owner 02.11).
  it('stays «done» while unread and says «waiting» once the owner has read it', () => {
    const items = buildHqChatList(
      {
        workspaces: [workspace],
        cards: [
          { ...card('tab-unread', 'done', 40), unseen: true },
          card('tab-read', 'done', 30),
          card('tab-busy', 'working', 20)
        ]
      },
      [chatTab('tab-unread'), chatTab('tab-read'), chatTab('tab-busy')]
    )
    const of = (tab: string) => items.find((item) => item.key.includes(tab))!
    const said = 'Готово.\nНе закрывай: жду ответа от Ann'

    expect(of('tab-unread').group).toBe('done')
    expect(hqPlusChatWaitingLabel(of('tab-unread'), said)).toBeNull()
    expect(hqPlusChatWaitingLabel(of('tab-read'), said)).toBe('жду ответа от Ann')
    expect(hqPlusChatWaitingLabel(of('tab-busy'), said)).toBeNull()
  })
})
