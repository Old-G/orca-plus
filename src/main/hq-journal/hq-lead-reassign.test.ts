import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HqLiveSession } from '../../shared/hq-sessions'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import type { HqCallerScope } from './hq-journal-rooms'
import { createHqThreads, type HqThreads } from './hq-journal-threads'
import { createHqLeadBatch, type HqLeadBatch, type HqLeadHeld } from './hq-lead-batch'
import { hqRewritePlanLeads } from './hq-lead-plan-line'
import { createHqLeadReassign, type HqLeadReassign } from './hq-lead-reassign'
import { formatHqReassign } from '../../cli/hq-reassign-format'

let db: PulseDb
let threads: HqThreads
let reassign: HqLeadReassign
let batch: HqLeadBatch
let clock: number
let delivered: { sessionId: string; prompt: string }[]
let closed: Set<string>
let saved: HqLeadHeld[]
let hq: string
/** Chats with no thread address, only a session id (ones the owner started by hand). */
let bare: HqLiveSession[]

// Two Leads, three workers of the first (the third closed), an HQ chat that is no one's worker.
const CHATS: Record<string, { address: string; project: string; name: string }> = {
  claude_l1: { address: 'hq/lead-payouts', project: 'hq', name: 'LEAD · Payouts' },
  claude_l2: { address: 'hq/lead-billing', project: 'hq', name: 'LEAD · Billing' },
  claude_l3: { address: 'hq/lead-ops', project: 'hq', name: 'LEAD · Ops' },
  claude_w1: {
    address: 'acme-api/w-payouts-report',
    project: 'acme-api',
    name: 'W · Payouts report'
  },
  claude_w2: { address: 'acme-web/w-payouts-page', project: 'acme-web', name: 'W · Payouts page' },
  claude_w3: { address: 'acme-api/w-payouts-old', project: 'acme-api', name: 'W · Old export' },
  claude_hq: { address: 'hq/notes', project: 'hq', name: 'Notes' }
}
const PLAN = (lead: string) =>
  [
    '# LEAD · Payouts',
    `Lead chat: \`${lead}\` (claude_l1) · started 16.11 · go: «yes»`,
    '| # | Task | Project | Chat | Status | Budget $ | Check |',
    '|---|---|---|---|---|---|---|',
    '| T1 | report | acme-api | w-payouts-report | doing | 20 | `true` |'
  ].join('\n')

function scopeOf(sessionId: string | null | undefined): HqCallerScope {
  const chat = sessionId ? CHATS[sessionId] : undefined
  return chat
    ? {
        kind: 'room',
        room: 'acme',
        project: chat.project,
        sessionId: sessionId ?? null,
        worktreeId: 'w'
      }
    : { kind: 'overview', sessionId: null, worktreeId: null }
}

function live(): HqLiveSession[] {
  return [...bare, ...liveChats()]
}

function liveChats(): HqLiveSession[] {
  return Object.entries(CHATS).map(([sessionId, chat]) => ({
    sessionId,
    address: chat.address,
    project: chat.project,
    workspace: 'acme',
    worktreeId: 'w',
    name: chat.name,
    state: closed.has(sessionId) ? 'closed' : 'done',
    midTurn: false,
    lastActivityAt: 1,
    contextPct: null,
    ownerAt: null,
    onScreen: false,
    tabOpen: !closed.has(sessionId),
    role: db.chats.roleOf(sessionId)
  }))
}

const deliver = async (sessionId: string, prompt: string): Promise<boolean> => {
  if (closed.has(sessionId)) {
    return false
  }
  delivered.push({ sessionId, prompt })
  return true
}

const to = (sessionId: string) => delivered.filter((entry) => entry.sessionId === sessionId)
const parentOf = (sessionId: string) =>
  db.chats.list().links.find((link) => link.sessionId === sessionId)?.parentSessionId

