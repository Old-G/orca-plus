import { describe, expect, it } from 'vitest'
import type { ClickUpStatus, ClickUpTaskSummary } from './clickup-types'
import {
  findInProcessStatus,
  hqTriagePrompt,
  pendingHqTriageTasks,
  suggestHqTriageProject
} from './hq-triage'

function status(name: string, type: ClickUpStatus['type']): ClickUpStatus {
  return { name, color: null, type, orderIndex: 0 }
}

function task(
  id: string,
  statusType: ClickUpStatus['type'],
  listId = 'list-a'
): ClickUpTaskSummary {
  return {
    id,
    customId: `DEV-${id}`,
    identifier: `DEV-${id}`,
    title: `Task ${id}`,
    url: `https://app.clickup.com/t/${id}`,
    status: status(statusType === 'open' ? 'to do' : 'in proсess', statusType),
    priority: null,
    assignees: [],
    dueDate: null,
    updatedAt: null,
    listId,
    listName: 'IT / AI',
    spaceId: 's',
    workspaceId: 'w'
  }
}

describe('HQ task triage', () => {
  it('offers only fresh tasks the owner has not taken, hidden or snoozed', () => {
    const tasks = [task('1', 'open'), task('2', 'custom'), task('3', 'open'), task('4', 'open')]
    const pending = pendingHqTriageTasks(
      tasks,
      { '3': { decision: 'hidden', at: 1 } },
      new Set(['4'])
    )
    expect(pending.map((entry) => entry.id)).toEqual(['1'])
  })

  it('suggests the project whose HQ card is bound to the task list', () => {
    const bindings = {
      'repo-api': { listId: 'list-a', listName: 'IT / API', spaceId: 's' },
      'repo-pay': { listId: 'list-b', listName: 'IT / Pay', spaceId: 's' }
    }
    expect(suggestHqTriageProject({ listId: 'list-b' }, bindings)).toBe('repo-pay')
    expect(suggestHqTriageProject({ listId: 'list-z' }, bindings)).toBeNull()
    expect(suggestHqTriageProject({ listId: null }, bindings)).toBeNull()
  })

  it('finds «in process» whether it is spelled with a Latin or a Cyrillic «с»', () => {
    expect(
      findInProcessStatus([status('to do', 'open'), status('in proсess', 'custom')])?.name
    ).toBe('in proсess')
    expect(findInProcessStatus([status('IN PROCESS', 'custom')])?.name).toBe('IN PROCESS')
    expect(findInProcessStatus([status('in progress', 'custom')])).toBeNull()
  })

  it('tells the agent how far the project lets it go', () => {
    const base = { identifier: 'DEV-1', url: 'u', projectName: 'lh-api' }
    expect(hqTriagePrompt({ ...base, level: 0 })).toContain('ничего не меняй в коде')
    expect(hqTriagePrompt({ ...base, level: 1 })).toContain('Наружу ничего не отправляй')
    expect(hqTriagePrompt({ ...base, level: 2 })).toContain('Не мержь')
  })
})
