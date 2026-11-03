import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import type { HqLedgerGuess } from '../orca-plus/pulse/pulse-ledger'
import {
  HQ_GITLAB_TODO_READER,
  hqGitLabIsBot,
  hqLedgerSignalOfTodo,
  parseHqGitLabTodos,
  runHqGitLabTodoReader,
  type HqGitLabTodoDeps
} from './hq-gitlab-todo-reader'

const NOW = Date.parse('2026-10-31T12:00:00Z')
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const OWNER = 'owner1'

const open: PulseDb[] = []
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

type Over = {
  id?: number
  action?: string
  author?: string
  name?: string
  state?: string
  repo?: string
  iid?: number
  at?: number
  body?: string
  type?: string
  /** Who opened the MR. */
  mrAuthor?: string
}

/** One to-do as `glab api todos` lists it, with only the fields the reader reads. */
function todo(over: Over = {}): Record<string, unknown> {
  const repo = over.repo ?? 'acme/app'
  const iid = over.iid ?? 7
  return {
    id: over.id ?? 100,
    action_name: over.action ?? 'review_requested',
    target_type: over.type ?? 'MergeRequest',
    target_url: `https://gitlab.com/${repo}/-/merge_requests/${iid}`,
    target: {
      iid,
      title: 'Speed up the import',
      state: over.state ?? 'opened',
      author: { username: over.mrAuthor ?? 'ann' }
    },
    project: { path_with_namespace: repo },
    author: { username: over.author ?? 'ann', name: over.name ?? 'Ann' },
    body: over.body ?? 'Speed up the import',
    state: 'pending',
    created_at: new Date(over.at ?? NOW - HOUR).toISOString()
  }
}

function setup(
  pages: unknown[][],
  options: { bots?: string[]; projects?: string[]; guess?: HqLedgerGuess | null } = {}
) {
  let id = 0
  const db = new PulseDb(':memory:', { now: () => NOW, newId: () => `id-${++id}` })
  open.push(db)
  const guessed: string[] = []
  let listed = pages
  const deps: HqGitLabTodoDeps = {
    enabled: () => true,
    listPending: async (page) => listed[page - 1] ?? [],
    owner: async () => OWNER,
    bots: async () => options.bots ?? [],
    projects: async () => options.projects ?? [],
    ingest: (signal) => db.ingestLedgerSignal(signal),
    lastDirection: (key) => db.lastLedgerDirection(key),
    openKeys: () => db.listLedgerOpenKeys(HQ_GITLAB_TODO_READER),
    close: (key) => void db.closeLedgerConversation(key),
    guess: async (item) => {
      guessed.push(item.id)
      return options.guess ?? null
    },
    setGuess: (conversationId, value) => db.setLedgerGuess(conversationId, value),
    now: () => NOW
  }
  const rows = () => db.listLedgerConversations()
  return { db, deps, guessed, rows, list: (next: unknown[][]) => (listed = next) }
}

const MR = 'gitlab:acme/app!7'
const ctx = { owner: OWNER, bots: new Set<string>(), project: null, exists: false }
const one = (over: Over) => parseHqGitLabTodos([todo(over)])[0]!

