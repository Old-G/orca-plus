import { describe, expect, it } from 'vitest'
import type { ClickUpComment, ClickUpTask } from '../../shared/clickup-types'
import type { HqLedgerSignal } from '../../shared/hq-ledger'
import {
  hqClickUpCodeLinks,
  hqLedgerSignalOfClickUp,
  runHqClickUpLedgerReader,
  type HqClickUpLedgerDeps
} from './hq-clickup-ledger-reader'

const OWNER = { id: 'u-owner', username: 'owner' }
const ANN = { id: 'u-ann', username: 'Ann', email: null, color: null, initials: 'A' }

function task(overrides: Partial<ClickUpTask> = {}): ClickUpTask {
  return {
    id: 't1',
    customId: 'DEV-100',
    identifier: 'DEV-100',
    title: 'Shop export',
    url: 'https://app.clickup.com/t/t1',
    status: { status: 'in progress', type: 'custom', color: null },
    priority: null,
    assignees: [],
    dueDate: null,
    updatedAt: 9_905_000,
    listId: 'l1',
    listName: 'AI',
    spaceId: null,
    workspaceId: null,
    description: '',
    tags: [],
    creator: null,
    createdAt: 1_000,
    ...overrides
  } as ClickUpTask
}

const comment = (id: string, body: string, at: number, author = ANN): ClickUpComment =>
  ({ id, body, author, createdAt: at }) as ClickUpComment

const mine = task({ assignees: [{ ...ANN, id: OWNER.id, username: OWNER.username }] })

