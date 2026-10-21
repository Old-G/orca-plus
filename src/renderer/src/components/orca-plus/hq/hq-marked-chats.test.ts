import { describe, expect, it } from 'vitest'
import type { Tab } from '../../../../../shared/tab-types'
import { groupHqChats, type HqChatGroup, type HqChatItem } from './hq-chat-list'
import { splitHqMarkedChats } from './hq-marked-chats'

function chat(key: string, group: HqChatGroup, sortAt: number): HqChatItem {
  const tab: Tab = {
    id: key,
    entityId: `session-${key}`,
    groupId: 'group-1',
    worktreeId: 'wt',
    contentType: 'agent-session',
    agentSessionAgent: 'claude',
    label: 'Claude',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: sortAt
  }
  return {
    key,
    kind: 'chat',
    tab,
    group,
    displayState: 'idle',
    agentType: 'claude',
    card: null,
    repoId: 'repo',
    worktreeId: 'wt',
    projectName: 'REPO',
    worktreeName: 'main',
    hostKind: 'local',
    sortAt
  }
}

describe('splitHqMarkedChats', () => {
  const groups = groupHqChats([
    chat('needs', 'needs', 5),
    chat('working', 'working', 4),
    chat('done', 'done', 3),
    chat('quiet-old', 'quiet', 1),
    chat('quiet-new', 'quiet', 2)
  ])

  it('moves marked chats to their own section, newest first', () => {
    const split = splitHqMarkedChats(groups, ['quiet-old', 'working', 'gone'])
    expect(split.marked.map((item) => item.key)).toEqual(['working', 'quiet-old'])
    expect(split.groups.working).toEqual([])
    expect(split.groups.quiet.map((item) => item.key)).toEqual(['quiet-new'])
    expect(split.groups.done.map((item) => item.key)).toEqual(['done'])
  })

  it('leaves a marked chat that needs the user in Needs you', () => {
    const split = splitHqMarkedChats(groups, ['needs'])
    expect(split.marked).toEqual([])
    expect(split.groups.needs.map((item) => item.key)).toEqual(['needs'])
  })

  it('returns the groups untouched when nothing is marked', () => {
    expect(splitHqMarkedChats(groups, []).groups).toBe(groups)
  })
})
