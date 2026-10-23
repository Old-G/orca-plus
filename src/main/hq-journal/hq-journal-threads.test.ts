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
      SCOPES[caller.sessionId ?? ''] ?? { kind: 'overview', sessionId: null, worktreeId: null },
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

  it('keeps the address when a handoff hands the chat on', async () => {
    const api = await threads.report({ sessionId: 'claude_api' }, { done: 'Half done' })
    threads.handoff('claude_api', 'claude_api_2')
    expect(db.getSession('claude_api_2')).toMatchObject({
      address: api.address,
      parentSessionId: 'claude_api'
    })
    expect(db.listJournal({ address: api.address }).map((entry) => entry.kind)).toContain(
      'session.handoff'
    )
  })
})