beforeEach(async () => {
  db = new PulseDb(':memory:')
  clock = 1_000_000
  delivered = []
  closed = new Set(['claude_w3'])
  saved = []
  bare = []
  hq = mkdtempSync(join(tmpdir(), 'hq-reassign-'))
  mkdirSync(join(hq, 'runs'))
  writeFileSync(join(hq, 'runs', '2026-11-16-payouts.md'), PLAN('hq/lead-payouts'))
  db.noteSessions(
    Object.entries(CHATS).map(([sessionId, chat]) => ({
      sessionId,
      address: chat.address,
      agent: 'claude',
      worktreeId: 'w',
      workspace: 'acme',
      project: chat.project,
      state: 'working' as const,
      contextPct: null,
      parentSessionId: null,
      taskRef: null,
      at: 1
    }))
  )
  for (const id of ['claude_w1', 'claude_w2', 'claude_w3']) {
    db.chats.link({ sessionId: id, parentSessionId: 'claude_l1', via: 'launch', at: 2 })
    db.chats.setRole({ sessionId: id, role: 'worker', at: 2 })
  }
  db.chats.setRole({ sessionId: 'claude_l1', role: 'lead', at: 2 })
  db.chats.setRole({ sessionId: 'claude_l3', role: 'lead', at: 2 })
  batch = createHqLeadBatch({
    busy: () => false,
    flush: async () => false,
    giveUp: () => {},
    load: async () => saved,
    save: async (held) => {
      saved = held
    },
    now: () => clock,
    schedule: () => () => {},
    log: () => {}
  })
  await batch.start()
  const pulse = {
    record: (inputs: Parameters<PulseDb['recordJournal']>[0]) => db.recordJournal(inputs),
    getSession: (id: string) => db.getSession(id),
    listSessionsByAddress: (address: string) => db.listSessionsByAddress(address),
    roleOf: (id: string) => db.chats.roleOf(id),
    setRole: (input: Parameters<PulseDb['chats']['setRole']>[0]) => db.chats.setRole(input)
  }
  threads = createHqThreads({
    enabled: () => true,
    scope: async (caller) => scopeOf(caller.sessionId),
    pulse: {
      ...pulse,
      list: (query) => db.listJournal(query),
      noteSessions: (inputs) => db.noteSessions(inputs),
      getEntry: (id) => db.getJournalEntry(id),
      listPeople: () => db.listPeople(),
      upsertPerson: (input) => db.upsertPerson(input),
      linkChat: (input) => db.chats.link(input),
      leadMoveOf: (chat, lead) => db.chats.leadMoveOf(chat, lead)
    },
    sessionName: (id) => CHATS[id]?.name ?? null,
    sessionWorkspace: () => 'w',
    deliver,
    reopen: () => false,
    wait: async () => {},
    now: () => (clock += 1_000),
    leadBatch: batch
  })
  reassign = createHqLeadReassign({
    enabled: () => true,
    scope: async (caller) => scopeOf(caller.sessionId),
    pulse: { ...pulse, liveSessionOf: (id: string) => db.chats.liveSessionOf(id) },
    chats: {
      links: () => db.chats.list(),
      moveLead: (input) => db.chats.moveLead(input)
    },
    live: async () => live(),
    deliver,
    leadBatch: batch,
    rewritePlans: (from, next, at, dryRun, only) =>
      hqRewritePlanLeads(hq, from, next, at, dryRun, only),
    now: () => (clock += 1_000)
  })
})

afterEach(() => {
  db.close()
  rmSync(hq, { recursive: true, force: true })
})

