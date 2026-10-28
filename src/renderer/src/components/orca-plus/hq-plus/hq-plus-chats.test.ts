import { describe, expect, it } from 'vitest'
import type { DashboardCard, DashboardWorkspace } from '../../../../../shared/dashboard-snapshot'
import type { Tab } from '../../../../../shared/tab-types'
import { structuredAgentSessionTabId } from '../../../../../shared/structured-agent-session-projection'
import { buildHqChatList } from '../hq/hq-chat-list'
import { hqPlusChatIsIdle, hqPlusChatOfSession, hqPlusProjectChats } from './hq-plus-chats'

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
  it('lists chats under their project, the project that waits on the owner first', () => {
    const other: DashboardWorkspace = {
      ...workspace,
      repoId: 'repo-2',
      worktreeId: 'wt-2',
      repoName: 'beta'
    }
    const fresh = structuredAgentSessionTabId('claude_new')
    const asking = { ...chatTab('tab-ask'), worktreeId: 'wt-2' }
    const items = buildHqChatList(
      {
        workspaces: [workspace, other],
        cards: [
          card(fresh, 'working', 50),
          card('tab-old', 'done', 40),
          { ...card('tab-ask', 'attention', 30), repoId: 'repo-2', worktreeId: 'wt-2' }
        ]
      },
      [chatTab(fresh), chatTab('tab-old'), asking]
    )

    const side = hqPlusProjectChats(items, [], [], 60)

    expect(side.projects.map((project) => project.repoId)).toEqual(['repo-2', 'repo-1'])
    expect(side.projects[1]?.items[0]?.key).toContain(fresh)
    expect(hqPlusChatOfSession(items, 'claude_new')?.group).toBe('working')
    expect(hqPlusChatOfSession(items, 'claude_gone')).toBeNull()
  })

  it('lifts a marked chat out of its project', () => {
    const items = buildHqChatList(
      {
        workspaces: [workspace],
        cards: [card('tab-a', 'working', 50), card('tab-b', 'working', 40)]
      },
      [chatTab('tab-a'), chatTab('tab-b')]
    )
    const marked = items.find((item) => item.key.includes('tab-b'))?.key ?? ''

    const side = hqPlusProjectChats(items, [], [marked], 60)

    expect(side.marked.map((item) => item.key)).toEqual([marked])
    expect(side.projects[0]?.items.map((item) => item.key)).not.toContain(marked)
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
})
