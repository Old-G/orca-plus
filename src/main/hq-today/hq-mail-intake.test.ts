import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ClickUpComment } from '../../shared/clickup-types'
import type { HqMail } from '../../shared/hq-mail-events'
import type { PulseWaiting } from '../../shared/pulse-types'
import { collectHqMailIntake, type HqMailIntakeDeps, type HqMailTask } from './hq-mail-intake'

const NOW = 1_800_000_000_000
const OWNER = { id: '1', username: 'Owner' }
const ANN = { id: '2', username: 'Ann Lee', initials: 'AL', color: null }

const task: HqMailTask = {
  id: 'task1',
  identifier: 'task1',
  title: 'Review Auto-Hold Logic',
  url: 'https://app.clickup.com/t/task1',
  description: 'Cases where the automation did not work.',
  listId: 'L1'
}

function comment(
  id: string,
  author: { id: string; username: string },
  at: number,
  body: string
): ClickUpComment {
  return { id, body, author: { ...ANN, ...author }, createdAt: at }
}

function waiting(id: string, sourceRef: string): Pick<PulseWaiting, 'id' | 'title' | 'sourceRef'> {
  return { id, title: `hub !215: merge rule`, sourceRef }
}

async function hq(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'hq-mail-'))
  await mkdir(join(path, 'slack-scout'))
  return path
}

function deps(mails: HqMail[], overrides: Partial<HqMailIntakeDeps> = {}): HqMailIntakeDeps {
  return {
    listMailIds: async () => mails.map((mail) => mail.id),
    getMail: async (id) => mails.find((mail) => mail.id === id) ?? null,
    getTask: async () => task,
    listComments: async () => [comment('101', ANN, NOW - 5000, '@Owner I will share cases here.')],
    viewer: async () => OWNER,
    projectForList: () => 'support',
    listOpenWaitings: () => [],
    mergedBy: async () => 'Marta',
    closeWaiting: vi.fn(),
    notify: vi.fn(),
    now: () => NOW,
    ...overrides
  }
}

const merged: HqMail = {
  id: 'g1',
  from: 'gitlab@mg.gitlab.com',
  subject: 'Re: Hub (!215)',
  body: 'Merge request !215 was merged\nMerge request URL: https://gitlab.com/acme/hub/-/merge_requests/215',
  receivedAt: NOW - 60_000
}

const mention: HqMail = {
  id: 'k1',
  from: 'notifications@tasks.clickup.com',
  subject: 'Review Auto-Hold Logic',
  body: 'Ann Lee mentioned you\nhttps://app.clickup.com/t/task1?comment=101&utm_field=comment',
  receivedAt: NOW - 60_000
}

async function cards(path: string): Promise<{ id: string; ask?: string }[]> {
  return JSON.parse(await readFile(join(path, 'slack-scout', 'mail.json'), 'utf8')).drafts
}