// Custom build (hq-clickup-ledger, owner 03.11): plan stage 20.4, scenarios С4–С6.
describe('ClickUp comments in the ledger', () => {
  it('С4: a question without a tag on his task is his move', () => {
    const signal = hqLedgerSignalOfClickUp(mine, comment('c1', 'Which copy?', 2_000), OWNER, 'acme')
    expect(signal).toMatchObject({
      key: 'clickup:DEV-100',
      ts: 'comment:c1',
      forOwner: true,
      fromOwner: false,
      project: 'acme',
      reader: 'clickup-api',
      link: 'https://app.clickup.com/t/t1?comment=c1'
    })
    const authored = task({ creator: { ...ANN, id: OWNER.id } })
    expect(
      hqLedgerSignalOfClickUp(authored, comment('c1', 'Which?', 1), OWNER, null)?.forOwner
    ).toBe(true)
  })

  it('С5: the same question on someone else’s task is not; a tag is on any task', () => {
    expect(
      hqLedgerSignalOfClickUp(task(), comment('c1', 'Which copy?', 1), OWNER, null)?.forOwner
    ).toBe(false)
    expect(
      hqLedgerSignalOfClickUp(task(), comment('c1', '@Owner look here', 1), OWNER, null)?.forOwner
    ).toBe(true)
  })

  it('С6: links to code are picked out for the project', () => {
    expect(
      hqClickUpCodeLinks(
        'deployed in https://gitlab.com/acme/acme-shop/-/commit/abc1234, see https://example.com/doc'
      )
    ).toEqual(['https://gitlab.com/acme/acme-shop/-/commit/abc1234,'.replace(',', '')])
  })

  it('the owner’s own comment is his line, Orca+’s footer is left to the sent reader', () => {
    expect(
      hqLedgerSignalOfClickUp(
        mine,
        comment('c2', 'Done?', 1, { ...ANN, id: OWNER.id }),
        OWNER,
        null
      )
    ).toMatchObject({ fromOwner: true, forOwner: false })
    expect(
      hqLedgerSignalOfClickUp(mine, comment('c3', 'Report\n↳ acme · ref abc123', 1), OWNER, null)
    ).toBeNull()
  })

  it('the agents’ account writes for the owner, and Slack mirrors are left out', () => {
    expect(
      hqLedgerSignalOfClickUp(
        mine,
        comment('c4', 'Report: done?', 1, { ...ANN, id: 'u-agents' }),
        OWNER,
        null,
        new Set(['u-agents'])
      )
    ).toMatchObject({ fromOwner: true, forOwner: false })
    expect(
      hqLedgerSignalOfClickUp(
        mine,
        comment('c5', '[Slack Sync] 💬 @Ann (Slack): ok?', 1),
        OWNER,
        null
      )
    ).toBeNull()
  })

  it('a pass reads his tasks and the mailed ones, replies too, oldest first, from the last look', async () => {
    const ingested: HqLedgerSignal[] = []
    const other = task({ id: 't2', customId: null, url: 'https://app.clickup.com/t/t2' })
    const deps: HqClickUpLedgerDeps = {
      listMyTasks: async () => [mine],
      watchedTasks: () => ['t2'],
      getTask: async (ref) => (ref === 't1' ? mine : other),
      listComments: async (id) =>
        id === 't1'
          ? [
              comment('old', 'before the look', 100),
              {
                ...comment(
                  'c1',
                  'deployed https://gitlab.com/acme/acme-shop/-/commit/abc',
                  9_903_000
                ),
                replyCount: 1
              }
            ]
          : [comment('c9', '@owner?', 9_904_000)],
      listReplies: async () => [comment('r1', 'ok?', 9_903_500)],
      viewer: async () => OWNER,
      ownAccounts: async () => new Set(['u-agents']),
      projectForList: () => 'acme-list',
      projectOfLinks: async (links) =>
        links.some((l) => l.includes('acme-shop')) ? 'acme-shop' : null,
      ingest: (signal) => {
        ingested.push(signal)
        return { conversationId: signal.key, step: 'new', added: true, waitingIds: [] }
      },
      now: () => 10_000_000
    }
    const result = await runHqClickUpLedgerReader(deps, { lastLookAt: 9_900_000 })
    expect(ingested.map((s) => [s.key, s.ts, s.project])).toEqual([
      ['clickup:DEV-100', 'comment:c1', 'acme-shop'],
      ['clickup:DEV-100', 'comment:r1', 'acme-list'],
      ['clickup:t2', 'comment:c9', 'acme-list']
    ])
    expect(result).toEqual({ state: { lastLookAt: 10_000_000 }, added: 3 })
  })

  it('goes on past the first 30 tasks on the next pass and closes the window where it began', async () => {
    // Why (Codex 03.11): each pass used to read the same first 30 and never the rest.
    const refs = Array.from({ length: 45 }, (_, n) => `t${n}`)
    const got: string[] = []
    let now = 10_000_000
    const deps: HqClickUpLedgerDeps = {
      listMyTasks: async () => [],
      watchedTasks: () => refs,
      getTask: async (ref) => {
        got.push(ref)
        return task({ id: ref, customId: null, url: `https://app.clickup.com/t/${ref}` })
      },
      listComments: async () => [],
      listReplies: async () => [],
      viewer: async () => OWNER,
      ownAccounts: async () => new Set(),
      projectForList: () => null,
      projectOfLinks: async () => null,
      ingest: () => ({ conversationId: 'c', step: 'new', added: true, waitingIds: [] }),
      now: () => now
    }
    const first = await runHqClickUpLedgerReader(deps, { lastLookAt: 9_900_000 })
    expect(got).toHaveLength(30)
    expect(first.state).toMatchObject({ lastLookAt: 9_900_000, windowAt: 10_000_000 })
    now = 10_300_000
    const second = await runHqClickUpLedgerReader(deps, first.state)
    expect(new Set(got).size).toBe(45)
    expect(second.state).toEqual({ lastLookAt: 10_000_000 })
  })

  // Why (Codex 03.11): a failed read used to count as read, and the cursor moved past its comments.
  it('a task that failed to read keeps the window open and is read again; one that keeps failing is let go', async () => {
    const ingested: string[] = []
    let failing = new Set(['t1', 't2'])
    let now = 10_000_000
    const deps: HqClickUpLedgerDeps = {
      listMyTasks: async () => [],
      watchedTasks: () => ['t1', 't2', 't3'],
      getTask: async (ref) => {
        if (ref === 't1' && failing.has('t1')) {
          throw new Error('ClickUp 502')
        }
        return task({ id: ref, customId: null, url: `https://app.clickup.com/t/${ref}` })
      },
      listComments: async (id) => [{ ...comment(`c-${id}`, 'done', 9_950_000), replyCount: 1 }],
      listReplies: async (id) => {
        if (id === 'c-t2' && failing.has('t2')) {
          throw new Error('ClickUp 429')
        }
        return [comment(`r-${id}`, 'ok', 9_960_000)]
      },
      viewer: async () => OWNER,
      ownAccounts: async () => new Set(),
      projectForList: () => null,
      projectOfLinks: async () => null,
      ingest: (signal) => {
        ingested.push(signal.ts)
        return { conversationId: 'c', step: 'new', added: true, waitingIds: [] }
      },
      now: () => now
    }
    const first = await runHqClickUpLedgerReader(deps, { lastLookAt: 9_900_000 })
    expect(ingested).toEqual(['comment:c-t3', 'comment:r-c-t3'])
    expect(first.state).toMatchObject({ lastLookAt: 9_900_000, windowAt: 10_000_000 })

    failing = new Set(['t1'])
    now = 10_300_000
    const second = await runHqClickUpLedgerReader(deps, first.state)
    expect(ingested.slice(2)).toEqual(['comment:c-t2', 'comment:r-c-t2'])
    expect(second.state).toMatchObject({ lastLookAt: 9_900_000, windowAt: 10_000_000 })

    now = 10_600_000
    const third = await runHqClickUpLedgerReader(deps, second.state)
    expect(third.state).toEqual({ lastLookAt: 10_000_000 })
  })
})
