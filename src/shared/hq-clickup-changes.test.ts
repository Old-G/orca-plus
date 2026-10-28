import { describe, expect, it } from 'vitest'
import {
  CLICKUP_CHANGE_QUIET_MS,
  CLICKUP_NEW_TASK_QUIET_MS,
  diffClickUpTask,
  mergeClickUpChange,
  parseClickUpChangesState,
  snapshotOf,
  splitReadyClickUpChanges,
  type ClickUpWatchedTask
} from './hq-clickup-changes'

const OWNER = '100'
const NOW = 1_800_000_000_000

function task(overrides: Partial<ClickUpWatchedTask> = {}): ClickUpWatchedTask {
  return {
    id: 't1',
    identifier: 't1',
    title: 'Change frequency',
    url: 'https://app.clickup.com/t/t1',
    listName: 'Onboarding template',
    creatorId: '7',
    watcherIds: [OWNER],
    assigneeIds: [],
    createdAt: NOW - 1_000_000_000,
    updatedAt: NOW,
    description: 'Step 1\nStep 2',
    fields: '[]',
    attachments: [],
    ...overrides
  }
}

describe('diffClickUpTask', () => {
  it('takes a first-seen task as the baseline', () => {
    expect(diffClickUpTask(undefined, task(), OWNER, NOW - 60_000).kinds).toEqual([])
  })

  it('reports a task someone else just created, but not the owner’s own', () => {
    const fresh = task({ createdAt: NOW - 1_000 })
    expect(diffClickUpTask(undefined, fresh, OWNER, NOW - 60_000).kinds).toEqual(['created'])
    expect(
      diffClickUpTask(undefined, { ...fresh, creatorId: OWNER }, OWNER, NOW - 60_000).kinds
    ).toEqual([])
  })

  it('reports the lines a description gained and new attachments from others', () => {
    const before = snapshotOf(task(), undefined, NOW - 60_000)
    const after = task({
      description: 'Step 1\nStep 2\nOdoo:\nFind "Recurring Plan"',
      attachments: [
        { id: 'a1', userId: '7' },
        { id: 'a2', userId: OWNER }
      ]
    })
    expect(diffClickUpTask(before, after, OWNER, NOW - 60_000)).toEqual({
      kinds: ['description', 'attachments'],
      added: 'Odoo:\nFind "Recurring Plan"',
      attachmentsAdded: 1
    })
  })

  it('ignores a description that only lost lines', () => {
    const before = snapshotOf(task(), undefined, NOW - 60_000)
    expect(diffClickUpTask(before, task({ description: 'Step 1' }), OWNER, 0).kinds).toEqual([])
  })

  it('keeps known attachments when the task was not read in full', () => {
    const before = snapshotOf(task({ attachments: [{ id: 'a1', userId: '7' }] }), undefined, 0)
    expect(snapshotOf(task({ attachments: null }), before, 1).attachmentIds).toEqual(['a1'])
  })
})

describe('settling changes', () => {
  it('folds edits of one task into one change and releases it after half an hour quiet', () => {
    let pending = mergeClickUpChange(
      [],
      task(),
      { kinds: ['description'], added: 'Odoo:', attachmentsAdded: 0 },
      NOW
    )
    pending = mergeClickUpChange(
      pending,
      task(),
      { kinds: ['attachments'], added: '', attachmentsAdded: 2 },
      NOW + 60_000
    )
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      kinds: ['description', 'attachments'],
      attachmentsAdded: 2,
      firstAt: NOW,
      lastAt: NOW + 60_000
    })
    expect(splitReadyClickUpChanges(pending, NOW + 60_000).ready).toEqual([])
    expect(
      splitReadyClickUpChanges(pending, NOW + 60_000 + CLICKUP_CHANGE_QUIET_MS).ready
    ).toHaveLength(1)
  })

  // 28.10: a new task was done and closed within its half-hour wait and never reached the feed.
  it('releases a task newly set on the owner after five quiet minutes, not half an hour', () => {
    const pending = mergeClickUpChange(
      [],
      task(),
      { kinds: ['created'], added: 'Do not mirror -dev comments to Slack', attachmentsAdded: 0 },
      NOW
    )
    expect(splitReadyClickUpChanges(pending, NOW + CLICKUP_NEW_TASK_QUIET_MS - 1).ready).toEqual([])
    expect(splitReadyClickUpChanges(pending, NOW + CLICKUP_NEW_TASK_QUIET_MS).ready).toHaveLength(1)
  })
})

describe('parseClickUpChangesState', () => {
  it('reads back what it wrote and drops junk', () => {
    const state = {
      lastCheckAt: NOW,
      snapshots: { t1: snapshotOf(task(), undefined, NOW) },
      pending: mergeClickUpChange(
        [],
        task(),
        { kinds: ['fields'], added: '', attachmentsAdded: 0 },
        NOW
      )
    }
    expect(parseClickUpChangesState(JSON.stringify(state))).toEqual(state)
    expect(parseClickUpChangesState('{')).toEqual({ lastCheckAt: null, snapshots: {}, pending: [] })
    expect(
      parseClickUpChangesState(JSON.stringify({ pending: [{ taskId: 't', kinds: ['status'] }] }))
        .pending[0].kinds
    ).toEqual([])
  })
})