describe('collectHqMailIntake', () => {
  it('closes the waiting that holds a merged MR, once GitLab confirms it', async () => {
    const path = await hq()
    const d = deps([merged], {
      listOpenWaitings: () => [
        waiting('w1', 'https://gitlab.com/acme/hub/-/merge_requests/215'),
        waiting('w2', 'https://gitlab.com/acme/hub/-/merge_requests/216')
      ]
    })
    await collectHqMailIntake(path, d)
    expect(d.closeWaiting).toHaveBeenCalledExactlyOnceWith('w1', 'MR !215 merged by Marta')
    expect(d.notify).toHaveBeenCalledOnce()
    // Why: a second look reads only new emails.
    await collectHqMailIntake(path, d)
    expect(d.closeWaiting).toHaveBeenCalledOnce()
  })

  it('keeps the waiting when GitLab does not show the MR merged', async () => {
    const d = deps([merged], {
      listOpenWaitings: () => [waiting('w1', 'https://gitlab.com/acme/hub/-/merge_requests/215')],
      mergedBy: async () => false
    })
    await collectHqMailIntake(await hq(), d)
    expect(d.closeWaiting).not.toHaveBeenCalled()
  })

  it('turns a ClickUp mention into the same request the ClickUp collector would make', async () => {
    const path = await hq()
    expect(await collectHqMailIntake(path, deps([mention]))).toBe(1)
    expect(await cards(path)).toMatchObject([
      { id: 'clickup:task1:101', source: 'clickup', clickupTaskId: 'task1', project: 'support' }
    ])
  })

  it('skips a mention the owner already answered or the ClickUp collector already shows', async () => {
    const answered = deps([mention], {
      listComments: async () => [
        comment('101', ANN, NOW - 5000, '@Owner I will share cases here.'),
        comment('102', OWNER, NOW - 1000, 'Thanks')
      ]
    })
    expect(await collectHqMailIntake(await hq(), answered)).toBe(0)

    const path = await hq()
    await writeFile(
      join(path, 'slack-scout', 'clickup.json'),
      JSON.stringify({ drafts: [{ id: 'clickup:task1:101', title: 'x', clickupTaskId: 'task1' }] })
    )
    expect(await collectHqMailIntake(path, deps([mention]))).toBe(0)
  })

  it('retires a card once the owner answers in ClickUp', async () => {
    const path = await hq()
    await collectHqMailIntake(path, deps([mention]))
    await collectHqMailIntake(
      path,
      deps([], {
        listComments: async () => [
          comment('101', ANN, NOW - 5000, '@Owner I will share cases here.'),
          comment('102', OWNER, NOW - 1000, 'Done')
        ]
      })
    )
    expect(await cards(path)).toEqual([])
  })

  it('makes a shared task a request to take, unless the triage already raised it', async () => {
    const shared: HqMail = {
      id: 's1',
      from: 'notifications@tasks.clickup.com',
      subject: 'Ann Lee shared a task with you',
      body: 'View task https://app.clickup.com/t/task1?utm_field=shared_with_me',
      receivedAt: NOW - 60_000
    }
    const path = await hq()
    await collectHqMailIntake(path, deps([shared]))
    expect(await cards(path)).toMatchObject([
      { id: 'clickup-task:task1', kind: 'do', ask: 'Shared with you in ClickUp' }
    ])

    const triaged = await hq()
    await writeFile(
      join(triaged, 'slack-scout', 'clickup-triage.json'),
      JSON.stringify({
        drafts: [{ id: 'clickup-change:task1:1', title: 'x', clickupTaskId: 'task1' }]
      })
    )
    expect(await collectHqMailIntake(triaged, deps([shared]))).toBe(0)
  })

  it('ignores emails older than the first look', async () => {
    const d = deps([{ ...mention, receivedAt: NOW - 2 * 24 * 60 * 60_000 }])
    expect(await collectHqMailIntake(await hq(), d)).toBe(0)
  })

  it('reads every email since the last look, not only the newest page', async () => {
    const path = await hq()
    const last = NOW - 6 * 60 * 60_000
    await writeFile(
      join(path, 'slack-scout', 'mail-state.json'),
      JSON.stringify({ lastCheckAt: last, seen: [] })
    )
    const mails = Array.from({ length: 120 }, (_, index) => ({
      ...merged,
      id: `m${index}`,
      receivedAt: NOW - index * 60_000
    }))
    const queries: string[] = []
    const read: string[] = []
    await collectHqMailIntake(
      path,
      deps(mails, {
        listMailIds: async (query, max) => {
          queries.push(query)
          return mails.slice(0, max).map((mail) => mail.id)
        },
        getMail: async (id) => {
          read.push(id)
          return mails.find((mail) => mail.id === id) ?? null
        }
      })
    )
    expect(read).toHaveLength(120)
    expect(queries[0]).toContain(`after:${Math.floor((last - 30 * 60_000) / 1000)}`)
  })
})
