import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import type { HqCallerScope } from './hq-journal-rooms'
import { createHqThreads, type HqThreads } from './hq-journal-threads'

let db: PulseDb
let threads: HqThreads
let clock: number
let open: Set<string>
let delivered: { sessionId: string; prompt: string }[]
let reopened: string[]

const SCOPES: Record<string, HqCallerScope> = {
  claude_api: {
    kind: 'room',
    room: 'acme',
    project: 'acme-api',
    sessionId: 'claude_api',
    worktreeId: 'r-api::/w/api'
  },
  claude_web: {
    kind: 'room',
    room: 'acme',
    project: 'acme-web',
    sessionId: 'claude_web',
    worktreeId: 'r-web::/w/web'
  },
  claude_kite: {
    kind: 'room',
    room: 'hobby',
    project: 'kite',
    sessionId: 'claude_kite',
    worktreeId: 'r-kite::/w/kite'
  }
}

beforeEach(() => {
  db = new PulseDb(':memory:')
  clock = 1_000_000
  open = new Set(['claude_api', 'claude_kite'])
  delivered = []
  reopened = []
  threads = createHqThreads({
    enabled: () => true,
    scope: async (caller) =>
      SCOPES[caller.sessionId ?? ''] ??
      (caller.worktreeId
        ? {
            kind: 'room',
            room: 'acme',
            project: 'acme-api',
            sessionId: null,
            worktreeId: caller.worktreeId
          }
        : { kind: 'overview', sessionId: null, worktreeId: null }),
    pulse: {
      record: (inputs) => db.recordJournal(inputs),
      list: (query) => db.listJournal(query),
      getSession: (id) => db.getSession(id),
      noteSessions: (inputs) => db.noteSessions(inputs),
      listSessionsByAddress: (address) => db.listSessionsByAddress(address),
      getEntry: (id) => db.getJournalEntry(id),
      listPeople: () => db.listPeople(),
      upsertPerson: (input) => db.upsertPerson(input)
    },
    sessionName: (id) => ({ claude_api: 'Refund limits', claude_web: 'Checkout page' })[id] ?? null,
    sessionWorkspace: () => null,
    deliver: async (sessionId, prompt) => {
      if (!open.has(sessionId)) {
        return false
      }
      delivered.push({ sessionId, prompt })
      return true
    },
    reopen: (sessionId) => {
      reopened.push(sessionId)
      open.add(sessionId)
      return true
    },
    wait: async () => {},
    now: () => (clock += 1_000)
  })
})

afterEach(() => db.close())

describe('HQ+ threads', () => {
  it('names the thread on the first report and closes an open question with the next', async () => {
    const asked = await threads.report(
      { sessionId: 'claude_api' },
      {
        done: 'Limits read from the API',
        ask: 'Cap per order or per day?',
        options: ['order', 'day']
      }
    )
    expect(asked.address).toBe('acme-api/refund-limits')
    expect(asked.entry).toMatchObject({ needs: 'owner:decide', status: 'open', workspace: 'acme' })
    expect(asked.entry.body).toContain('options: order | day')

    const next = await threads.report(
      { sessionId: 'claude_api' },
      { done: 'Cap per order applied', blockedBy: 'Ann' }
    )
    expect(next.address).toBe(asked.address)
    expect(next.entry.needs).toMatch(/^person:/)
    expect(db.getJournalEntry(asked.entry.id)?.status).toBe('done')
    expect(db.getSession('claude_api')).toMatchObject({ address: asked.address, state: 'waiting' })
  })

  it('lets a chat continue another thread with a quote, bringing a closed chat back', async () => {
    const api = await threads.report({ sessionId: 'claude_api' }, { done: 'API ready' })
    const web = await threads.report(
      { sessionId: 'claude_web' },
      { done: 'Checkout waits for the API', ask: 'Is the API ready?' }
    )
    const sent = await threads.send(
      { sessionId: 'claude_api' },
      { address: web.address, text: 'Yes, deployed — go on.', replyTo: web.entry.id }
    )
    expect(sent.reopened).toBe(true)
    expect(reopened).toEqual(['claude_web'])
    expect(delivered[0]?.prompt).toContain(`from thread ${api.address}`)
    expect(delivered[0]?.prompt).toContain(
      'in reply to «Checkout waits for the API — Is the API ready?»'
    )

    const thread = await threads.thread({ sessionId: 'claude_web' })
    expect(thread.entries.map((entry) => [entry.kind, entry.replyTo])).toEqual([
      ['chat.report', null],
      ['chat.message', web.entry.id]
    ])
  })

  it("settles the owner's question when the owner answers it, not when another chat does", async () => {
    const web = await threads.report(
      { sessionId: 'claude_web' },
      { done: 'Checkout waits for the API', ask: 'Ship behind a flag?' }
    )
    await threads.send(
      { sessionId: 'claude_api' },
      { address: web.address, text: 'API side is ready.', replyTo: web.entry.id }
    )
    expect(db.getJournalEntry(web.entry.id)?.status).toBe('open')

    await threads.send({}, { address: web.address, text: 'Yes, flag it.', replyTo: web.entry.id })
    expect(db.getJournalEntry(web.entry.id)?.status).toBe('done')
    expect(db.listJournal({ needs: 'owner', status: 'open' })).toEqual([])
  })

  it("lets a background job, and no chat of another room, read the job's thread", async () => {
    db.recordJournal([
      {
        workspace: 'hobby',
        kind: 'job.report',
        project: 'kite',
        address: 'job/scout',
        sessionId: null,
        personId: null,
        at: 5,
        title: 'scout: ship?',
        body: null,
        needs: 'owner:decide',
        status: 'open',
        replyTo: null,
        refKind: 'job',
        refId: 'scout',
        source: 'job:scout',
        dedupeKey: 'job:scout:1'
      }
    ])
    expect((await threads.thread({}, 'job/scout')).entries).toHaveLength(1)
    await expect(threads.thread({ sessionId: 'claude_api' }, 'job/scout')).rejects.toThrow(
      /No thread/
    )
    await expect(threads.thread({ worktreeId: 'r-api::/w/api' }, 'job/scout')).rejects.toThrow(
      /No thread/
    )
  })

  it("never reaches another room's thread", async () => {
    const kite = await threads.report({ sessionId: 'claude_kite' }, { done: 'Palette moved' })
    await expect(
      threads.send({ sessionId: 'claude_api' }, { address: kite.address, text: 'hi' })
    ).rejects.toThrow(/No chat works on/)
    await expect(threads.thread({ sessionId: 'claude_api' }, kite.address)).rejects.toThrow(
      /No thread/
    )
    expect(delivered).toEqual([])
  })

  it('keeps the address when a handoff hands the chat on, and settles its open question', async () => {
    const api = await threads.report(
      { sessionId: 'claude_api' },
      { done: 'Half done', ask: 'Ship it?', options: ['yes', 'no'] }
    )
    expect(api.entry.status).toBe('open')
    threads.handoff('claude_api', 'claude_api_2')
    expect(db.getJournalEntry(api.entry.id)?.status).toBe('done')
    expect(db.getSession('claude_api_2')).toMatchObject({
      address: api.address,
      parentSessionId: 'claude_api'
    })
    expect(db.listJournal({ address: api.address }).map((entry) => entry.kind)).toContain(
      'session.handoff'
    )
  })
})

