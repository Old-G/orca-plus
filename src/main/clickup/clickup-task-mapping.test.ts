import { describe, expect, it } from 'vitest'
import {
  mapClickUpComments,
  mapClickUpFolderLists,
  mapClickUpListStatuses,
  mapClickUpTask,
  mapClickUpTasks
} from './clickup-task-mapping'

// Shape recorded from GET /task/86abc1234 on a real workspace (fields trimmed).
const TASK = {
  id: '86abc1234',
  custom_id: 'DEV-10001',
  name: 'T2-A4 · Вопросный тест как код ',
  markdown_description: '## Goal\nShip it',
  status: { status: 'in proсess', color: '#4466ff', type: 'custom', orderindex: 2 },
  date_created: '1789000000000',
  date_updated: '1790271004674',
  creator: { id: 100000001, username: 'Test User', color: '#7b68ee', initials: 'TU' },
  assignees: [{ id: 100000001, username: 'Test User', initials: 'TU', color: null }],
  tags: [{ name: 'ai' }],
  priority: { id: '2', priority: 'high', color: '#ffcc00' },
  due_date: '1790906400000',
  url: 'https://app.clickup.com/t/86abc1234',
  list: { id: '901525354617', name: 'Fixture List' },
  space: { id: '90080008453' },
  team_id: '90000001'
}

describe('ClickUp mapping', () => {
  it('maps a task with numeric ids and millisecond strings', () => {
    expect(mapClickUpTask(TASK)).toEqual({
      id: '86abc1234',
      customId: 'DEV-10001',
      identifier: 'DEV-10001',
      title: 'T2-A4 · Вопросный тест как код',
      url: 'https://app.clickup.com/t/86abc1234',
      status: { name: 'in proсess', color: '#4466ff', type: 'custom', orderIndex: 2 },
      priority: { label: 'high', color: '#ffcc00' },
      assignees: [{ id: '100000001', username: 'Test User', initials: 'TU', color: null }],
      dueDate: 1790906400000,
      updatedAt: 1790271004674,
      listId: '901525354617',
      listName: 'Fixture List',
      spaceId: '90080008453',
      workspaceId: '90000001',
      description: '## Goal\nShip it',
      tags: ['ai'],
      creator: { id: '100000001', username: 'Test User', initials: 'TU', color: '#7b68ee' },
      createdAt: 1789000000000
    })
  })

  it('falls back to the task id when the workspace has no custom ids', () => {
    const summary = mapClickUpTasks({ tasks: [{ ...TASK, custom_id: null }] }).tasks[0]
    expect(summary?.identifier).toBe('86abc1234')
  })

  it('drops malformed tasks and treats a short page as the last one', () => {
    const result = mapClickUpTasks({ tasks: [TASK, { id: 'x' }, null] })
    expect(result.tasks).toHaveLength(1)
    expect(result.lastPage).toBe(true)
  })

  it('reads unknown status types as custom', () => {
    const task = mapClickUpTask({ ...TASK, status: { status: 'odd', type: 'weird' } })
    expect(task?.status.type).toBe('custom')
  })

  it('orders list statuses and flattens folder lists', () => {
    expect(
      mapClickUpListStatuses({
        statuses: [
          { status: 'check', type: 'done', orderindex: 3 },
          { status: 'future', type: 'open', orderindex: 0 }
        ]
      }).map((status) => status.name)
    ).toEqual(['future', 'check'])
    expect(
      mapClickUpFolderLists({
        folders: [{ name: 'Priority', lists: [{ id: 1, name: 'Bugs' }] }]
      })
    ).toEqual([{ id: '1', name: 'Bugs', folderName: 'Priority' }])
  })

  it('maps comments', () => {
    expect(
      mapClickUpComments({
        comments: [{ id: '9', comment_text: 'hi', user: { id: 1, username: 'a' }, date: '5' }]
      })
    ).toEqual([
      {
        id: '9',
        body: 'hi',
        author: { id: '1', username: 'a', initials: null, color: null },
        createdAt: 5
      }
    ])
  })
})
