import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClickUpComment, ClickUpTaskSummary, ClickUpUser } from '../../shared/clickup-types'
import {
  collectHqClickUpRequests,
  startHqClickUpRequests,
  type HqClickUpRequestsDeps
} from './hq-clickup-requests'

const HOUR = 60 * 60_000
const NOW = Date.parse('2026-10-16T09:00:00Z')

let hq: string

const user = (id: string, username: string): ClickUpUser => ({
  id,
  username,
  initials: null,
  color: null
})
const OWNER = user('1', 'Owner')
const PETYA = user('2', 'Petya')

const task = (id: string, updatedAt: number): ClickUpTaskSummary => ({
  id,
  customId: `DEV-${id}`,
  identifier: `DEV-${id}`,
  title: `Task ${id}`,
  url: `https://app.clickup.com/t/${id}`,
  status: { name: 'in process', color: null, type: 'custom', orderIndex: 1 },
  priority: null,
  assignees: [OWNER],
  dueDate: null,
  updatedAt,
  listId: 'L1',
  listName: 'AI',
  spaceId: null,
  workspaceId: null
})

const comment = (
  id: string,
  author: ClickUpUser,
  createdAt: number,
  body = 'Когда будет?'
): ClickUpComment => ({
  id,
  body,
  author,
  createdAt
})

function deps(
  tasks: ClickUpTaskSummary[],
  comments: Record<string, ClickUpComment[]>,
  now = NOW
): HqClickUpRequestsDeps {
  return {
    listMyTasks: async () => tasks,
    listComments: async (taskId) => comments[taskId] ?? [],
    viewer: async () => ({ id: OWNER.id, username: OWNER.username }),
    projectForList: (listId) => (listId === 'L1' ? 'billing' : null),
    now: () => now
  }
}

function requests(): { lastCheckAt: number; drafts: { id: string; clickupTaskId: string }[] } {
  return JSON.parse(readFileSync(join(hq, 'slack-scout', 'clickup.json'), 'utf8'))
}

beforeEach(() => {
  hq = mkdtempSync(join(tmpdir(), 'hq-clickup-requests-'))
})

afterEach(() => {
  rmSync(hq, { recursive: true, force: true })
})

describe('collectHqClickUpRequests', () => {
  it("looks back a day on the first run and turns someone else's comment into a request", async () => {
    const added = await collectHqClickUpRequests(
      hq,
      deps([task('a', NOW - HOUR), task('old', NOW - 30 * HOUR)], {
        a: [comment('c1', PETYA, NOW - 2 * HOUR)],
        old: [comment('c9', PETYA, NOW - 30 * HOUR)]
      })
    )
    expect(added).toBe(1)
    const file = requests()
    expect(file.lastCheckAt).toBe(NOW)
    expect(file.drafts).toEqual([
      expect.objectContaining({
        id: 'clickup:a:c1',
        source: 'clickup',
        clickupTaskId: 'a',
        kind: 'answer',
        channelName: 'ClickUp · DEV-a',
        author: 'Petya',
        authorId: '2',
        ask: 'Когда будет?',
        title: 'Task a',
        project: 'billing',
        permalink: 'https://app.clickup.com/t/a'
      })
    ])
  })

  it('picks the newest comment even when ClickUp lists the newest first', async () => {
    await collectHqClickUpRequests(
      hq,
      deps([task('a', NOW - HOUR)], {
        a: [comment('c2', PETYA, NOW - HOUR, 'Ау?'), comment('c1', OWNER, NOW - 2 * HOUR, 'Сделаю')]
      })
    )
    expect(requests().drafts.map((draft) => draft.id)).toEqual(['clickup:a:c2'])
  })

  it('takes only comments since the last look', async () => {
    mkdirSync(join(hq, 'slack-scout'), { recursive: true })
    writeFileSync(
      join(hq, 'slack-scout', 'clickup.json'),
      JSON.stringify({ lastCheckAt: NOW - HOUR, drafts: [] })
    )
    const added = await collectHqClickUpRequests(
      hq,
      deps([task('a', NOW - 10 * 60_000)], { a: [comment('c1', PETYA, NOW - 2 * HOUR)] })
    )
    expect(added).toBe(0)
    expect(requests().drafts).toEqual([])
  })

  it('drops the request once the owner answers on the task himself', async () => {
    await collectHqClickUpRequests(
      hq,
      deps([task('a', NOW - HOUR)], { a: [comment('c1', PETYA, NOW - HOUR)] })
    )
    const later = NOW + HOUR
    const added = await collectHqClickUpRequests(
      hq,
      deps(
        [task('a', later - 60_000)],
        { a: [comment('c1', PETYA, NOW - HOUR), comment('c2', OWNER, later - 60_000, 'Сегодня')] },
        later
      )
    )
    expect(added).toBe(0)
    expect(requests().drafts).toEqual([])
  })

  it('replaces an undecided request with the newer comment on the same task', async () => {
    await collectHqClickUpRequests(
      hq,
      deps([task('a', NOW - HOUR)], { a: [comment('c1', PETYA, NOW - HOUR)] })
    )
    const later = NOW + HOUR
    await collectHqClickUpRequests(
      hq,
      deps(
        [task('a', later - 60_000)],
        { a: [comment('c1', PETYA, NOW - HOUR), comment('c2', PETYA, later - 60_000, 'Ау?')] },
        later
      )
    )
    expect(requests().drafts.map((draft) => draft.id)).toEqual(['clickup:a:c2'])
  })

  it('forgets requests the owner already decided', async () => {
    await collectHqClickUpRequests(
      hq,
      deps([task('a', NOW - HOUR)], { a: [comment('c1', PETYA, NOW - HOUR)] })
    )
    writeFileSync(
      join(hq, 'slack-scout', 'decisions.json'),
      JSON.stringify({ 'clickup:a:c1': { decision: 'answered', at: NOW } })
    )
    await collectHqClickUpRequests(hq, deps([], {}, NOW + HOUR))
    expect(requests().drafts).toEqual([])
  })
})

