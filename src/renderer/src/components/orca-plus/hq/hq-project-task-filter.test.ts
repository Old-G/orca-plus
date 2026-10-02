// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import {
  filterHqTasks,
  hqStatusOptions,
  readHqTaskFilter,
  toggleHqStatus,
  writeHqTaskFilter
} from './hq-project-task-filter'

function task(id: string, status: string, orderIndex: number): ClickUpTaskSummary {
  return {
    id,
    customId: null,
    identifier: id,
    title: id,
    url: '',
    status: { name: status, color: null, type: 'custom', orderIndex },
    priority: null,
    assignees: [],
    dueDate: null,
    updatedAt: null,
    listId: null,
    listName: null,
    spaceId: null,
    workspaceId: null
  }
}

const TASKS = [task('a', 'wait', 2), task('b', 'in process', 1), task('c', 'Wait', 2)]

afterEach(() => window.localStorage.clear())

describe('hq project task filter', () => {
  it('lists the statuses present, in list order, with counts', () => {
    expect(hqStatusOptions(TASKS).map((o) => [o.status.name, o.count])).toEqual([
      ['in process', 1],
      ['wait', 2]
    ])
  })

  it('shows every task with no status chosen, and ignores a status no task has', () => {
    expect(filterHqTasks(TASKS, []).map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(filterHqTasks(TASKS, ['WAIT']).map((t) => t.id)).toEqual(['a', 'c'])
    expect(filterHqTasks(TASKS, ['gone']).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('toggles a status by name, ignoring case', () => {
    expect(toggleHqStatus(['wait'], 'Wait')).toEqual([])
    expect(toggleHqStatus(['wait'], 'future')).toEqual(['wait', 'future'])
  })

  it('remembers the filter per project, defaulting to my tasks', () => {
    expect(readHqTaskFilter('shop')).toEqual({ scope: 'mine', statuses: [] })
    writeHqTaskFilter('shop', { scope: 'all', statuses: ['wait'] })
    writeHqTaskFilter('blog', { scope: 'mine', statuses: [] })
    expect(readHqTaskFilter('shop')).toEqual({ scope: 'all', statuses: ['wait'] })
    window.localStorage.setItem('orca-plus.hq.project-task-filter', 'not json')
    expect(readHqTaskFilter('shop')).toEqual({ scope: 'mine', statuses: [] })
  })
})
