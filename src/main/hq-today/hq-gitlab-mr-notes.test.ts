import { describe, expect, it } from 'vitest'
import type { HqLedgerSignal } from '../../shared/hq-ledger'
import {
  hqLedgerSignalOfMrNote,
  hqMrTitleTasks,
  parseHqGitLabMrNotes,
  runHqGitLabMrNotes,
  type HqGitLabMrNotesDeps
} from './hq-gitlab-mr-notes'

const NOW = Date.parse('2026-11-15T12:00:00Z')
const iso = (minutesAgo: number): string => new Date(NOW - minutesAgo * 60_000).toISOString()

const MR_ROW = {
  project_id: 11,
  iid: 7,
  title: 'DEV-18990: timeout in config',
  web_url: 'https://gitlab.com/acme/app/-/merge_requests/7',
  source_branch: 'feature/timeout',
  updated_at: iso(1)
}

function note(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 100,
    body: 'Move the timeout to config',
    system: false,
    author: { username: 'bob', name: 'Bob' },
    created_at: iso(2),
    ...over
  }
}

function deps(over: Partial<HqGitLabMrNotesDeps> & { notes?: unknown[] } = {}): {
  deps: HqGitLabMrNotesDeps
  ingested: HqLedgerSignal[]
  ifNone: [string, string][]
  noteCalls: number[]
} {
  const ingested: HqLedgerSignal[] = []
  const ifNone: [string, string][] = []
  const noteCalls: number[] = []
  const seen = new Set<string>()
  return {
    ingested,
    ifNone,
    noteCalls,
    deps: {
      enabled: () => true,
      listOpenMrs: async () => [MR_ROW],
      listNotes: async (_project, iid) => {
        noteCalls.push(iid)
        return over.notes ?? [note({})]
      },
      owner: async () => 'owner',
      bots: async () => ['acme-mcp'],
      projects: async () => ['app'],
      ingest: (signal) => {
        ingested.push(signal)
        const added = !seen.has(signal.ts)
        seen.add(signal.ts)
        return { conversationId: 'c1', step: 'new', added, waitingIds: [] }
      },
      chatOfBranch: async (project, branch) =>
        project === 'app' && branch === 'feature/timeout' ? 'chat-1' : null,
      setChatIfNone: (key, sessionId) => ifNone.push([key, sessionId]),
      now: () => NOW,
      ...over
    }
  }
}

describe('GitLab MR comments into the ledger (T14)', () => {
  it('puts a person’s comment on the owner’s MR in the ledger and gives the MR its chat', async () => {
    const run = deps()
    await runHqGitLabMrNotes(run.deps, { cursor: 0 })
    expect(run.ingested).toHaveLength(1)
    expect(run.ingested[0]).toMatchObject({
      key: 'gitlab:acme/app!7',
      ts: 'note:100',
      author: 'Bob',
      authorId: 'bob',
      fromOwner: false,
      forOwner: true,
      project: 'app',
      reader: 'gitlab-mr-notes',
      link: 'https://gitlab.com/acme/app/-/merge_requests/7#note_100'
    })
    expect(run.ifNone).toEqual([
      ['gitlab:acme/app!7', 'chat-1'],
      ['clickup:DEV-18990', 'chat-1']
    ])
  })

  it('leaves out GitLab’s own lines, the owner’s account, bots and a comment that names the owner', async () => {
    const run = deps({
      notes: [
        note({ id: 1, system: true }),
        note({ id: 2, author: { username: 'owner', name: 'Owner' } }),
        note({ id: 3, author: { username: 'acme-mcp', name: 'Hub bot' } }),
        note({ id: 4, author: { username: 'project_12_bot_x', name: 'CI' } }),
        note({ id: 5, body: '@owner please look' })
      ]
    })
    await runHqGitLabMrNotes(run.deps, { cursor: 0 })
    expect(run.ingested).toEqual([])
    // Why: the MR and its task still go with the branch's chat even when no comment came.
    expect(run.ifNone).toEqual([
      ['gitlab:acme/app!7', 'chat-1'],
      ['clickup:DEV-18990', 'chat-1']
    ])
  })

  it('keeps a diff comment’s file and line, and reads only MRs updated since the last pass', async () => {
    const run = deps({
      notes: [note({ id: 6, position: { new_path: 'src/a.ts', new_line: 42 } })]
    })
    const state = await runHqGitLabMrNotes(run.deps, { cursor: 0 })
    expect(run.ingested[0]?.text).toBe('src/a.ts:42: Move the timeout to config')
    expect(run.noteCalls).toEqual([7])
    // Why: the MR was updated a minute before the first pass; the next pass an hour later skips it.
    const later = deps({ notes: [note({ id: 6 })], now: () => NOW + 60 * 60_000 })
    await runHqGitLabMrNotes(later.deps, { ...state, cursor: NOW + 30 * 60_000 })
    expect(later.noteCalls).toEqual([])
  })

  it('skips comments older than the window and sets no chat when no Orca chat works on the branch', async () => {
    const run = deps({
      notes: [note({ id: 7, created_at: iso(48 * 60) })],
      chatOfBranch: async () => null
    })
    await runHqGitLabMrNotes(run.deps, { cursor: 0 })
    expect(run.ingested).toEqual([])
    const fresh = deps({ chatOfBranch: async () => null })
    await runHqGitLabMrNotes(fresh.deps, { cursor: 0 })
    expect(fresh.ingested).toHaveLength(1)
    expect(fresh.ifNone).toEqual([])
  })

  it('reads the other MRs when one cannot be read, and says which', async () => {
    const warned: string[] = []
    const run = deps({
      listOpenMrs: async () => [{ ...MR_ROW, iid: 8 }, MR_ROW],
      listNotes: async (_project, iid) => {
        if (iid === 8) {
          throw new Error('404 Not found')
        }
        return [note({})]
      },
      warn: (message, detail) => warned.push(`${message} | ${detail}`)
    })
    await runHqGitLabMrNotes(run.deps, { cursor: 0 })
    expect(run.ingested.map((signal) => signal.ts)).toEqual(['note:100'])
    expect(warned).toEqual(['GitLab MR comments not read for 1 MR(s) | acme/app!8: 404 Not found'])
  })

  it('asks for a branch’s chat again after a failed lookup', async () => {
    let calls = 0
    const run = deps({
      chatOfBranch: async () => {
        calls += 1
        if (calls === 1) {
          throw new Error('busy')
        }
        return 'chat-1'
      }
    })
    const state = await runHqGitLabMrNotes(run.deps, { cursor: 0 })
    expect(run.ifNone).toEqual([])
    await runHqGitLabMrNotes(run.deps, state)
    expect(run.ifNone[0]).toEqual(['gitlab:acme/app!7', 'chat-1'])
  })

  it('throws on an answer that is not a list, so a failed read is reported, not taken as no comments', async () => {
    const run = deps({ listOpenMrs: async () => ({ message: '401 Unauthorized' }) })
    await expect(runHqGitLabMrNotes(run.deps, { cursor: 0 })).rejects.toThrow(/list of merge/)
    expect(() => parseHqGitLabMrNotes({ error: 'x' })).toThrow(/list of comments/)
  })
})

