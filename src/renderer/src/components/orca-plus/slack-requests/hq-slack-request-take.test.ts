import { describe, expect, it, vi } from 'vitest'
import type { ClickUpStatus, ClickUpTask } from '../../../../../shared/clickup-types'
import type { Repo } from '../../../../../shared/repo-types'
import type { LaunchableWorkItem } from '@/lib/launch-work-item-direct-types'
import type { HqTakenSession } from '../hq/hq-triage-decisions'

vi.mock('@/lib/clickup-linked-work-item', () => ({
  buildClickUpLinkedWorkItem: (task: { id: string }) => ({ id: task.id, linkedContext: null })
}))
vi.mock('@/lib/linked-work-item-context', () => ({ buildContainedLinkedContextBlock: () => '' }))

const { hqTaskTitleWithProject, takeHqSlackRequest } = await import('./hq-slack-request-take')

const draft = {
  id: 'D09MLEW74P7:1791963881.532369',
  title: 'Саманта: нет автоответа',
  description: 'Источник: https://lev.slack.com/archives/D09MLEW74P7/p1791963881532369',
  project: 'lh_support_ai_service',
  permalink: 'https://lev.slack.com/archives/D09MLEW74P7/p1791963881532369'
}

const inProcess: ClickUpStatus = { name: 'in proсess', color: null, type: 'custom', orderIndex: 1 }

const task: ClickUpTask = {
  id: 't1',
  customId: 'DEV-1',
  identifier: 'DEV-1',
  title: 'Саманта: нет автоответа',
  url: 'https://app.clickup.com/t/t1',
  status: { ...inProcess, name: 'future' },
  priority: null,
  assignees: [],
  dueDate: null,
  updatedAt: null,
  listId: 'l1',
  listName: null,
  spaceId: null,
  workspaceId: null,
  description: '',
  tags: [],
  creator: null,
  createdAt: null
}

const repo: Repo = {
  id: 'r1',
  path: '/p/samantha',
  displayName: 'Samantha',
  badgeColor: '',
  addedAt: 0
}

function deps(over: Record<string, unknown> = {}) {
  return {
    listPages: vi.fn(async () => [
      {
        repoId: 'r1',
        slug: 'lh_support_ai_service',
        title: 'x',
        status: null,
        group: null,
        relations: [],
        autonomy: 2 as const
      }
    ]),
    repos: (): Repo[] => [repo],
    createTask: vi.fn(async () => ({
      ok: true as const,
      taskUrl: 'https://app.clickup.com/t/t1',
      taskId: 't1'
    })),
    getTask: vi.fn(async () => task),
    listStatuses: vi.fn(async () => [inProcess]),
    setStatus: vi.fn(async () => ({ ok: true as const })),
    launchInRepo: vi.fn(
      async (
        _item: LaunchableWorkItem,
        _repo: Repo
      ): Promise<{ launched: boolean; session: HqTakenSession | null }> => ({
        launched: true,
        session: null
      })
    ),
    remember: vi.fn(async () => undefined),
    markTaken: vi.fn(async () => undefined),
    replyStyle: () => ({
      tonePath: '/hq/wiki/tone.md',
      correctionsPath: '/hq/slack-scout/corrections.jsonl'
    }),
    now: () => new Date('2026-10-16T09:00:00Z'),
    ...over
  }
}

describe('Do on a Slack request', () => {
  it('asks for a project before creating anything', async () => {
    const d = deps()
    await expect(takeHqSlackRequest({ ...draft, project: null }, d)).resolves.toEqual({
      kind: 'needs-project'
    })
    expect(d.createTask).not.toHaveBeenCalled()
  })

  it('creates nothing for a project Orca does not have open', async () => {
    const d = deps({ repos: () => [] })
    await expect(takeHqSlackRequest(draft, d)).resolves.toEqual({
      kind: 'no-repo',
      project: 'lh_support_ai_service'
    })
    expect(d.createTask).not.toHaveBeenCalled()
  })

  it('creates the task, starts Claude in the project told to answer in the thread and close, and remembers it', async () => {
    const d = deps()
    const outcome = await takeHqSlackRequest(draft, d)
    expect(outcome).toMatchObject({ kind: 'taken', identifier: 'DEV-1' })
    const item = d.launchInRepo.mock.calls[0]?.[0]
    expect(item?.pasteContent).toContain('в проекте Samantha')
    expect(item?.pasteContent).toContain('channel_id D09MLEW74P7, thread_ts 1791963881.532369')
    expect(item?.pasteContent).toContain('фактическое время с 2026-10-16T09:00:00.000Z')
    expect(item?.pasteContent).toContain('Уровень автономии проекта 2')
    expect(item?.pasteContent).toContain('Тон Глеба описан в /hq/wiki/tone.md')
    expect(item?.pasteContent).toContain('/hq/slack-scout/corrections.jsonl')
    expect(d.setStatus).toHaveBeenCalledWith('t1', 'in proсess')
    expect(d.remember).toHaveBeenCalledWith('t1', 'r1', null)
  })

  it('names the project first in the task title, and keeps a bracket the scout already wrote', async () => {
    const pages = vi.fn(async () => [
      {
        repoId: 'r1',
        slug: 'lh_support_ai_service',
        title: 'Samantha — AI-поддержка',
        status: null,
        group: null,
        relations: [],
        autonomy: 2 as const
      }
    ])
    const d = deps({ listPages: pages })
    await takeHqSlackRequest(draft, d)
    expect(d.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: '[samantha] Саманта: нет автоответа' })
    )
    expect(hqTaskTitleWithProject(' [hub mcp] Вход ', { slug: 'x', title: 'Y' })).toBe(
      '[hub mcp] Вход'
    )
  })

  it('keeps the created task when ClickUp does not hand it back, without starting Claude', async () => {
    const d = deps({ getTask: vi.fn(async () => null) })
    await expect(takeHqSlackRequest(draft, d)).resolves.toEqual({
      kind: 'created-only',
      taskUrl: 'https://app.clickup.com/t/t1'
    })
    expect(d.launchInRepo).not.toHaveBeenCalled()
  })

  it('takes the existing task a ClickUp comment is on, without creating one or a thread tail', async () => {
    const d = deps()
    const outcome = await takeHqSlackRequest(
      { ...draft, id: 'clickup:t1:c1', clickupTaskId: 't1', permalink: task.url },
      d
    )
    expect(outcome).toMatchObject({ kind: 'taken', identifier: 'DEV-1' })
    expect(d.createTask).not.toHaveBeenCalled()
    expect(d.launchInRepo.mock.calls[0]?.[0]?.pasteContent).not.toContain('thread_ts')
    expect(d.setStatus).toHaveBeenCalledWith('t1', 'in proсess')
    expect(d.markTaken).toHaveBeenCalledWith('clickup:t1:c1')
  })

  it("records nothing when the ClickUp comment's task cannot be started", async () => {
    const d = deps({
      launchInRepo: vi.fn(async () => ({ launched: false, session: null }))
    })
    await expect(
      takeHqSlackRequest({ ...draft, id: 'clickup:t1:c1', clickupTaskId: 't1' }, d)
    ).resolves.toEqual({ kind: 'not-started', taskUrl: task.url })
    expect(d.markTaken).not.toHaveBeenCalled()
  })
})