describe('orca hq reassign', () => {
  it("hands the old Lead's open chats to the chat that runs it, and tells everyone", async () => {
    const result = await reassign.reassign({ sessionId: 'claude_l2' }, { from: 'hq/lead-payouts' })

    expect(result.moved.map((chat) => [chat.address, chat.told])).toEqual([
      ['acme-api/w-payouts-report', true],
      ['acme-web/w-payouts-page', true]
    ])
    expect(result.kept).toEqual([
      expect.objectContaining({ sessionId: 'claude_w3', why: 'closed' })
    ])
    expect(parentOf('claude_w1')).toBe('claude_l2')
    expect(parentOf('claude_w2')).toBe('claude_l2')
    expect(parentOf('claude_w3')).toBe('claude_l1')
    expect(db.chats.roleOf('claude_l2')).toBe('lead')
    expect(to('claude_w1')[0]?.prompt).toContain(
      'hq/lead-billing leads this chat now, not hq/lead-payouts'
    )
    expect(to('claude_w3')).toEqual([])
    expect(to('claude_l2')[0]?.prompt).toContain(
      'you lead 2 more chats now, taken over from hq/lead-payouts'
    )
    expect(to('claude_l1')[0]?.prompt).toContain(
      '2 of your chats report to the Lead hq/lead-billing'
    )
    expect(result.toldNewLead && result.toldOldLead).toBe(true)
    expect(result.plans).toEqual([join(hq, 'runs', '2026-11-16-payouts.md')])
    expect(readFileSync(result.plans[0], 'utf8')).toContain(
      'Lead chat: `hq/lead-billing` (claude_l2) (was: `hq/lead-payouts`, '
    )
    const rows = db.listJournal({ address: 'acme-api/w-payouts-report', limit: 10 })
    expect(rows.map((row) => row.title)).toEqual([
      'Lead change: hq/lead-billing leads this chat now, not hq/lead-payouts'
    ])
  })

  it('tells the chat that continued the new Lead, though it got another address', async () => {
    db.noteSessions([
      {
        sessionId: 'claude_l2b',
        address: 'hq/lead-billing-2',
        agent: 'claude',
        worktreeId: 'w',
        workspace: 'acme',
        project: 'hq',
        state: 'working',
        contextPct: null,
        parentSessionId: 'claude_l2',
        taskRef: null,
        at: 3
      }
    ])
    const result = await reassign.reassign(
      { sessionId: 'claude_hq' },
      { from: 'hq/lead-payouts', to: 'hq/lead-billing' }
    )
    expect(result.moved).toHaveLength(2)
    expect(result.to?.sessionId).toBe('claude_l2b')
    expect(to('claude_l2')).toEqual([])
    expect(to('claude_l2b')[0]?.prompt).toContain('you lead 2 more chats now')
  })

  it('forwards what a moved chat sends the old Lead; other chats still reach the old Lead', async () => {
    await reassign.reassign({}, { from: 'hq/lead-payouts', to: 'hq/lead-billing' })
    delivered = []

    const moved = await threads.send(
      { sessionId: 'claude_w1' },
      { address: 'hq/lead-payouts', text: 'BLOCKED · T1 · needs a key' }
    )
    expect(moved.sessionId).toBe('claude_l2')
    expect(moved.forwardedFrom).toBe('hq/lead-payouts')
    expect(to('claude_l2')[0]?.prompt).toContain('BLOCKED · T1')

    const byId = await threads.send(
      { sessionId: 'claude_w2' },
      { address: 'claude_l1', text: 'NEEDS DECISION · T2' }
    )
    expect(byId.sessionId).toBe('claude_l2')

    const other = await threads.send(
      { sessionId: 'claude_hq' },
      { address: 'hq/lead-payouts', text: 'BLOCKED · notes' }
    )
    expect(other.sessionId).toBe('claude_l1')
    expect(other.forwardedFrom).toBeUndefined()
  })

  it('hands the new Lead the messages held for the old one', async () => {
    const held = await threads.send(
      { sessionId: 'claude_w1' },
      { address: 'hq/lead-payouts', text: 'DONE · T1 · report merged' }
    )
    expect(held.heldUntil).toBeDefined()

    const result = await reassign.reassign({ sessionId: 'claude_l2' }, { from: 'hq/lead-payouts' })
    expect(result.heldHandedOver).toBe(1)
    expect(to('claude_l2')[0]?.prompt).toContain('DONE · T1 · report merged')
    expect(batch.take('hq/lead-payouts')).toBeNull()
  })

  it('moves only the chats asked for, and leaves the plan and the held messages', async () => {
    await threads.send(
      { sessionId: 'claude_w1' },
      { address: 'hq/lead-payouts', text: 'DONE · T1' }
    )
    const result = await reassign.reassign(
      { sessionId: 'claude_l2' },
      { from: 'hq/lead-payouts', chats: ['claude_w2'] }
    )
    expect(result.moved.map((chat) => chat.sessionId)).toEqual(['claude_w2'])
    expect(result.kept.map((chat) => [chat.sessionId, chat.why])).toEqual([
      ['claude_w3', 'not asked for'],
      ['claude_w1', 'not asked for']
    ])
    expect(result.plans).toEqual([])
    expect(readFileSync(join(hq, 'runs', '2026-11-16-payouts.md'), 'utf8')).toBe(
      PLAN('hq/lead-payouts')
    )
    expect(result.heldHandedOver).toBe(0)
    expect(parentOf('claude_w1')).toBe('claude_l1')
  })

  it('makes a worker the Lead of the others; it does not move under itself', async () => {
    const result = await reassign.reassign({}, { from: 'hq/lead-payouts', to: 'claude_w1' })
    expect(result.kept).toContainEqual(
      expect.objectContaining({ sessionId: 'claude_w1', why: 'it is the new Lead' })
    )
    expect(result.moved.map((chat) => chat.sessionId)).toEqual(['claude_w2'])
    expect(parentOf('claude_w2')).toBe('claude_w1')
    expect(db.chats.roleOf('claude_w1')).toBe('lead')
  })

  it('changes nothing in a dry run', async () => {
    const result = await reassign.reassign(
      { sessionId: 'claude_l2' },
      { from: 'hq/lead-payouts', dryRun: true }
    )
    expect(result.dryRun).toBe(true)
    expect(result.moved).toHaveLength(2)
    expect(result.plans).toHaveLength(1)
    expect(delivered).toEqual([])
    expect(parentOf('claude_w1')).toBe('claude_l1')
    expect(db.chats.roleOf('claude_l2')).toBeNull()
    expect(readFileSync(result.plans[0], 'utf8')).toBe(PLAN('hq/lead-payouts'))
  })

  it('refuses a Lead to itself, a chat that is not under the old Lead and an unknown thread', async () => {
    await expect(
      reassign.reassign({ sessionId: 'claude_l1' }, { from: 'hq/lead-payouts' })
    ).rejects.toThrow('is that Lead already')
    await expect(
      reassign.reassign({}, { from: 'hq/lead-payouts', to: 'hq/lead-billing', chats: ['hq/notes'] })
    ).rejects.toThrow('hq/notes is not a chat of hq/lead-payouts')
    await expect(
      reassign.reassign({}, { from: 'hq/nobody', to: 'hq/lead-billing' })
    ).rejects.toThrow('No chat works on hq/nobody')
    await expect(reassign.reassign({}, { from: 'hq/lead-payouts' })).rejects.toThrow('--to')
  })

  it('a chat moved twice reaches its Lead now from either old one; moving it back undoes it', async () => {
    await reassign.reassign({}, { from: 'hq/lead-payouts', to: 'hq/lead-billing' })
    await reassign.reassign({}, { from: 'hq/lead-billing', to: 'hq/lead-ops' })
    const viaFirst = await threads.send(
      { sessionId: 'claude_w1' },
      { address: 'hq/lead-payouts', text: 'BLOCKED · a' }
    )
    expect(viaFirst.sessionId).toBe('claude_l3')
    expect(parentOf('claude_w1')).toBe('claude_l3')

    await reassign.reassign(
      {},
      { from: 'hq/lead-ops', to: 'hq/lead-payouts', chats: ['acme-api/w-payouts-report'] }
    )
    const home = await threads.send(
      { sessionId: 'claude_w1' },
      { address: 'hq/lead-payouts', text: 'BLOCKED · b' }
    )
    expect(home.sessionId).toBe('claude_l1')
    expect(home.forwardedFrom).toBeUndefined()
    const stale = await threads.send(
      { sessionId: 'claude_w1' },
      { address: 'hq/lead-ops', text: 'BLOCKED · c' }
    )
    expect(stale.sessionId).toBe('claude_l1')
    expect(parentOf('claude_w1')).toBe('claude_l1')
  })

  it('the printed undo puts the chats and the plan back and leaves the new Lead its own', async () => {
    const billing = [
      '# LEAD · Billing',
      'Lead chat: `hq/lead-billing` (claude_l2) · started 10.11'
    ].join('\n')
    writeFileSync(join(hq, 'runs', '2026-11-10-billing.md'), billing)
    db.chats.link({ sessionId: 'claude_hq', parentSessionId: 'claude_l2', via: 'launch', at: 2 })
    const moved = await reassign.reassign({}, { from: 'hq/lead-payouts', to: 'hq/lead-billing' })
    const undo = formatHqReassign(moved)
      .split('\n')
      .find((line) => line.startsWith('Undo: '))
    expect(undo).toBeDefined()
    const flags = new Map(
      [...(undo ?? '').matchAll(/--([a-z-]+) (\S+)/g)].map((match) => [match[1], match[2]])
    )
    await reassign.reassign(
      {},
      {
        from: flags.get('from') ?? '',
        to: flags.get('to'),
        chats: flags.get('chats')?.split(','),
        plans: flags.get('plans')?.split(',')
      }
    )
    expect(parentOf('claude_w1')).toBe('claude_l1')
    expect(parentOf('claude_w2')).toBe('claude_l1')
    expect(parentOf('claude_hq')).toBe('claude_l2')
    expect(readFileSync(join(hq, 'runs', '2026-11-16-payouts.md'), 'utf8')).toContain(
      'Lead chat: `hq/lead-payouts` (claude_l1) (was: `hq/lead-billing`, '
    )
    expect(readFileSync(join(hq, 'runs', '2026-11-10-billing.md'), 'utf8')).toBe(billing)
  })

  describe('chats that have no Lead (T13)', () => {
    const undoOf = (result: Awaited<ReturnType<HqLeadReassign['reassign']>>) => ({
      line: formatHqReassign(result)
        .split('\n')
        .find((line) => line.startsWith('Undo: '))
    })

    beforeEach(() => {
      bare = [
        {
          ...liveChats()[0],
          sessionId: 'b1d0c0de-s3',
          address: null,
          project: 'acme-ai',
          name: 'Support bot fixes',
          role: null
        }
      ]
    })

    it('takes chats with no Lead, by thread or session id, under the new Lead; a dry run changes nothing', async () => {
      const dry = await reassign.reassign(
        {},
        { from: 'none', to: 'hq/lead-billing', chats: ['hq/notes', 'b1d0c0de-s3'], dryRun: true }
      )
      expect(dry.from).toBeNull()
      expect(dry.moved.map((chat) => chat.sessionId)).toEqual(['b1d0c0de-s3', 'claude_hq'])
      expect(parentOf('claude_hq')).toBeUndefined()
      expect(delivered).toEqual([])

      const result = await reassign.reassign(
        { sessionId: 'claude_l2' },
        { chats: ['hq/notes', 'b1d0c0de-s3'] }
      )
      expect(parentOf('claude_hq')).toBe('claude_l2')
      expect(parentOf('b1d0c0de-s3')).toBe('claude_l2')
      expect(db.chats.roleOf('claude_l2')).toBe('lead')
      expect(delivered.map((entry) => entry.sessionId).sort()).toEqual([
        'b1d0c0de-s3',
        'claude_hq',
        'claude_l2'
      ])
      expect([result.toldNewLead, result.toldOldLead, result.plans]).toEqual([true, false, []])
    })

    it('the printed undo leaves the chats with no Lead, after a Lead change and a message from the Lead', async () => {
      const taken = await reassign.reassign(
        {},
        { from: 'none', to: 'hq/lead-billing', chats: ['hq/notes', 'b1d0c0de-s3'] }
      )
      expect(undoOf(taken).line).toBe(
        'Undo: orca hq reassign --from hq/lead-billing --to none --chats b1d0c0de-s3,hq/notes'
      )
      await reassign.reassign({}, { from: 'hq/lead-billing', to: 'hq/lead-ops' })
      expect(parentOf('claude_hq')).toBe('claude_l3')
      // Why: the Lead sending it work writes an ordinary link, which must not survive the undo.
      db.chats.link({ sessionId: 'claude_hq', parentSessionId: 'claude_l3', via: 'send', at: 5 })

      const back = await reassign.reassign(
        {},
        { from: 'hq/lead-ops', to: 'none', chats: ['b1d0c0de-s3', 'hq/notes'] }
      )
      expect(back.to).toBeNull()
      expect(back.moved).toHaveLength(2)
      expect(parentOf('claude_hq')).toBeUndefined()
      expect(parentOf('b1d0c0de-s3')).toBeUndefined()
      expect(undoOf(back).line).toBe(
        'Undo: orca hq reassign --from none --to hq/lead-ops --chats b1d0c0de-s3,hq/notes'
      )
      // Why: nothing forwards what it sends any more — a message to an old Lead reaches that Lead.
      const sent = await threads.send(
        { sessionId: 'claude_hq' },
        { address: 'hq/lead-billing', text: 'BLOCKED · x' }
      )
      expect(sent.sessionId).toBe('claude_l2')
      expect(sent.forwardedFrom).toBeUndefined()

      await reassign.reassign({}, { from: 'none', to: 'hq/lead-ops', chats: ['hq/notes'] })
      expect(parentOf('claude_hq')).toBe('claude_l3')
    })

    it('a chat taken by session id keeps its Lead and its undo after it gets a thread address', async () => {
      await reassign.reassign({}, { from: 'none', to: 'hq/lead-billing', chats: ['b1d0c0de-s3'] })
      db.noteSessions([
        {
          sessionId: 'b1d0c0de-s3',
          address: 'acme-ai/support-bot-fixes',
          agent: 'claude',
          worktreeId: 'w',
          workspace: 'acme',
          project: 'acme-ai',
          state: 'working',
          contextPct: null,
          parentSessionId: null,
          taskRef: null,
          at: 6
        }
      ])
      expect(parentOf('b1d0c0de-s3')).toBe('claude_l2')

      await reassign.reassign({}, { from: 'hq/lead-billing', to: 'hq/lead-ops' })
      expect(parentOf('b1d0c0de-s3')).toBe('claude_l3')
      expect(db.chats.leadMoveOf('acme-ai/support-bot-fixes', 'hq/lead-billing')).toBe(
        'hq/lead-ops'
      )

      await reassign.reassign({}, { from: 'hq/lead-ops', to: 'none', chats: ['b1d0c0de-s3'] })
      expect(parentOf('b1d0c0de-s3')).toBeUndefined()
    })

    it('a chat left with no Lead stays so after it gets an address and hands off, and after its address changes', async () => {
      const note = (sessionId: string, address: string, parent: string | null, at: number) =>
        db.noteSessions([
          {
            sessionId,
            address,
            agent: 'claude',
            worktreeId: 'w',
            workspace: 'acme',
            project: 'acme-ai',
            state: 'working',
            contextPct: null,
            parentSessionId: parent,
            taskRef: null,
            at
          }
        ])
      await reassign.reassign({}, { from: 'none', to: 'hq/lead-billing', chats: ['b1d0c0de-s3'] })
      await reassign.reassign({}, { from: 'hq/lead-billing', to: 'none', chats: ['b1d0c0de-s3'] })
      note('b1d0c0de-s3', 'acme-ai/support-bot-fixes', null, 6)
      note('b1d0c0de-s4', 'acme-ai/support-bot-fixes', 'b1d0c0de-s3', 7)
      db.chats.link({ sessionId: 'b1d0c0de-s4', parentSessionId: 'claude_l2', via: 'send', at: 8 })
      expect(parentOf('b1d0c0de-s4')).toBeUndefined()

      await reassign.reassign({}, { from: 'none', to: 'hq/lead-billing', chats: ['hq/notes'] })
      await reassign.reassign({}, { from: 'hq/lead-billing', to: 'none', chats: ['hq/notes'] })
      note('claude_hq', 'hq/a-notes', null, 9)
      await reassign.reassign({}, { from: 'none', to: 'hq/lead-ops', chats: ['hq/a-notes'] })
      expect(parentOf('claude_hq')).toBe('claude_l3')

      // Why: the older no-Lead row of a chat that joins the thread must not undo the thread's newer move.
      note('b1d0c0de-s3', 'hq/a-notes', null, 10)
      expect(parentOf('claude_hq')).toBe('claude_l3')
      expect(db.chats.leadMoveOf('hq/a-notes', 'hq/lead-billing')).toBeNull()
    })

    it('refuses a chat that has a Lead, none on both sides, none without chats and --plans', async () => {
      await expect(
        reassign.reassign({}, { from: 'none', to: 'hq/lead-billing', chats: ['claude_w1'] })
      ).rejects.toThrow('has a Lead: hq/lead-payouts')
      await expect(reassign.reassign({}, { to: 'hq/lead-billing' })).rejects.toThrow('--chats')
      await expect(reassign.reassign({}, { from: 'hq/lead-payouts', to: 'none' })).rejects.toThrow(
        '--chats'
      )
      await expect(
        reassign.reassign({}, { from: 'none', to: 'none', chats: ['hq/notes'] })
      ).rejects.toThrow('none')
      await expect(
        reassign.reassign(
          {},
          { from: 'none', to: 'hq/lead-billing', chats: ['hq/notes'], plans: ['x.md'] }
        )
      ).rejects.toThrow('--plans')
      expect(parentOf('claude_w1')).toBe('claude_l1')
      expect(parentOf('claude_hq')).toBeUndefined()
    })

    it('keeps the new Lead itself and a chat the new Lead works under', async () => {
      db.chats.link({ sessionId: 'claude_l2', parentSessionId: 'claude_hq', via: 'launch', at: 2 })
      const result = await reassign.reassign(
        {},
        { from: 'none', to: 'hq/lead-billing', chats: ['hq/notes', 'hq/lead-ops'] }
      )
      expect(result.moved.map((chat) => chat.sessionId)).toEqual(['claude_l3'])
      expect(result.kept.map((chat) => chat.sessionId)).toEqual(['claude_hq'])
      expect(parentOf('claude_hq')).toBeUndefined()
      expect(parentOf('claude_l3')).toBe('claude_l2')
    })
  })
})
