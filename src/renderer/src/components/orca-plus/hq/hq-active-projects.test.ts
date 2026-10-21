import { describe, expect, it } from 'vitest'
import type { Tab } from '../../../../../shared/tab-types'
import { splitHqActiveProjects } from './hq-active-projects'
import type { HqChatGroup, HqChatItem } from './hq-chat-list'

const DAY = 24 * 60 * 60 * 1000
const NOW = 100 * DAY

function chat(
  key: string,
  repoId: string,
  sortAt: number,
  group: HqChatGroup = 'quiet'
): HqChatItem {
  const tab: Tab = {
    id: key,
    entityId: `session-${key}`,
    groupId: 'group-1',
    worktreeId: `${repoId}-wt`,
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
    displayState: group === 'done' ? 'done' : 'idle',
    agentType: 'claude',
    card: null,
    repoId,
    worktreeId: tab.worktreeId,
    projectName: repoId.toUpperCase(),
    worktreeName: 'main',
    hostKind: 'local',
    sortAt
  }
}

describe('splitHqActiveProjects', () => {
  it('keeps only the latest read chat of each project worked in lately, newest project first', () => {
    const items = [
      chat('a1', 'a', NOW - 1 * DAY),
      chat('a2', 'a', NOW - 2 * DAY),
      chat('b1', 'b', NOW - 1000),
      chat('old', 'c', NOW - 10 * DAY)
    ]
    const { active, quiet } = splitHqActiveProjects(items, [], NOW)
    expect(active.map((project) => [project.repoId, project.items.map((i) => i.key)])).toEqual([
      ['b', ['b1']],
      ['a', ['a1']]
    ])
    expect(quiet.map((item) => item.key)).toEqual(['a2', 'old'])
  })

  it('beyond the last 12 hours shows at most four projects, one chat each; the rest stays quiet', () => {
    const items = ['p1', 'p2', 'p3', 'p4', 'p5'].flatMap((repo, index) =>
      Array.from({ length: 6 }, (_, n) => chat(`${repo}-${n}`, repo, NOW - DAY - index * 1000 - n))
    )
    const { active, quiet } = splitHqActiveProjects(items, [], NOW)
    expect(active.map((project) => project.repoId)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(active.every((project) => project.items.length === 1)).toBe(true)
    expect(quiet).toHaveLength(4 * 5 + 6)
  })

  it('keeps every project worked in during the last 12 hours, past the limit of four', () => {
    const hour = 60 * 60 * 1000
    const items = [1, 3, 5, 7, 10, 11.5, 13].map((hoursAgo, index) =>
      chat(`c${index}`, `p${index}`, NOW - hoursAgo * hour)
    )
    const { active } = splitHqActiveProjects(items, [], NOW)
    expect(active.map((project) => project.repoId)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5'])
  })

  it('keeps a kept project even when it went quiet long ago', () => {
    const items = [chat('old', 'c', NOW - 30 * DAY), chat('b1', 'b', NOW - 1000)]
    const { active, quiet } = splitHqActiveProjects(items, ['c', 'gone'], NOW)
    expect(active.map((project) => [project.repoId, project.kept])).toEqual([
      ['b', false],
      ['c', true]
    ])
    expect(quiet).toEqual([])
  })

  it('keeps every read chat of the last 12 hours as the project history, newest first', () => {
    const hour = 60 * 60 * 1000
    const items = [
      chat('a1', 'a', NOW - 1 * hour),
      chat('a2', 'a', NOW - 3 * hour),
      chat('a3', 'a', NOW - 13 * hour)
    ]
    const { active, quiet } = splitHqActiveProjects(items, [], NOW)
    expect(active.map((project) => project.items.map((i) => i.key))).toEqual([['a1', 'a2']])
    expect(quiet.map((item) => item.key)).toEqual(['a3'])
  })

  it('keeps a read sibling on view while another chat of the project works above', () => {
    const hour = 60 * 60 * 1000
    const items = [
      chat('working', 'a', NOW, 'working'),
      chat('read', 'a', NOW - 2 * hour),
      chat('old', 'a', NOW - 2 * DAY),
      chat('b-working', 'b', NOW, 'working'),
      chat('b-old', 'b', NOW - 2 * DAY)
    ]
    const { active, quiet } = splitHqActiveProjects(items, [], NOW)
    expect(active.map((project) => [project.repoId, project.items.map((i) => i.key)])).toEqual([
      ['a', ['read']]
    ])
    expect(quiet.map((item) => item.key)).toEqual(['old', 'b-old'])
  })

  it('leaves chats that need the user, work or are unread in their own groups', () => {
    const items = [chat('needs', 'a', NOW, 'needs'), chat('done', 'a', NOW, 'done')]
    const { active, quiet } = splitHqActiveProjects(items, [], NOW)
    expect(active).toEqual([])
    expect(quiet).toEqual([])
  })
})
