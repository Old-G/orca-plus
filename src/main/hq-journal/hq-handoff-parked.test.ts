// Custom build (hq-handoff-parked, T7 25.11): after a handoff the old chat is parked — what is sent to it
// by its address or its session id reaches the chat that continues it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import type { HqCallerScope } from './hq-journal-rooms'
import { hqLeadBatchSession } from './hq-journal-send'
import { createHqThreads, type HqThreads } from './hq-journal-threads'

let db: PulseDb
let threads: HqThreads
let clock: number
let open: Set<string>
let delivered: string[]
let reopened: string[]

const room = (sessionId: string): HqCallerScope => ({
  kind: 'room',
  room: 'acme',
  project: 'acme-api',
  sessionId,
  worktreeId: 'r-api::/w/api'
})

beforeEach(() => {
  db = new PulseDb(':memory:')
  clock = 1_000_000
  open = new Set(['claude_old', 'claude_new', 'claude_lead'])
  delivered = []
  reopened = []
  threads = createHqThreads({
    enabled: () => true,
    scope: async (caller) =>
      caller.sessionId
        ? room(caller.sessionId)
        : { kind: 'overview', sessionId: null, worktreeId: null },
    pulse: {
      record: (inputs) => db.recordJournal(inputs),
      list: (query) => db.listJournal(query),
      getSession: (id) => db.getSession(id),
      noteSessions: (inputs) => db.noteSessions(inputs),
      listSessionsByAddress: (address) => db.listSessionsByAddress(address),
      getEntry: (id) => db.getJournalEntry(id),
      listPeople: () => db.listPeople(),
      upsertPerson: (input) => db.upsertPerson(input),
      linkChat: (input) => db.chats.link(input),
      roleOf: (id) => db.chats.roleOf(id),
      setRole: (input) => db.chats.setRole(input),
      liveSessionOf: (id) => db.chats.liveSessionOf(id)
    },
    sessionName: (id) => (id === 'claude_old' ? 'W · Payouts' : null),
    sessionWorkspace: () => 'r-api::/w/api',
    deliver: async (sessionId) => {
      if (!open.has(sessionId)) {
        return false
      }
      delivered.push(sessionId)
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

/** The old chat reports, hands off, then keeps finishing its turn — the newest activity on the thread. */
async function handedOff(): Promise<string> {
  const { address } = await threads.report({ sessionId: 'claude_old' }, { done: 'Half done' })
  threads.handoff('claude_old', 'claude_new')
  await threads.report({ sessionId: 'claude_old' }, { done: 'Handoff written' })
  const old = db.getSession('claude_old')
  const next = db.getSession('claude_new')
  expect(old && next && old.lastActivityAt > next.lastActivityAt).toBe(true)
  return address
}

describe('a chat that handed off is parked (hq-handoff-parked)', () => {
  it('lists the chat that continues the thread first, though the old one was active later', async () => {
    const address = await handedOff()
    expect(db.listSessionsByAddress(address).map((session) => session.sessionId)).toEqual([
      'claude_new',
      'claude_old'
    ])
  })

  it("sends by the thread's address to the new chat", async () => {
    const address = await handedOff()
    const sent = await threads.send({ sessionId: 'claude_lead' }, { address, text: 'От лида: да' })
    expect(sent.sessionId).toBe('claude_new')
    expect(sent.forwardedFrom).toBeUndefined()
    expect(delivered).toEqual(['claude_new'])
  })

  it("sends by the old chat's session id to the new chat, and says so", async () => {
    await handedOff()
    const sent = await threads.send(
      { sessionId: 'claude_lead' },
      { address: 'claude_old', text: 'От лида: да' }
    )
    expect(sent).toMatchObject({
      sessionId: 'claude_new',
      forwardedFrom: 'claude_old',
      handedOff: true
    })
    expect(sent.entry.sessionId).toBe('claude_new')
    expect(delivered).toEqual(['claude_new'])
  })

  it('does not bring a closed old chat back; it follows a chain of handoffs to its end', async () => {
    await handedOff()
    threads.handoff('claude_new', 'claude_third')
    open.delete('claude_old')
    open.add('claude_third')
    const sent = await threads.send(
      { sessionId: 'claude_lead' },
      { address: 'claude_old', text: 'status?' }
    )
    expect(sent.sessionId).toBe('claude_third')
    expect(reopened).toEqual([])
    expect(delivered).toEqual(['claude_third'])
  })

  it('lets the new chat still write to the chat it continues', async () => {
    await handedOff()
    const sent = await threads.send(
      { sessionId: 'claude_new' },
      { address: 'claude_old', text: 'where is the branch?' }
    )
    expect(sent.sessionId).toBe('claude_old')
    expect(delivered).toEqual(['claude_old'])
  })

  it('parks an old chat that had no address, and reports an unknown one', async () => {
    db.noteSessions([
      {
        sessionId: 'claude_bare',
        address: null,
        agent: 'claude',
        worktreeId: 'r-api::/w/api',
        workspace: 'acme',
        project: 'acme-api',
        state: 'working',
        contextPct: null,
        parentSessionId: null,
        taskRef: null,
        at: clock
      }
    ])
    expect(threads.handoff('claude_bare', 'claude_new')).toBe(true)
    expect(db.getSession('claude_new')?.parentSessionId).toBe('claude_bare')
    const sent = await threads.send(
      { sessionId: 'claude_lead' },
      { address: 'claude_bare', text: 'status?' }
    )
    expect(sent).toMatchObject({ sessionId: 'claude_new', forwardedFrom: 'claude_bare' })
    expect(threads.handoff('claude_nobody', 'claude_new')).toBe(false)
  })

  it("gives a Lead's held batch to the chat that continued the Lead, whatever its address", async () => {
    const address = await handedOff()
    db.noteSessions([{ ...db.getSession('claude_new')!, address: 'acme-api/other', at: clock }])
    const pulse = {
      getSession: (id: string) => db.getSession(id),
      listSessionsByAddress: (addr: string) => db.listSessionsByAddress(addr),
      liveSessionOf: (id: string) => db.chats.liveSessionOf(id)
    }
    const held = { address, sessionId: 'claude_old' } as Parameters<typeof hqLeadBatchSession>[1]
    expect(db.listSessionsByAddress(address).map((session) => session.sessionId)).toEqual([
      'claude_old'
    ])
    expect(hqLeadBatchSession(pulse, held)).toBe('claude_new')
  })

  it('leaves a chat no one continued as it was', async () => {
    const { address } = await threads.report({ sessionId: 'claude_old' }, { done: 'Working' })
    const sent = await threads.send({ sessionId: 'claude_lead' }, { address, text: 'ok' })
    expect(sent.sessionId).toBe('claude_old')
    expect(sent.forwardedFrom).toBeUndefined()
  })
})
