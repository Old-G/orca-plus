import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { hqPlusLog } from '../../shared/hq-plus-log'
import type { HqCallerScope } from './hq-journal-rooms'
import { createHqThreads, type HqThreads } from './hq-journal-threads'
import { hqDeliverLeadBatch, hqLeadBatchGiveUp, hqLeadBatchSession } from './hq-journal-send'
import {
  createHqLeadBatch,
  HQ_LEAD_BATCH_BUSY_STEP_MS,
  HQ_LEAD_BATCH_MAX_TRIES,
  HQ_LEAD_BATCH_WINDOW_MS,
  hqLeadUrgent,
  parseHqLeadHeld,
  type HqLeadBatch,
  type HqLeadHeld
} from './hq-lead-batch'

let db: PulseDb
let threads: HqThreads
let batch: HqLeadBatch
let clock: number
let delivered: { sessionId: string; prompt: string }[]
let busy: Set<string>
let closed: Set<string>
let saved: HqLeadHeld[]
let timers: { at: number; run: () => void; cancelled: boolean }[]

const ROOM = (sessionId: string): HqCallerScope => ({
  kind: 'room',
  room: 'acme',
  project: 'acme-api',
  sessionId,
  worktreeId: 'r-api::/w/api'
})
const SCOPES: Record<string, HqCallerScope> = {
  claude_lead: ROOM('claude_lead'),
  claude_plain: ROOM('claude_plain'),
  claude_w1: ROOM('claude_w1'),
  claude_w2: ROOM('claude_w2')
}

/** Runs every timer due by `clock + ms`, in order, like the event loop would. */
async function advance(ms: number): Promise<void> {
  const until = clock + ms
  for (;;) {
    const next = timers
      .filter((timer) => !timer.cancelled && timer.at <= until)
      .sort((a, b) => a.at - b.at)[0]
    if (!next) {
      break
    }
    next.cancelled = true
    clock = Math.max(clock, next.at)
    next.run()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  clock = until
}

const deliver = async (sessionId: string, prompt: string): Promise<boolean> => {
  if (closed.has(sessionId)) {
    return false
  }
  delivered.push({ sessionId, prompt })
  return true
}

function makeBatch(): HqLeadBatch {
  const pulse = {
    getSession: (id: string) => db.getSession(id),
    listSessionsByAddress: (address: string) => db.listSessionsByAddress(address),
    record: (inputs: Parameters<PulseDb['recordJournal']>[0]) => db.recordJournal(inputs)
  }
  const deps = {
    pulse,
    sessionWorkspace: () => null,
    deliver,
    reopen: () => false,
    wait: async () => {}
  }
  return createHqLeadBatch({
    busy: (held) => busy.has(hqLeadBatchSession(pulse, held)),
    flush: (held, prompt) => hqDeliverLeadBatch(deps, held, prompt),
    giveUp: (held, prompt) => hqLeadBatchGiveUp({ pulse, now: () => clock }, held, prompt),
    load: async () => saved,
    save: async (held) => {
      saved = held
    },
    now: () => clock,
    schedule: (run, ms) => {
      const timer = { at: clock + ms, run, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    log: () => {}
  })
}

beforeEach(async () => {
  db = new PulseDb(':memory:')
  clock = 1_000_000
  delivered = []
  busy = new Set()
  closed = new Set()
  saved = []
  timers = []
  batch = makeBatch()
  await batch.start()
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
      upsertPerson: (input) => db.upsertPerson(input),
      linkChat: (input) => db.chats.link(input),
      roleOf: (id) => db.chats.roleOf(id),
      setRole: (input) => db.chats.setRole(input)
    },
    sessionName: (id) =>
      (
        {
          claude_lead: 'LEAD · Payouts',
          claude_plain: 'Refund limits',
          claude_w1: 'W · Payouts report',
          claude_w2: 'W · Payouts export'
        } as Record<string, string>
      )[id] ?? null,
    sessionWorkspace: () => null,
    deliver,
    reopen: () => false,
    wait: async () => {},
    now: () => clock,
    leadBatch: batch
  })
  db.chats.setRole({ sessionId: 'claude_lead', role: 'lead', at: clock })
  for (const id of ['claude_w1', 'claude_w2']) {
    db.chats.setRole({ sessionId: id, role: 'worker', at: clock })
  }
  for (const id of ['claude_lead', 'claude_plain', 'claude_w1', 'claude_w2']) {
    await threads.report({ sessionId: id }, { done: 'started' })
  }
})