describe('pieces', () => {
  it('finds task ids in an MR title', () => {
    expect(hqMrTitleTasks('DEV-18990 + DEV-1: fix')).toEqual(['DEV-18990'])
    expect(hqMrTitleTasks('DEV-18990, OPS-42 and DEV-18990')).toEqual(['DEV-18990', 'OPS-42'])
    expect(hqMrTitleTasks('no task')).toEqual([])
  })

  it('does not take an e-mail or another name with the owner’s inside as naming him', () => {
    const mr = {
      projectId: 1,
      iid: 2,
      title: 't',
      url: 'https://gitlab.com/acme/app/-/merge_requests/2',
      repo: 'acme/app',
      sourceBranch: null,
      updatedAt: NOW
    }
    const base = {
      id: '1',
      system: false,
      authorName: 'Bob',
      authorUsername: 'bob',
      createdAt: NOW,
      place: null
    }
    const ctx = { owner: 'owner', bots: new Set<string>(), project: null }
    expect(hqLedgerSignalOfMrNote(mr, { ...base, body: 'ping @owner2' }, ctx)).not.toBeNull()
    expect(hqLedgerSignalOfMrNote(mr, { ...base, body: 'x@owner.io' }, ctx)).not.toBeNull()
    expect(hqLedgerSignalOfMrNote(mr, { ...base, body: 'cc @Owner.' }, ctx)).toBeNull()
  })

  it('reads a failed MR’s comments from where it failed once GitLab shows it again', async () => {
    let down = true
    const run = deps({
      listNotes: async () => {
        if (down) {
          throw new Error('502 Bad Gateway')
        }
        return [note({ id: 9, created_at: iso(2) })]
      },
      warn: () => {}
    })
    let state = await runHqGitLabMrNotes(run.deps, { cursor: 0 })
    expect(run.ingested).toEqual([])
    // Why: an hour of failed passes, then GitLab comes back; MR and comment are both older than the
    // ten-minute overlap of the last pass.
    for (const hour of [0.5, 1]) {
      state = await runHqGitLabMrNotes({ ...run.deps, now: () => NOW + hour * 60 * 60_000 }, state)
    }
    down = false
    await runHqGitLabMrNotes({ ...run.deps, now: () => NOW + 90 * 60_000 }, state)
    expect(run.ingested.map((signal) => signal.ts)).toEqual(['note:9'])
  })

  it('closes the comment card of an MR that is no longer open', async () => {
    const closed: string[] = []
    const run = deps({
      listOpenMrs: async () => [MR_ROW],
      openKeys: () => ['gitlab:acme/app!7', 'gitlab:acme/app!5'],
      close: (key) => closed.push(key)
    })
    await runHqGitLabMrNotes(run.deps, { cursor: 0 })
    expect(closed).toEqual(['gitlab:acme/app!5'])
  })
})
