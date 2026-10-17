import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { Repo } from '../../../../../shared/repo-types'
import type { LaunchableWorkItem } from '@/lib/launch-work-item-direct-types'
import type * as TakeModule from './hq-triage-take'

const mocks = vi.hoisted(() => {
  const built: LaunchableWorkItem[] = []
  return {
    built,
    remember: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined)
  }
})

vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ settings: {}, repos: [], worktreesByRepo: {} }) }
}))
vi.mock('./hq-triage-decisions', () => ({
  rememberHqTake: mocks.remember,
  patchHqTriageDecision: mocks.patch
}))
vi.mock('./hq-take-launch', () => ({
  launchHqTakeInRepo: async () => ({ launched: true, session: null })
}))
vi.mock('./hq-triage-take', async (importOriginal) => {
  const actual = await importOriginal<typeof TakeModule>()
  return {
    ...actual,
    takeHqTriageTask: async (
      _task: ClickUpTaskSummary,
      build: (full: null) => LaunchableWorkItem,
      deps: {
        launch: (item: LaunchableWorkItem) => Promise<boolean>
        remember: () => Promise<unknown>
      }
    ) => {
      const item = build(null)
      mocks.built.push(item)
      await deps.launch(item)
      await deps.remember()
      return { launched: true, status: { kind: 'set' } }
    }
  }
})

import { HQ_NIGHT_SHIFT_NOTE, runHqTake } from './hq-triage-run-take'

const task: ClickUpTaskSummary = {
  id: 't1',
  customId: 'DEV-1',
  identifier: 'DEV-1',
  title: 'Fix it',
  url: 'https://app.clickup.com/t/t1',
  status: { name: 'open', type: 'open', color: null, orderIndex: 0 },
  priority: null,
  assignees: [],
  dueDate: null,
  updatedAt: null,
  listId: 'l1',
  listName: 'List',
  spaceId: null,
  workspaceId: null
}

const repos: Repo[] = [
  { id: 'r1', path: '/repo/app', displayName: 'app', badgeColor: '#000', addedAt: 0, kind: 'git' }
]

beforeEach(() => {
  mocks.built.length = 0
  vi.clearAllMocks()
})

describe('runHqTake at night', () => {
  it('caps a level-3 project at 1, adds the night note and marks the task as night work', async () => {
    await runHqTake(task, ['r1'], { sourceContext: null, repos, levelOf: () => 3, night: true })
    const prompt = mocks.built[0]?.pasteContent ?? ''
    expect(prompt).toContain('Уровень автономии проекта 1')
    expect(prompt).not.toContain('смержи')
    expect(prompt).toContain(HQ_NIGHT_SHIFT_NOTE)
    expect(mocks.patch).toHaveBeenCalledWith('t1', { night: true })
  })

  it('keeps the project level and adds no note by day', async () => {
    await runHqTake(task, ['r1'], { sourceContext: null, repos, levelOf: () => 3 })
    const prompt = mocks.built[0]?.pasteContent ?? ''
    expect(prompt).toContain('Уровень автономии проекта 3')
    expect(prompt).not.toContain(HQ_NIGHT_SHIFT_NOTE)
    expect(mocks.patch).not.toHaveBeenCalled()
  })
})
