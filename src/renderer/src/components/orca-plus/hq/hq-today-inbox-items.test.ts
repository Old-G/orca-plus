import { describe, expect, it } from 'vitest'
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import type { HqSlackScoutDraft } from '../../../../../shared/hq-slack-scout'
import { buildHqInboxItems, hqInboxBadge, pickHqInboxKey } from './hq-today-inbox-items'

const draft = (id: string, kind: HqSlackScoutDraft['kind']): HqSlackScoutDraft => ({
  id,
  kind,
  channelName: 'DM Вера',
  author: 'Вера',
  permalink: '',
  quote: '',
  title: 't',
  description: '',
  foundAt: '2026-10-16T09:00:00Z'
})

const task = (id: string): ClickUpTaskSummary => ({
  id,
  customId: null,
  identifier: id,
  title: `task ${id}`,
  url: '',
  status: { name: 'future', color: null, type: 'open', orderIndex: 0 },
  priority: null,
  assignees: [],
  dueDate: 1,
  updatedAt: 2,
  listId: null,
  listName: null,
  spaceId: null,
  workspaceId: null
})

const agent: DashboardCard = {
  paneKey: 'p1',
  ptyId: null,
  agentType: 'claude',
  bucket: 'attention',
  dotState: 'waiting',
  task: 'Agent',
  repoId: 'r',
  worktreeId: 'w',
  tabId: 't',
  leafId: null,
  repoName: 'zenith',
  worktreeName: 'w',
  startedAt: 0,
  stateChangedAt: 5,
  finishedAt: null,
  unseen: false
}

const empty = {
  slack: [],
  waitingAgents: [],
  ready: [],
  newTasks: [],
  due: { overdue: [], today: [] },
  reviews: []
}

describe('Today inbox items', () => {
  it('orders by urgency: Slack requests (FYIs last), agents, ready, tasks, reviews', () => {
    const items = buildHqInboxItems({
      ...empty,
      slack: [draft('C:1', 'fyi'), draft('C:2', 'do')],
      waitingAgents: [agent],
      ready: [task('r')],
      newTasks: [task('n')],
      due: { overdue: [task('o')], today: [] },
      reviews: [
        {
          provider: 'gitlab',
          ref: 'g!1',
          title: 'MR',
          url: 'u',
          author: null,
          draft: false,
          updatedAt: null
        }
      ]
    })
    expect(items.map((item) => item.key)).toEqual([
      'slack:C:2',
      'slack:C:1',
      'agent:p1',
      'ready:r',
      'new:n',
      'due:o',
      'review:u'
    ])
  })

  it('lists a task once even when it is both new and due', () => {
    const items = buildHqInboxItems({
      ...empty,
      newTasks: [task('x')],
      due: { overdue: [task('x')], today: [] }
    })
    expect(items.map((item) => item.key)).toEqual(['new:x'])
  })

  it('keeps the open item while it exists, else opens the first', () => {
    const items = buildHqInboxItems({ ...empty, newTasks: [task('a'), task('b')] })
    expect(pickHqInboxKey(items, 'new:b')).toBe('new:b')
    expect(pickHqInboxKey(items, 'new:gone')).toBe('new:a')
    expect(pickHqInboxKey([], 'x')).toBeNull()
    expect(hqInboxBadge(items[0]!)).toBe('CU')
  })
})
