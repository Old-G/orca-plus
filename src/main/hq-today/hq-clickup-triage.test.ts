import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClickUpWatchedTask } from '../../shared/hq-clickup-changes'
import { readHqSlackScout } from './hq-slack-scout'
import { runHqClickUpTriage, type HqClickUpTriageDeps } from './hq-clickup-triage'

const OWNER = '100'
const T0 = 1_800_000_000_000
const HALF_HOUR = 30 * 60_000

let hq: string

beforeEach(async () => {
  hq = await mkdtemp(join(tmpdir(), 'hq-triage-'))
  await mkdir(join(hq, 'slack-scout'), { recursive: true })
  await mkdir(join(hq, 'triage'), { recursive: true })
  await writeFile(
    join(hq, 'slack-scout', 'config.yaml'),
    'clickup_triage_projects: [acme_support_service]\n'
  )
  await writeFile(join(hq, 'triage', 'acme_support_service.md'), 'Odoo пока не подключаем.\n')
})

afterEach(async () => {
  await rm(hq, { recursive: true, force: true })
})

function lucyTask(description: string, attachments: string[]): ClickUpWatchedTask {
  return {
    id: '86c166ft5',
    identifier: '86c166ft5',
    title: 'Change frequency',
    url: 'https://app.clickup.com/t/86c166ft5',
    listName: 'Onboarding template',
    creatorId: '88682116',
    watcherIds: ['700000002', OWNER],
    assigneeIds: [],
    createdAt: T0 - 1e10,
    updatedAt: T0,
    description,
    fields: '[]',
    attachments: attachments.map((id) => ({ id, userId: null }))
  }
}

function deps(
  tasks: () => ClickUpWatchedTask[],
  now: () => number,
  answer: string | null
): HqClickUpTriageDeps & { generate: ReturnType<typeof vi.fn> } {
  return {
    listUpdated: async () => ({ ownerId: OWNER, tasks: tasks() }),
    projects: async () => [{ slug: 'acme_support_service', about: 'Zenith, AI-поддержка' }],
    generate: vi.fn(async () =>
      answer === null ? { ok: false as const, error: 'down' } : { ok: true as const, text: answer }
    ),
    now
  }
}

const KNOWN = JSON.stringify([
  {
    taskId: '86c166ft5',
    project: 'acme_support_service',
    verdict: 'known',
    summary: 'Lucy дописала в инструкцию раздел про Odoo и два скрина',
    why: 'Odoo пока не подключаем',
    reply: 'Спасибо! Odoo мы пока не подключаем, Zenith меняет частоту только в Priority.'
  }
])

describe('runHqClickUpTriage', () => {
  it('learns the task first, lets Lucy’s edit settle, then raises one answer card', async () => {
    let now = T0
    let task = lucyTask('Step 1\nStep 8', [])
    const d = deps(
      () => [task],
      () => now,
      KNOWN
    )

    expect(await runHqClickUpTriage(hq, d)).toBe(0)
    task = lucyTask('Step 1\nStep 8\nOdoo:\nFind "Recurring Plan"', ['a1', 'a2'])
    now += 10 * 60_000
    expect(await runHqClickUpTriage(hq, d)).toBe(0)
    expect(d.generate).not.toHaveBeenCalled()

    now += HALF_HOUR
    expect(await runHqClickUpTriage(hq, d)).toBe(1)
    expect(d.generate).toHaveBeenCalledOnce()
    expect(String(d.generate.mock.calls[0][0])).toContain('Odoo пока не подключаем.')

    const scout = await readHqSlackScout(hq, () => now)
    expect(scout.ok && scout.drafts).toEqual([
      expect.objectContaining({
        source: 'clickup',
        clickupTaskId: '86c166ft5',
        kind: 'answer',
        project: 'acme_support_service',
        description: expect.stringContaining('Odoo мы пока не подключаем'),
        quote: 'Odoo:\nFind "Recurring Plan"'
      })
    ])

    now += 15 * 60_000
    expect(await runHqClickUpTriage(hq, d)).toBe(0)
    expect(d.generate).toHaveBeenCalledOnce()
  })

  it('sends noise to the quiet digest, not to a card', async () => {
    let now = T0
    let task = lucyTask('Step 1', [])
    const noise = JSON.stringify([{ taskId: '86c166ft5', verdict: 'noise', summary: 'опечатка' }])
    const d = deps(
      () => [task],
      () => now,
      noise
    )
    await runHqClickUpTriage(hq, d)
    task = lucyTask('Step 1\nStep 1a', [])
    now += 60_000
    await runHqClickUpTriage(hq, d)
    now += HALF_HOUR
    expect(await runHqClickUpTriage(hq, d)).toBe(0)
    const scout = await readHqSlackScout(hq, () => now)
    expect(scout.ok && scout.drafts).toEqual([])
    expect(scout.ok && scout.quiet?.map((item) => item.summary)).toEqual(['опечатка'])
  })

  it('keeps a settled change for the next pass when the model fails', async () => {
    let now = T0
    let task = lucyTask('Step 1', [])
    const d = deps(
      () => [task],
      () => now,
      null
    )
    await runHqClickUpTriage(hq, d)
    task = lucyTask('Step 1\nStep 2', [])
    now += 60_000
    await runHqClickUpTriage(hq, d)
    now += HALF_HOUR
    await expect(runHqClickUpTriage(hq, d)).rejects.toThrow('down')
    const state = JSON.parse(
      await readFile(join(hq, 'slack-scout', 'clickup-changes.json'), 'utf8')
    )
    expect(state.pending).toHaveLength(1)
  })

  it('downgrades an answer for a project the triage is not switched on for', async () => {
    await writeFile(join(hq, 'slack-scout', 'config.yaml'), 'clickup_triage_projects: []\n')
    let now = T0
    let task = lucyTask('Step 1', [])
    const d = deps(
      () => [task],
      () => now,
      KNOWN
    )
    await runHqClickUpTriage(hq, d)
    task = lucyTask('Step 1\nOdoo:', [])
    now += 60_000
    await runHqClickUpTriage(hq, d)
    now += HALF_HOUR
    await runHqClickUpTriage(hq, d)
    const scout = await readHqSlackScout(hq, () => now)
    expect(scout.ok && scout.drafts.map((draft) => [draft.kind, draft.description])).toEqual([
      ['fyi', '']
    ])
  })
})
