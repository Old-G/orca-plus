import { describe, expect, it } from 'vitest'
import type { DashboardCard, DashboardWorkspace } from '../../../../../shared/dashboard-snapshot'
import type { Tab } from '../../../../../shared/tab-types'
import { structuredAgentSessionTabId } from '../../../../../shared/structured-agent-session-projection'
import { buildHqChatList } from '../hq/hq-chat-list'
import { hqPlusChatOfSession, hqPlusSideChats } from './hq-plus-chats'

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
  it('lists a chat started a moment ago, before the journal knows it, working ones first', () => {
    const fresh = structuredAgentSessionTabId('claude_new')
    const items = buildHqChatList(
      {
        workspaces: [workspace],
        cards: [card(fresh, 'working', 50), card('tab-old', 'done', 40)]
      },
      [chatTab(fresh), chatTab('tab-old')]
    )

    const side = hqPlusSideChats(items, 60)

    expect(side.map((item) => item.key)[0]).toContain(fresh)
    expect(hqPlusChatOfSession(items, 'claude_new')?.group).toBe('working')
    expect(hqPlusChatOfSession(items, 'claude_gone')).toBeNull()
  })

  it('keeps a chat opened a moment ago with no turn yet above finished ones', () => {
    const opened = { ...chatTab('tab-opened'), createdAt: 990 }
    const items = buildHqChatList(
      { workspaces: [workspace], cards: [card('tab-old', 'done', 40)] },
      [opened, chatTab('tab-old')]
    )

    expect(hqPlusSideChats(items, 1000)[0]?.key).toContain('tab-opened')
  })
})