afterEach(() => db.close())

const lead = (): string => db.getSession('claude_lead')?.address ?? ''

describe('hqLeadUrgent', () => {
  it('reads the first non-empty line only', () => {
    expect(hqLeadUrgent('BLOCKED · T3 · acme · build')).toBe(true)
    expect(hqLeadUrgent('\n  NEEDS DECISION · T2')).toBe(true)
    expect(hqLeadUrgent('needs decision: a or b?')).toBe(true)
    expect(hqLeadUrgent('DONE · T1\nnot BLOCKED anymore')).toBe(false)
    expect(hqLeadUrgent('Not BLOCKED')).toBe(false)
  })
})

describe('Lead batch', () => {
  it('hands five DONE reports in a window to the Lead as one message', async () => {
    expect(lead()).toBe('acme-api/lead-payouts')
    for (let n = 1; n <= 5; n += 1) {
      const sent = await threads.send(
        { sessionId: n % 2 ? 'claude_w1' : 'claude_w2' },
        { address: lead(), text: `DONE · T${n} · acme · step ${n}` }
      )
      expect(sent.heldUntil).toBe(1_000_000 + HQ_LEAD_BATCH_WINDOW_MS)
      expect(sent.entry.title).toContain(`DONE · T${n}`)
      await advance(60_000)
    }
    expect(delivered).toEqual([])
    await advance(HQ_LEAD_BATCH_WINDOW_MS)
    expect(delivered).toHaveLength(1)
    expect(delivered[0].sessionId).toBe('claude_lead')
    expect(delivered[0].prompt).toMatch(/^Orca\+ · 5 messages to this Lead, held since/)
    for (let n = 1; n <= 5; n += 1) {
      expect(delivered[0].prompt).toContain(`DONE · T${n} · acme · step ${n}`)
    }
    expect(delivered[0].prompt).toContain('from thread acme-api/w-payouts-report')
    expect(saved).toEqual([])
  })

  it('sends a BLOCKED at once, with what was held before it', async () => {
    await threads.send({ sessionId: 'claude_w1' }, { address: lead(), text: 'DONE · T1' })
    await threads.send({ sessionId: 'claude_w2' }, { address: lead(), text: 'DONE · T2' })
    const blocked = await threads.send(
      { sessionId: 'claude_w1' },
      { address: lead(), text: 'BLOCKED · T3 · acme · no key' }
    )
    expect(blocked.heldUntil).toBeUndefined()
    expect(delivered).toHaveLength(1)
    const prompt = delivered[0].prompt
    expect(prompt).toContain('3 messages')
    expect(prompt.indexOf('DONE · T1')).toBeLessThan(prompt.indexOf('DONE · T2'))
    expect(prompt.indexOf('DONE · T2')).toBeLessThan(prompt.indexOf('BLOCKED · T3'))
    // Why: the window's timer was the held batch's; nothing is left to go later.
    await advance(HQ_LEAD_BATCH_WINDOW_MS * 2)
    expect(delivered).toHaveLength(1)
  })

  it('sends a lone NEEDS DECISION as it is', async () => {
    await threads.send(
      { sessionId: 'claude_w1' },
      { address: lead(), text: 'NEEDS DECISION · T2 · acme · cap\nРешение: a или b?' }
    )
    expect(delivered).toHaveLength(1)
    expect(delivered[0].prompt).toMatch(
      /^Orca\+ · a message from thread acme-api\/w-payouts-report:/
    )
  })

  it('leaves chats without the lead role as they were', async () => {
    const plain = db.getSession('claude_plain')?.address ?? ''
    const toPlain = await threads.send(
      { sessionId: 'claude_w1' },
      { address: plain, text: 'DONE · T1' }
    )
    const toWorker = await threads.send(
      { sessionId: 'claude_lead' },
      { address: 'claude_w2', text: 'От лида: go on' }
    )
    expect(delivered[0].prompt).toBe(
      ['Orca+ · a message from thread acme-api/w-payouts-report:', '"""', 'DONE · T1', '"""'].join(
        '\n'
      )
    )
    expect(toPlain.heldUntil).toBeUndefined()
    expect(toWorker.heldUntil).toBeUndefined()
    expect(delivered.map((item) => item.sessionId)).toEqual(['claude_plain', 'claude_w2'])
  })

  it('never holds the owner typing in HQ+, and takes the held ones along', async () => {
    await threads.send({ sessionId: 'claude_w1' }, { address: lead(), text: 'DONE · T1' })
    const owner = await threads.send({}, { address: lead(), text: 'Ship T1.' })
    expect(owner.heldUntil).toBeUndefined()
    expect(delivered).toHaveLength(1)
    expect(delivered[0].prompt).toContain('2 messages')
    expect(delivered[0].prompt).toContain('from thread HQ+')
  })

  it('keeps holding while the Lead is in a turn; what comes meanwhile goes in the same message', async () => {
    busy.add('claude_lead')
    await threads.send({ sessionId: 'claude_w1' }, { address: lead(), text: 'DONE · T1' })
    await advance(HQ_LEAD_BATCH_WINDOW_MS + HQ_LEAD_BATCH_BUSY_STEP_MS * 3)
    expect(delivered).toEqual([])
    await threads.send({ sessionId: 'claude_w2' }, { address: lead(), text: 'DONE · T2' })
    busy.delete('claude_lead')
    await advance(HQ_LEAD_BATCH_BUSY_STEP_MS)
    expect(delivered).toHaveLength(1)
    expect(delivered[0].prompt).toContain('DONE · T1')
    expect(delivered[0].prompt).toContain('DONE · T2')
  })

  it('picks the held messages up again after a restart', async () => {
    await threads.send({ sessionId: 'claude_w1' }, { address: lead(), text: 'DONE · T1' })
    expect(parseHqLeadHeld(JSON.stringify(saved))).toHaveLength(1)
    timers = []
    const restarted = makeBatch()
    await restarted.start()
    await advance(HQ_LEAD_BATCH_WINDOW_MS)
    expect(delivered).toHaveLength(1)
    expect(delivered[0].prompt).toContain('DONE · T1')
  })

  it('keeps a batch the Lead could not take, tries again a window later, then tells the owner', async () => {
    await threads.send({ sessionId: 'claude_w1' }, { address: lead(), text: 'DONE · T1' })
    closed.add('claude_lead')
    await advance(HQ_LEAD_BATCH_WINDOW_MS)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ tries: 1, dueAt: clock + HQ_LEAD_BATCH_WINDOW_MS })
    await advance(HQ_LEAD_BATCH_WINDOW_MS * (HQ_LEAD_BATCH_MAX_TRIES - 1))
    expect(saved).toEqual([])
    expect(delivered).toEqual([])
    const row = db.listJournal({ address: lead(), source: 'lead-batch', limit: 5 })
    expect(row).toHaveLength(1)
    expect(row[0]).toMatchObject({ kind: 'chat.report', needs: 'owner:reply', status: 'open' })
    expect(row[0].body).toContain('DONE · T1')
    // Why: the owner must see it — the feed shows an open owner's report as a card.
    const card = hqPlusLog(row, [], 0).find((item) => item.id === row[0].id)
    expect(card?.kind).toBe('card')
    await advance(HQ_LEAD_BATCH_WINDOW_MS * 3)
    expect(db.listJournal({ address: lead(), source: 'lead-batch', limit: 5 })).toHaveLength(1)
  })

  it('puts the held ones back when an urgent message cannot be delivered', async () => {
    await threads.send({ sessionId: 'claude_w1' }, { address: lead(), text: 'DONE · T1' })
    closed.add('claude_lead')
    await expect(
      threads.send({ sessionId: 'claude_w2' }, { address: lead(), text: 'BLOCKED · T2' })
    ).rejects.toThrow(/could not bring it back/)
    expect(saved).toHaveLength(1)
    expect(saved[0].prompts).toHaveLength(1)
    expect(saved[0].prompts[0]).toContain('DONE · T1')
    await threads.send({ sessionId: 'claude_w2' }, { address: lead(), text: 'DONE · T3' })
    closed.delete('claude_lead')
    await advance(HQ_LEAD_BATCH_WINDOW_MS)
    expect(delivered).toHaveLength(1)
    const prompt = delivered[0].prompt
    expect(prompt.indexOf('DONE · T1')).toBeLessThan(prompt.indexOf('DONE · T3'))
  })

  it('follows a handoff: the held ones go to the new chat on the thread, an urgent one takes them', async () => {
    await threads.send({ sessionId: 'claude_w1' }, { address: lead(), text: 'DONE · T1' })
    const address = lead()
    clock += 1_000
    threads.handoff('claude_lead', 'claude_lead2')
    expect(db.chats.roleOf('claude_lead2')).toBe('lead')
    expect(db.listSessionsByAddress(address)[0]?.sessionId).toBe('claude_lead2')
    await threads.send({ sessionId: 'claude_w2' }, { address, text: 'BLOCKED · T2' })
    expect(delivered).toHaveLength(1)
    expect(delivered[0].sessionId).toBe('claude_lead2')
    expect(delivered[0].prompt).toContain('DONE · T1')
    expect(delivered[0].prompt).toContain('BLOCKED · T2')
  })

  it('waits for the saved batches before an urgent message, so none is left behind', async () => {
    await threads.send({ sessionId: 'claude_w1' }, { address: lead(), text: 'DONE · T1' })
    timers = []
    let release: () => void = () => {}
    const restarted = createHqLeadBatch({
      busy: () => false,
      flush: async () => true,
      giveUp: () => {},
      load: () =>
        new Promise((resolve) => {
          release = () => resolve(parseHqLeadHeld(JSON.stringify(saved)))
        }),
      save: async () => {},
      now: () => clock,
      schedule: () => () => {},
      log: () => {}
    })
    const starting = restarted.start()
    let taken: ReturnType<HqLeadBatch['take']> | undefined
    const urgent = restarted.ready.then(() => {
      taken = restarted.take(lead())
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(taken).toBeUndefined()
    release()
    await Promise.all([starting, urgent])
    expect(taken?.prompts[0]).toContain('DONE · T1')
  })
})