describe('GitLab to-do signal', () => {
  it('reads a review request on an open MR as the owner’s move, keyed by the MR', () => {
    expect(hqLedgerSignalOfTodo(one({}), ctx)).toMatchObject({
      key: MR,
      ts: 'todo:100',
      at: NOW - HOUR,
      author: 'Ann',
      authorId: 'ann',
      fromOwner: false,
      forOwner: true,
      link: 'https://gitlab.com/acme/app/-/merge_requests/7',
      reader: 'gitlab-todos',
      title: 'Review requested: Speed up the import'
    })
  })

  it('tells a person’s mention from a bot’s, by GitLab’s naming or HQ’s list', () => {
    const forOwner = (over: Over, bots: string[] = []) =>
      hqLedgerSignalOfTodo(one({ action: 'mentioned', ...over }), {
        ...ctx,
        bots: new Set(bots)
      })?.forOwner
    expect(forOwner({ author: 'ann' })).toBe(true)
    expect(forOwner({ author: 'project_123_bot_9f2a' })).toBe(false)
    expect(forOwner({ author: 'review-bot' })).toBe(false)
    expect(forOwner({ author: 'acme-mcp' }, ['acme-mcp'])).toBe(false)
    // «robot» and «abbott» are people's names, not bots.
    expect(hqGitLabIsBot('abbott', new Set())).toBe(false)
    expect(hqGitLabIsBot('service_account_group_1', new Set())).toBe(true)
  })

  it('reads an ask on a merged MR as news, and a comment that turns to him as his move', () => {
    expect(hqLedgerSignalOfTodo(one({ state: 'merged' }), ctx)?.forOwner).toBe(false)
    const addressed = one({ action: 'directly_addressed', author: 'acme-mcp', state: 'merged' })
    expect(hqLedgerSignalOfTodo(addressed, { ...ctx, bots: new Set(['acme-mcp']) })).toMatchObject({
      forOwner: true,
      title: 'Addressed to you: Speed up the import'
    })
  })

  // Custom build (hq-ledger-own-mrs, plan 20.5): scenarios С7–С9, by who opened the MR.
  it('С7: a reviewer turning to him on his open MR is his move', () => {
    const asks = (over: Over) =>
      hqLedgerSignalOfTodo(one({ mrAuthor: OWNER, author: 'bob', ...over }), ctx)?.forOwner
    expect(asks({ action: 'directly_addressed', body: 'please fix the import here' })).toBe(true)
    expect(asks({ action: 'mentioned', body: '@owner1 why this?' })).toBe(true)
    expect(asks({ action: 'review_submitted', body: 'two notes inline' })).toBe(true)
  })

  it('С8: his MR merged, closed, approved or a GitLab notice on it is not', () => {
    const asks = (over: Over) =>
      hqLedgerSignalOfTodo(one({ mrAuthor: OWNER, author: 'bob', ...over }), ctx)?.forOwner
    expect(asks({ action: 'mentioned', state: 'merged', body: 'merged, thanks @owner1' })).toBe(
      false
    )
    expect(asks({ action: 'directly_addressed', state: 'closed' })).toBe(false)
    expect(asks({ action: 'review_submitted', body: '' })).toBe(false)
    expect(asks({ action: 'unmergeable' })).toBe(false)
    expect(asks({ action: 'build_failed' })).toBe(false)
    expect(asks({ action: 'mentioned', author: 'project_12_bot_ab' })).toBe(false)
  })

  it('С9: a review asked of him on someone else’s MR is his move, named by its repo', () => {
    expect(
      hqLedgerSignalOfTodo(
        one({ action: 'review_requested', mrAuthor: 'bob', repo: 'acme/shop' }),
        {
          ...ctx,
          project: 'shop'
        }
      )
    ).toMatchObject({ forOwner: true, project: 'shop', key: 'gitlab:acme/shop!7' })
  })

  it('takes the owner’s own words only into an MR that is a conversation already', () => {
    const own = one({ action: 'mentioned', author: OWNER, name: 'Owner' })
    expect(hqLedgerSignalOfTodo(own, ctx)).toBeNull()
    expect(hqLedgerSignalOfTodo(own, { ...ctx, exists: true })).toMatchObject({
      fromOwner: true,
      forOwner: false
    })
    // GitLab names the MR's author on its notice that the owner's MR cannot merge: his own, no card.
    const conflict = one({ action: 'unmergeable', author: OWNER })
    expect(hqLedgerSignalOfTodo(conflict, ctx)).toBeNull()
    expect(hqLedgerSignalOfTodo(conflict, { ...ctx, exists: true })).toMatchObject({
      fromOwner: true,
      forOwner: false
    })
  })

  it('leaves out to-dos on anything but an MR', () => {
    expect(hqLedgerSignalOfTodo(one({ type: 'Issue' }), ctx)).toBeNull()
  })
})

