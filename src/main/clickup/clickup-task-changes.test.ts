import { describe, expect, it, vi } from 'vitest'

vi.mock('./clickup-client', () => ({ withClickUpSession: vi.fn() }))

import { mapClickUpWatchedTask } from './clickup-task-changes'

describe('mapClickUpWatchedTask', () => {
  it('reads a raw ClickUp task the way the change diff needs it', () => {
    const task = mapClickUpWatchedTask({
      id: '86c166ft5',
      custom_id: null,
      name: 'Change frequency',
      url: 'https://app.clickup.com/t/86c166ft5',
      list: { id: '901507419110', name: 'Onboarding template' },
      creator: { id: 88682116 },
      watchers: [{ id: 700000002 }, { id: 700000001 }],
      assignees: [],
      date_created: '1732864199846',
      date_updated: '1792355593673',
      text_content: 'Step 1\nOdoo:',
      custom_fields: [
        { id: 'b', type: 'drop_down', value: 1 },
        { id: 'a', type: 'date', value: '1792355593673' },
        { id: 'c', type: 'short_text' }
      ],
      attachments: [{ id: 'x.png', user: { id: 700000002 } }, { id: 'y.png' }]
    })
    expect(task).toEqual({
      id: '86c166ft5',
      identifier: '86c166ft5',
      title: 'Change frequency',
      url: 'https://app.clickup.com/t/86c166ft5',
      listName: 'Onboarding template',
      creatorId: '88682116',
      watcherIds: ['700000002', '700000001'],
      assigneeIds: [],
      createdAt: 1732864199846,
      updatedAt: 1792355593673,
      description: 'Step 1\nOdoo:',
      fields: '[["b",1]]',
      attachments: [
        { id: 'x.png', userId: '700000002' },
        { id: 'y.png', userId: null }
      ]
    })
  })

  it('has no attachments for a list row, and rejects a task without an id', () => {
    expect(mapClickUpWatchedTask({ id: 't', custom_id: 'DEV-1' })).toMatchObject({
      identifier: 'DEV-1',
      attachments: null
    })
    expect(mapClickUpWatchedTask({ name: 'x' })).toBeNull()
  })
})