describe('a batch on its way to the Lead', () => {
  function pendingBatch(flush: HqLeadBatchFlush): { lead: HqLeadBatch; file: () => HqLeadHeld[] } {
    let file: HqLeadHeld[] = []
    const lead = createHqLeadBatch({
      busy: () => false,
      flush,
      giveUp: () => {},
      load: async () => [],
      save: async (held) => {
        file = held
      },
      now: () => clock,
      schedule: (run, ms) => {
        const timer = { at: clock + ms, run, cancelled: false }
        timers.push(timer)
        return () => {
          timer.cancelled = true
        }
      },
      log: () => {}
    })
    return { lead, file: () => file }
  }
  type HqLeadBatchFlush = Parameters<typeof createHqLeadBatch>[0]['flush']
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  it('stays in the saved file while a due batch is still being delivered', async () => {
    let land: (ok: boolean) => void = () => {}
    const { lead, file } = pendingBatch(
      () =>
        new Promise<boolean>((resolve) => {
          land = resolve
        })
    )
    await lead.start()
    lead.hold('acme/lead', 'claude_lead', 'DONE · T1')
    await advance(HQ_LEAD_BATCH_WINDOW_MS)
    await settle()
    expect(file().map((held) => held.prompts)).toEqual([['DONE · T1']])
    land(true)
    await settle()
    await settle()
    expect(file()).toEqual([])
  })

  it('keeps taken messages saved until the urgent delivery lands', async () => {
    const { lead, file } = pendingBatch(async () => true)
    await lead.start()
    lead.hold('acme/lead', 'claude_lead', 'DONE · T1')
    await settle()
    const taken = lead.take('acme/lead')
    await settle()
    expect(file().map((held) => held.prompts)).toEqual([['DONE · T1']])
    lead.delivered(taken!)
    await settle()
    expect(file()).toEqual([])
  })
})
