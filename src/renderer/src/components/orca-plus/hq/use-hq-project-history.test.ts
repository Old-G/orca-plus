import { describe, expect, it } from 'vitest'
import type { AiVaultSession } from '../../../../../shared/ai-vault-types'
import type { Tab } from '../../../../../shared/tab-types'
import { hqProjectHistoryChats } from './use-hq-project-history'

const WORKSPACE = '/Users/ada/repo'

function session(id: string, overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return {
    id: `claude:${id}`,
    executionHostId: 'local',
    agent: 'claude',
    sessionId: id,
    title: `Chat ${id}`,
    cwd: WORKSPACE,
    branch: 'main',
    model: null,
    filePath: `/Users/ada/.claude/projects/${id}.jsonl`,
    codexHome: null,
    createdAt: null,
    updatedAt: '2026-10-01T10:00:00.000Z',
    modifiedAt: '2026-10-01T10:00:00.000Z',
    messageCount: 4,
    totalTokens: 0,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: '',
    subagent: null,
    structuredSession: { sessionId: id, workspaceId: 'wt-1' },
    ...overrides
  }
}

function chatTab(sessionId: string): Tab {
  return {
    id: `structured-agent-session-${sessionId}`,
    entityId: sessionId,
    groupId: 'g-1',
    worktreeId: 'wt-1',
    contentType: 'agent-session',
    label: 'Chat',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

const ids = (chats: { sessionId: string }[]) => chats.map((chat) => chat.sessionId)

describe('hqProjectHistoryChats', () => {
  it('lists the workspace’s past native chats, newest first', () => {
    const chats = hqProjectHistoryChats(
      [
        session('old', { updatedAt: '2026-09-01T10:00:00.000Z' }),
        session('new', { updatedAt: '2026-10-10T10:00:00.000Z' }),
        session('elsewhere', { cwd: '/Users/ada/other' })
      ],
      [WORKSPACE],
      {}
    )
    expect(ids(chats)).toEqual(['new', 'old'])
  })

  it('leaves out chats open as tabs', () => {
    const chats = hqProjectHistoryChats([session('open'), session('closed')], [WORKSPACE], {
      'wt-1': [chatTab('open')]
    })
    expect(ids(chats)).toEqual(['closed'])
  })

  it('leaves out automated, empty, terminal and subagent sessions', () => {
    const chats = hqProjectHistoryChats(
      [
        session('kept'),
        session('script', { automated: true }),
        session('empty', { messageCount: 0 }),
        session('terminal', { structuredSession: undefined }),
        session('subagent', {
          subagent: { parentSessionId: 'kept', agentType: null, status: 'completed' }
        })
      ],
      [WORKSPACE],
      {}
    )
    expect(ids(chats)).toEqual(['kept'])
  })
})