describe('startHqClickUpRequests', () => {
  it("skips the agents' account, Orca+'s footer and notes that ask nothing", async () => {
    mkdirSync(join(hq, 'slack-scout'), { recursive: true })
    writeFileSync(
      join(hq, 'slack-scout', 'config.yaml'),
      'clickup_ignore_authors: [50000001]   # Acme IT\n'
    )
    const ACME_IT = user('50000001', 'Acme IT')
    const added = await collectHqClickUpRequests(
      hq,
      deps(
        [
          task('a', NOW - HOUR),
          task('b', NOW - HOUR),
          task('c', NOW - HOUR),
          task('d', NOW - HOUR)
        ],
        {
          a: [comment('c1', ACME_IT, NOW - 2 * HOUR, 'Дополнение 17.10: выкачено. Что дальше?')],
          b: [comment('c2', PETYA, NOW - 2 * HOUR, 'Готово?\n\n_↳ hub · ref abc123_')],
          c: [comment('c3', PETYA, NOW - 2 * HOUR, 'Решение CTO: включаем после доступов.')],
          d: [comment('c4', PETYA, NOW - 2 * HOUR, '@Owner глянь эталоны, пожалуйста.')]
        }
      )
    )
    expect(added).toBe(1)
    expect(requests().drafts.map((draft) => draft.id)).toEqual(['clickup:d:c4'])
  })

  it('drops a kept request whose author is ignored now', async () => {
    mkdirSync(join(hq, 'slack-scout'), { recursive: true })
    writeFileSync(
      join(hq, 'slack-scout', 'clickup.json'),
      JSON.stringify({
        lastCheckAt: NOW - HOUR,
        drafts: [
          {
            id: 'clickup:a:c1',
            source: 'clickup',
            clickupTaskId: 'a',
            authorId: '50000001',
            title: 'Task a',
            foundAt: new Date(NOW - HOUR).toISOString()
          }
        ]
      })
    )
    writeFileSync(join(hq, 'slack-scout', 'config.yaml'), 'clickup_ignore_authors: [50000001]\n')
    await collectHqClickUpRequests(hq, deps([], {}))
    expect(requests().drafts).toEqual([])
  })

  it("keeps a colleague's question when only the agents comment after it", async () => {
    mkdirSync(join(hq, 'slack-scout'), { recursive: true })
    writeFileSync(join(hq, 'slack-scout', 'config.yaml'), 'clickup_ignore_authors: [9]\n')
    await collectHqClickUpRequests(
      hq,
      deps([task('a', NOW - HOUR)], {
        a: [
          comment('c1', PETYA, NOW - 3 * HOUR, 'Когда будет?'),
          comment('c2', user('9', 'Acme IT'), NOW - 2 * HOUR, 'Отчёт: сделано то и это.')
        ]
      })
    )
    expect(requests().drafts.map((draft) => draft.id)).toEqual(['clickup:a:c1'])
  })

  it('skips while HQ is off and tells listeners only when something was added', async () => {
    vi.useFakeTimers()
    try {
      const collect = vi.fn(async () => 2)
      const onAdded = vi.fn()
      let enabled = false
      const stop = startHqClickUpRequests({
        hqPath: () => hq,
        enabled: () => enabled,
        collect,
        onAdded
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(collect).not.toHaveBeenCalled()
      enabled = true
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(collect).toHaveBeenCalledWith(hq)
      expect(onAdded).toHaveBeenCalledTimes(1)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps the owner's own comments of the last two days, with whom he answered, for the scout", async () => {
    const own = (): { comments: { link: string; to: string | null; text: string }[] } =>
      JSON.parse(readFileSync(join(hq, 'slack-scout', 'clickup-own.json'), 'utf8'))
    await collectHqClickUpRequests(
      hq,
      deps([task('a', NOW - HOUR)], {
        a: [
          comment('c3', OWNER, NOW - HOUR, 'Сделаю до пятницы\n↳ orca · ref abc123'),
          comment('c2', PETYA, NOW - 2 * HOUR, 'Когда?'),
          comment('c1', OWNER, NOW - 50 * HOUR, 'старое')
        ]
      })
    )
    expect(own().comments).toEqual([
      expect.objectContaining({
        link: 'https://app.clickup.com/t/a?comment=c3',
        to: 'Petya',
        text: 'Сделаю до пятницы'
      })
    ])
    // Why: a later look that does not fetch the task keeps what it saw, until two days pass.
    await collectHqClickUpRequests(hq, deps([], {}, NOW + HOUR))
    expect(own().comments).toHaveLength(1)
    await collectHqClickUpRequests(hq, deps([], {}, NOW + 48 * HOUR))
    expect(own().comments).toEqual([])
  })
})
