import { describe, expect, it } from 'vitest'
import type { ClickUpStatus, ClickUpTaskSummary } from './clickup-types'
import {
  findInProcessStatus,
  hqAuthorAnswered,
  hqTasksAwaitingAuthor,
  restoreFirstQuestionNumber,
  withHqTakeEffort,
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

  it('waits on the author only for asked tasks still in their first status', () => {
    const tasks = [task('1', 'open'), task('2', 'open'), task('3', 'custom')]
    const decisions = {
      '1': { decision: 'asked' as const, at: 5 },
      '3': { decision: 'asked' as const, at: 5 }
    }
    expect(hqTasksAwaitingAuthor(tasks, decisions).map((entry) => entry.id)).toEqual(['1'])
    expect(pendingHqTriageTasks(tasks, decisions, new Set()).map((entry) => entry.id)).toEqual([
      '2'
    ])
  })

  it('counts as an answer only a later comment from someone other than the owner', () => {
    const comment = (authorId: string | null, createdAt: number | null) => ({
      id: `${authorId}-${createdAt}`,
      body: 'x',
      author: authorId ? { id: authorId, username: authorId, initials: null, color: null } : null,
      createdAt
    })
    expect(hqAuthorAnswered([comment('me', 20), comment('ann', 5)], 10, 'me')).toBe(false)
    expect(hqAuthorAnswered([comment(null, 20), comment('ann', null)], 10, 'me')).toBe(false)
    expect(hqAuthorAnswered([comment('ann', 20)], 10, 'me')).toBe(true)
  })

  it('gives the first question back its number only when the list goes on with 2.', () => {
    expect(restoreFirstQuestionNumber('Какой формат?\n2. Какие поля?')).toBe(
      '1. Какой формат?\n2. Какие поля?'
    )
    expect(restoreFirstQuestionNumber('1. A\n2. B')).toBe('1. A\n2. B')
    expect(restoreFirstQuestionNumber('Один вопрос')).toBe('Один вопрос')
    expect(restoreFirstQuestionNumber('Intro\n- B')).toBe('Intro\n- B')
  })

  it('pins effort on the owner’s own model without dropping his other choices', () => {
    expect(
      withHqTakeEffort({
        claude: {
          model: 'opus[1m]',
          valuesByModel: { 'opus[1m]': { fastMode: true, effort: 'low' } }
        },
        codex: { model: 'gpt' }
      })
    ).toEqual({
      claude: {
        model: 'opus[1m]',
        valuesByModel: { 'opus[1m]': { fastMode: true, effort: 'high' } }
      },
      codex: { model: 'gpt' }
    })
    expect(withHqTakeEffort(undefined).claude?.model).toBe('opus')
  })
})
