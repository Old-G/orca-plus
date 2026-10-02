import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import {
  buildHqTodayAgents,
  buildHqTodayTasks,
  hqDaysOverdue,
  sortHqTodayWaitings
} from './hq-today'
import type { HqWaiting } from './hq-pulse-snapshot'

// 2026-10-03 12:00 local
const NOW = new Date(2026, 9, 3, 12, 0).getTime()

function card(
  paneKey: string,
  bucket: DashboardCard['bucket'],
  extra: Partial<DashboardCard> = {}
): DashboardCard {
  return {
    paneKey,
    ptyId: null,
    agentType: 'claude',
    bucket,
    dotState: 'idle',
    task: paneKey,
    repoId: 'r',
    worktreeId: 'w',
    tabId: 't',
    leafId: null,
    repoName: 'r',
    worktreeName: 'w',
    startedAt: 0,
    finishedAt: null,
    stateChangedAt: 0,
    unseen: false,
    ...extra
  }
}

function waiting(id: string, dueAt: number | null, createdAt: number): HqWaiting {
  return { id, direction: 'on-me', title: id, personId: null, project: null, dueAt, createdAt }
}

function task(id: string, dueDate: number | null): ClickUpTaskSummary {
  return {
    id,
    customId: null,
    identifier: id,
    title: id,
    url: '',
    status: { name: 'open', color: null, type: 'open', orderIndex: 0 },
    priority: null,
    assignees: [],
    dueDate,
    updatedAt: null,
    listId: null,
    listName: null,
    spaceId: null,
    workspaceId: null
  }
}

describe('HQ today', () => {
  it('puts agents waiting longest first and only unread finished ones', () => {
    const agents = buildHqTodayAgents([
      card('late', 'attention', { stateChangedAt: 20 }),
      card('early', 'attention', { stateChangedAt: 10 }),
      card('read', 'done', { unseen: false, finishedAt: 5 }),
      card('old', 'done', { unseen: true, finishedAt: 5 }),
      card('new', 'done', { unseen: true, finishedAt: 9 }),
      card('busy', 'working'),
      card('idle', 'idle')
    ])
    expect(agents.needYou.map((c) => c.paneKey)).toEqual(['early', 'late'])
    expect(agents.finished.map((c) => c.paneKey)).toEqual(['new', 'old'])
    expect(agents.working).toBe(1)
  })

  it('sorts waitings by due date, undated ones oldest first after them', () => {
    const sorted = sortHqTodayWaitings([
      waiting('undated-new', null, 30),
      waiting('due-later', NOW + 1000, 1),
      waiting('undated-old', null, 10),
      waiting('overdue', NOW - 1000, 2)
    ])
    expect(sorted.map((w) => w.id)).toEqual(['overdue', 'due-later', 'undated-old', 'undated-new'])
  })

  it('splits my tasks into overdue and due today by local day', () => {
    const tasks = buildHqTodayTasks(
      [
        task('tomorrow', new Date(2026, 9, 4, 0, 0).getTime()),
        task('tonight', new Date(2026, 9, 3, 23, 59).getTime()),
        task('this-morning', new Date(2026, 9, 3, 0, 0).getTime()),
        task('last-week', new Date(2026, 8, 26, 18, 0).getTime()),
        task('yesterday', new Date(2026, 9, 2, 23, 0).getTime()),
        task('no-date', null)
      ],
      NOW
    )
    expect(tasks.overdue.map((t) => t.id)).toEqual(['last-week', 'yesterday'])
    expect(tasks.today.map((t) => t.id)).toEqual(['this-morning', 'tonight'])
    expect(hqDaysOverdue(new Date(2026, 8, 26, 18, 0).getTime(), NOW)).toBe(7)
    expect(hqDaysOverdue(NOW + 1000, NOW)).toBe(0)
  })
})