describe('HQ+ threads: settling a handed row', () => {
  it('closes a finding with its commit, once, and only in its room', async () => {
    db.recordJournal([
      {
        workspace: 'acme',
        kind: 'review.finding',
        project: 'acme-api',
        address: 'acme-api/codex-fix-2026-10-24',
        sessionId: null,
        personId: null,
        title: '[P1] Refund cap ignores partial refunds',
        needs: 'agent:new',
        replyTo: null,
        refKind: 'file',
        refId: 'updates/codex-review-2026-10-24T18-50.md',
        source: 'codex-review',
        dedupeKey: 'review.finding:x:1'
      }
    ])
    const [finding] = db.listJournal({ kind: 'review.finding' })
    await expect(
      threads.settle({ sessionId: 'claude_kite' }, { id: finding.id, status: 'done' })
    ).rejects.toThrow('in this chat')
    await expect(
      threads.settle({ sessionId: 'claude_api' }, { id: finding.id, status: 'dropped' })
    ).rejects.toThrow('--why')
    const settled = await threads.settle(
      { sessionId: 'claude_api' },
      { id: finding.id, status: 'done', commit: '5a5a5a5a5a' }
    )
    expect(settled).toEqual({ settled: true, entryId: finding.id, status: 'done' })
    expect(db.getJournalEntry(finding.id)?.status).toBe('done')
    const [verdict] = db.listJournal({ kind: 'entry.settled' })
    expect(verdict).toMatchObject({
      replyTo: finding.id,
      address: 'acme-api/codex-fix-2026-10-24',
      links: [{ kind: 'commit', id: '5a5a5a5a5a' }]
    })
    expect(
      (await threads.settle({ sessionId: 'claude_api' }, { id: finding.id, status: 'done' }))
        .settled
    ).toBe(false)
  })

  it('closes a minor finding «Fix now» handed to a chat, though its source noted it done', async () => {
    db.recordJournal([
      {
        workspace: 'acme',
        kind: 'review.finding',
        project: 'acme-api',
        address: 'acme-api/codex-fix-2026-10-24',
        sessionId: null,
        personId: null,
        title: '[P2] Log line repeats the amount',
        needs: 'nobody',
        status: 'done',
        replyTo: null,
        refKind: 'file',
        refId: 'updates/codex-review-2026-10-24T18-50.md',
        source: 'codex-review',
        dedupeKey: 'review.finding:x:2'
      }
    ])
    const [finding] = db.listJournal({ kind: 'review.finding' })
    const settled = await threads.settle(
      { sessionId: 'claude_api' },
      { id: finding.id, status: 'dropped', why: 'Intended: the amount is logged twice on purpose' }
    )
    expect(settled.settled).toBe(true)
    expect(db.listJournal({ kind: 'entry.settled' })).toMatchObject([{ replyTo: finding.id }])
    expect(
      (await threads.settle({ sessionId: 'claude_api' }, { id: finding.id, status: 'done' }))
        .settled
    ).toBe(false)
  })
})
