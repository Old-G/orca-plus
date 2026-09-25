import { describe, expect, it } from 'vitest'
import {
  mapClickUpComments,
  mapClickUpFolderLists,
  mapClickUpListStatuses,
  mapClickUpTask,
  mapClickUpTasks
} from './clickup-task-mapping'

// Shape recorded from GET /task/86cbcnw23 on a real workspace (fields trimmed).
const TASK = {
  id: '86cbcnw23',
  custom_id: 'DEV-17089',
  name: 'T2-A4 · Вопросный тест как код ',
  markdown_description: '## Goal\nShip it',
  status: { status: 'in proсess', color: '#4466ff', type: 'custom', orderindex: 2 },
  date_created: '1789000000000',
  date_updated: '1790271004674',
  creator: { id: 100539875, username: 'Gleb Zavalov', color: '#7b68ee', initials: 'GZ' },
  assignees: [{ id: 100539875, username: 'Gleb Zavalov', initials: 'GZ', color: null }],
  tags: [{ name: 'ai' }],
  priority: { id: '2', priority: 'high', color: '#ffcc00' },
  due_date: '1790906400000',
  url: 'https://app.clickup.com/t/86cbcnw23',
  list: { id: '901525354617', name: 'IT Transformation' },
  space: { id: '90080008453' },
  team_id: '31632516'
}

describe('ClickUp mapping', () => {
  it('maps a task with numeric ids and millisecond strings', () => {
    expect(mapClickUpTask(TASK)).toEqual({
      id: '86cbcnw23',
      customId: 'DEV-17089',
      identifier: 'DEV-17089',
      title: 'T2-A4 · Вопросный тест как код',
      url: 'https://app.clickup.com/t/86cbcnw23',
      status: { name: 'in proсess', color: '#4466ff', type: 'custom', orderIndex: 2 },
      priority: { label: 'high', color: '#ffcc00' },
      assignees: [{ id: '100539875', username: 'Gleb Zavalov', initials: 'GZ', color: null }],
      dueDate: 1790906400000,
      updatedAt: 1790271004674,
      listId: '901525354617',
      listName: 'IT Transformation',
      spaceId: '90080008453',
      workspaceId: '31632516',
      description: '## Goal\nShip it',
      tags: ['ai'],
      creator: { id: '100539875', username: 'Gleb Zavalov', initials: 'GZ', color: '#7b68ee' },
      createdAt: 1789000000000
    })
  })

  it('falls back to the task id when the workspace has no custom ids', () => {
    const summary = mapClickUpTasks({ tasks: [{ ...TASK, custom_id: null }] }).tasks[0]
    expect(summary?.identifier).toBe('86cbcnw23')
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