describe('GitLab to-do reader', () => {
  it('on the first pass takes the week’s asks and the day’s mentions, then by the last pass', async () => {
    const { deps, rows, list } = setup([
      [
        todo({ id: 1, iid: 1, at: NOW - 6 * DAY }),
        todo({ id: 2, iid: 2, at: NOW - 8 * DAY }),
        todo({ id: 3, iid: 3, action: 'mentioned', at: NOW - 23 * HOUR }),
        todo({ id: 4, iid: 4, action: 'mentioned', at: NOW - 25 * HOUR })
      ]
    ])
    const state = await runHqGitLabTodoReader(deps, { cursor: 0 })
    expect(rows().map((row) => [row.key, row.state])).toEqual([
      ['gitlab:acme/app!1', 'you'],
      ['gitlab:acme/app!3', 'you']
    ])
    expect(state.cursor).toBe(NOW)

    list([[todo({ id: 5, iid: 5, action: 'mentioned', at: NOW - 3 * HOUR })]])
    await runHqGitLabTodoReader(deps, { cursor: NOW - 2 * HOUR })
    expect(rows().map((row) => row.key)).not.toContain('gitlab:acme/app!5')
    list([[todo({ id: 6, iid: 6, action: 'mentioned', at: NOW - 5 * 60_000 })]])
    await runHqGitLabTodoReader(deps, { cursor: NOW - 2 * 60_000 })
    expect(rows().map((row) => row.key)).toContain('gitlab:acme/app!6')
  })

  it('reads the same list twice into nothing new', async () => {
    const { deps, rows } = setup([[todo({})]])
    await runHqGitLabTodoReader(deps, { cursor: 0 })
    await runHqGitLabTodoReader(deps, { cursor: 0 })
    expect(rows()).toMatchObject([{ key: MR, messages: 1, state: 'you' }])
  })

  it('closes a conversation once its to-do left the list, and a new to-do opens it again', async () => {
    const { deps, rows, list } = setup([[todo({ id: 1 }), todo({ id: 2, iid: 8 })]])
    await runHqGitLabTodoReader(deps, { cursor: 0 })
    list([[todo({ id: 2, iid: 8 })]])
    await runHqGitLabTodoReader(deps, { cursor: NOW })
    expect(rows().map((row) => [row.key, row.state])).toEqual([
      [MR, 'done'],
      ['gitlab:acme/app!8', 'you']
    ])
    list([[todo({ id: 3, action: 'mentioned', at: NOW })]])
    await runHqGitLabTodoReader(deps, { cursor: NOW })
    expect(rows().find((row) => row.key === MR)?.state).toBe('you')
  })

  it('closes nothing when the list ran past its page guard or was not a list', async () => {
    const full = Array.from({ length: 100 }, (_, index) => todo({ id: 1000 + index, iid: 9 }))
    const { deps, rows, list } = setup([[todo({ id: 1 })]])
    await runHqGitLabTodoReader(deps, { cursor: 0 })
    list([full, full, full, full, full])
    await runHqGitLabTodoReader(deps, { cursor: NOW })
    expect(rows().find((row) => row.key === MR)?.state).toBe('you')

    deps.listPending = async () => ({ message: '401 Unauthorized' })
    await expect(runHqGitLabTodoReader(deps, { cursor: NOW })).rejects.toThrow(/list of to-dos/)
    expect(rows().find((row) => row.key === MR)?.state).toBe('you')
  })

  it('keeps a pending review the owner’s move when a bot mentions him later on the same MR', async () => {
    const { deps, rows } = setup(
      [
        [
          todo({ id: 1, at: NOW - 2 * HOUR }),
          todo({ id: 2, action: 'mentioned', author: 'acme-mcp', at: NOW - HOUR })
        ]
      ],
      { bots: ['acme-mcp'] }
    )
    await runHqGitLabTodoReader(deps, { cursor: 0 })
    expect(rows()).toMatchObject([{ key: MR, messages: 2, state: 'you' }])
  })

  it('a bot’s mention alone is for information', async () => {
    const { deps, rows } = setup([[todo({ action: 'mentioned', author: 'acme-mcp' })]], {
      bots: ['ACME-MCP']
    })
    await runHqGitLabTodoReader(deps, { cursor: 0 })
    expect(rows()).toMatchObject([{ key: MR, state: 'fyi' }])
  })

  it('names the project by the repo, and asks the model only where no name fits — for the project alone', async () => {
    const guess: HqLedgerGuess = { project: 'acme-shop', how: 'model', state: 'you', gist: 'гист' }
    const { db, deps, guessed } = setup(
      [
        [
          todo({ id: 1, repo: 'acme/lh-hub', iid: 1 }),
          todo({ id: 2, repo: 'acme/other', iid: 2, action: 'mentioned', author: 'acme-mcp' })
        ]
      ],
      { projects: ['hub', 'acme-shop'], bots: ['acme-mcp'], guess }
    )
    await runHqGitLabTodoReader(deps, { cursor: 0 })
    expect(guessed).toEqual(['2'])
    const feed = db.listLedgerFeed(0).conversations
    expect(feed.map((row) => [row.key, row.project, row.projectHow, row.state, row.title])).toEqual(
      [
        ['gitlab:acme/lh-hub!1', 'hub', 'rule', 'you', 'Review requested: Speed up the import'],
        ['gitlab:acme/other!2', 'acme-shop', 'model', 'fyi', 'Mentioned: Speed up the import']
      ]
    )
  })
})
