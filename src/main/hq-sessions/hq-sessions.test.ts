import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HQ_JOURNAL_KIND, type HqJournalInput } from '../../shared/hq-journal'
import type { HqLiveSession, HqSessionDispatchMode } from '../../shared/hq-sessions'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { createHqSessions, type HqHandoffOfferRef, type HqSessionsService } from './hq-sessions'

const MIN = 60_000
const HOUR = 60 * MIN
const T0 = new Date(2026, 9, 24, 15, 0).getTime()

let db: PulseDb
let clock: number
let mode: HqSessionDispatchMode
let auto: boolean
let journalOn: boolean
let live: HqLiveSession[]
let offers: HqHandoffOfferRef[]
let sent: { address: string; text: string }[]
let sendFails: boolean
let launched: string[]
let delivered: { sessionId: string; prompt: string }[]
let handoffs: string[]
let service: HqSessionsService

function chat(over: Partial<HqLiveSession> = {}): HqLiveSession {
  return {
    sessionId: 'claude_old',
    address: 'acme-api/refunds',
    project: 'acme-api',
    workspace: 'acme',
    worktreeId: 'r-api::/w/api',
    name: 'refunds',
    state: 'done',
    midTurn: false,
    lastActivityAt: clock - 2 * HOUR,
    contextPct: 20,
    ownerAt: null,
    onScreen: false,
    tabOpen: true,
    ...over
  }
}

function report(sessionId: string, at: number, title: string, needs = 'nobody'): HqJournalInput {
  return {
    workspace: 'acme',
    kind: HQ_JOURNAL_KIND.chatReport,
    at,
    project: 'acme-api',
    address: 'acme-api/refunds',
    sessionId,
    personId: null,
    title,
    body: `Done: ${title}`,
    needs,
    status: needs === 'nobody' ? 'done' : 'open',
    replyTo: null,
    refKind: 'session',
    refId: sessionId,
    source: 'chat-report',
    dedupeKey: `chat-report:${sessionId}:${at}`
  }
}

function noteOld(at: number): void {
  db.noteSessions([
    {
      sessionId: 'claude_old',
      address: 'acme-api/refunds',
      agent: 'claude',
      worktreeId: 'r-api::/w/api',
      workspace: 'acme',
      project: 'acme-api',
      state: 'done',
      contextPct: null,
      parentSessionId: null,
      taskRef: null,
      at
    }
  ])
}

beforeEach(() => {
  db = new PulseDb(':memory:')
  clock = T0
  mode = 'on'
  auto = false
  journalOn = true
  live = []
  offers = []
  sent = []
  sendFails = false
  launched = []
  delivered = []
  handoffs = []
  service = createHqSessions({
    mode: () => mode,
    enabled: () => journalOn,
    autoHandoff: () => auto,
    roomOf: async (project) => (project === 'kite' ? 'hobby' : 'acme'),
    dispatcherCaller: () => ({ cwd: '/hq' }),
    pulse: {
      list: (query) => db.listJournal(query),
      record: (inputs) => db.recordJournal(inputs),
      noteSessions: (inputs) => db.noteSessions(inputs),
      getSession: (sessionId) => db.getSession(sessionId)
    },
    live: async () => live,
    send: async (_caller, message) => {
      if (sendFails) {
        throw new Error('the chat is closed')
      }
      sent.push(message)
      const [entry] = db.listJournal({ limit: 1 })
      return { entry: entry!, sessionId: 'claude_old', reopened: false }
    },
    workspaceFor: async (project, worktreeId) =>
      project === 'acme-api'
        ? { worktreeId: worktreeId ?? 'r-api::/w/api', name: 'Acme API' }
        : null,
    launch: async (worktreeId) => {
      launched.push(worktreeId)
      return { ok: true, sessionId: `claude_new${launched.length}`, worktreeId }
    },
    limit: async () => true,
    nameChat: async () => {},
    deliver: async (sessionId, prompt) => {
      delivered.push({ sessionId, prompt })
      return true
    },
    offers: () => offers,
    startHandoff: async (offerId) => {
      handoffs.push(offerId)
      return { ok: true }
    },
    sync: async () => {},
    now: () => clock,
    log: () => {}
  })
})

afterEach(() => db.close())

const rows = (kind: string) => db.listJournal({ kind, oldestFirst: true })

describe('HQ+ session dispatcher', () => {
  it('in report mode only writes what it would do', async () => {
    mode = 'report'
    live = [chat()]
    const result = await service.dispatch(
      { cwd: '/w/api' },
      {
        address: 'acme-api/refunds',
        prompt: 'Cap partial refunds'
      }
    )
    expect(result).toMatchObject({ acted: false, decision: { kind: 'continue' } })
    expect(sent).toEqual([])
    expect(rows(HQ_JOURNAL_KIND.sessionPlan).map((row) => row.title)).toEqual([
      'Would continue acme-api/refunds in its chat — «refunds»: context 20%, active 2.0 h ago'
    ])
  })

  it('continues the thread in its chat, and takes it over when that chat will not', async () => {
    db.recordJournal([report('claude_old', clock - 2 * HOUR, 'Refund cap drafted')])
    live = [chat()]
    const continued = await service.dispatch(
      { cwd: '/w/api' },
      {
        address: 'acme-api/refunds',
        prompt: 'Add the test for two partial refunds'
      }
    )
    expect(continued).toMatchObject({ acted: true, sessionId: 'claude_old' })
    expect(sent).toEqual([
      { address: 'acme-api/refunds', text: 'Add the test for two partial refunds' }
    ])
    expect(rows(HQ_JOURNAL_KIND.sessionContinue)).toHaveLength(1)

    noteOld(clock - 2 * HOUR)
    sendFails = true
    const taken = await service.dispatch(
      { cwd: '/w/api' },
      {
        address: 'acme-api/refunds',
        prompt: 'Ship it'
      }
    )
    expect(taken).toMatchObject({
      acted: true,
      sessionId: 'claude_new1',
      decision: { kind: 'new', seedFrom: 'claude_old' }
    })
    expect(launched).toEqual(['r-api::/w/api'])
    expect(delivered[0].prompt).toContain('Refund cap drafted')
    expect(delivered[0].prompt).toContain('orca hq thread acme-api/refunds')
    expect(db.getSession('claude_new1')).toMatchObject({
      address: 'acme-api/refunds',
      parentSessionId: 'claude_old',
      state: 'working'
    })
    expect(rows(HQ_JOURNAL_KIND.sessionOpen)).toHaveLength(1)
  })

  it('queues work while the thread’s chat is mid-turn, and the sweep starts it afterwards', async () => {
    live = [chat({ state: 'working', midTurn: true, lastActivityAt: clock - MIN })]
    const queued = await service.dispatch(
      { cwd: '/w/api' },
      {
        address: 'acme-api/refunds',
        prompt: 'Cap partial refunds'
      }
    )
    expect(queued).toMatchObject({ acted: true, decision: { kind: 'queue' } })
    expect(rows(HQ_JOURNAL_KIND.sessionQueued)).toMatchObject([
      { needs: 'agent:acme-api/refunds', status: 'open', body: 'Cap partial refunds' }
    ])
    expect((await service.sweep({ run: true })).actions).toEqual([])

    live = [chat({ contextPct: 70 })]
    const swept = await service.sweep({ run: true })
    expect(swept.actions).toMatchObject([{ kind: 'drain', decision: { kind: 'new' } }])
    expect(launched).toHaveLength(1)
    expect(delivered[0].prompt).toContain('Cap partial refunds')
    expect(rows(HQ_JOURNAL_KIND.sessionQueued)[0]?.status).toBe('done')
  })

  it('lets a chat of another room hand work to a thread', async () => {
    live = [chat()]
    const sent = await service.dispatch(
      { cwd: '/w/kite' },
      { address: 'acme-api/refunds', prompt: 'x', dryRun: true }
    )
    expect(sent.decision).toMatchObject({ kind: 'continue', address: 'acme-api/refunds' })
  })

  it('starts a handoff nobody took up; report mode notes it once', async () => {
    offers = [{ id: 'h1', sessionId: 'claude_old', raisedAt: clock - MIN, limitStopped: false }]
    live = [chat()]
    expect((await service.sweep({ run: true })).actions).toEqual([])
    clock += 5 * MIN
    mode = 'report'
    await service.sweep({ run: true })
    await service.sweep({ run: true })
    expect(handoffs).toEqual([])
    expect(rows(HQ_JOURNAL_KIND.sessionPlan)).toHaveLength(1)
    mode = 'on'
    await service.sweep({ run: true })
    expect(handoffs).toEqual(['h1'])
    // The evening count of manual routing tells this start from a hand one by its row.
    expect(rows(HQ_JOURNAL_KIND.sessionOpen).map((row) => row.dedupeKey)).toEqual([
      'session.open:handoff:h1'
    ])
  })

  describe('the new chat after a handoff, by its own switch (18.13)', () => {
    const offer = (over: Partial<HqHandoffOfferRef> = {}): HqHandoffOfferRef => ({
      id: 'h1',
      sessionId: 'claude_old',
      raisedAt: clock - 30_000,
      limitStopped: false,
      ...over
    })
    // The launcher drops an offer it started, so a later sweep no longer sees it.
    const takeUp = (): void => {
      offers = offers.filter((candidate) => !handoffs.includes(candidate.id))
    }

    beforeEach(() => {
      auto = true
      mode = 'report'
      live = [chat()]
    })

    it('starts one new chat per handoff, in report mode and with the dispatcher off', async () => {
      offers = [offer()]
      await service.sweep({ run: true })
      takeUp()
      await service.sweep({ run: true })
      expect(handoffs).toEqual(['h1'])
      expect(rows(HQ_JOURNAL_KIND.sessionPlan)).toEqual([])
      expect(rows(HQ_JOURNAL_KIND.sessionOpen).map((row) => row.dedupeKey)).toEqual([
        'session.open:handoff:h1'
      ])

      mode = 'off'
      offers = [offer({ id: 'h2', sessionId: 'claude_two' })]
      await service.sweep({ run: true })
      expect(handoffs).toEqual(['h1', 'h2'])
    })

    it('two sweeps at once start it once', async () => {
      offers = [offer()]
      await Promise.all([service.sweep({ run: true }), service.sweep({ run: true })])
      expect(handoffs).toEqual(['h1'])
    })

    it('leaves the chat on the owner’s screen to him, and goes once he looks away', async () => {
      offers = [offer()]
      live = [chat({ onScreen: true, ownerAt: clock })]
      await service.sweep({ run: true })
      expect(handoffs).toEqual([])
      live = [chat({ ownerAt: clock - 10_000 })]
      await service.sweep({ run: true })
      expect(handoffs).toEqual(['h1'])
    })

    it('does not start one the owner already took up with the button', async () => {
      offers = [offer()]
      // The button started it a moment ago: the launcher no longer lists the offer.
      offers = []
      await service.sweep({ run: true })
      expect(handoffs).toEqual([])
      expect(rows(HQ_JOURNAL_KIND.sessionOpen)).toEqual([])
    })

    it('waits out its few seconds, and a chat stopped on a limit until the limit lifts', async () => {
      offers = [offer({ raisedAt: clock - 5_000 })]
      await service.sweep({ run: true })
      offers = [offer({ limitStopped: true })]
      await service.sweep({ run: true })
      expect(handoffs).toEqual([])
      offers = [offer()]
      await service.sweep({ run: true })
      expect(handoffs).toEqual(['h1'])
    })

    it('switched off, leaves the handoff to the dispatcher’s mode', async () => {
      auto = false
      offers = [offer({ raisedAt: clock - 5 * MIN })]
      await service.sweep({ run: true })
      expect(handoffs).toEqual([])
      expect(rows(HQ_JOURNAL_KIND.sessionPlan)).toHaveLength(1)
    })

    it('with the journal off, starts it and writes nothing', async () => {
      journalOn = false
      offers = [offer()]
      await service.sweep({ run: true })
      expect(handoffs).toEqual(['h1'])
      expect(rows(HQ_JOURNAL_KIND.sessionOpen)).toEqual([])
    })
  })

  it('reports work waiting on a thread no chat is on', async () => {
    db.recordJournal([
      {
        ...report('claude_old', clock - 20 * MIN, 'Bob answered'),
        kind: HQ_JOURNAL_KIND.personReply,
        needs: 'agent:acme-api/refunds',
        status: 'open',
        dedupeKey: 'reply-1'
      }
    ])
    live = [chat({ tabOpen: false, state: 'closed' })]
    const result = await service.sweep()
    expect(result.actions).toMatchObject([{ kind: 'lost', address: 'acme-api/refunds' }])
    live = [chat()]
    expect((await service.sweep()).actions).toEqual([])
  })

  it('lets a chat close only once its last turn is in the journal, and notes the close', async () => {
    noteOld(clock - 13 * HOUR)
    live = [chat({ midTurn: true, state: 'waiting' })]
    expect(await service.mayClose('claude_old', 'cleanup')).toEqual({
      ok: false,
      why: 'its turn has not ended'
    })
    live = []
    expect(await service.mayClose('claude_old', 'cleanup')).toEqual({
      ok: false,
      why: 'its last turn has no report in the journal yet'
    })
    db.recordJournal([report('claude_old', clock - 13 * HOUR, 'Refund cap merged')])
    expect(await service.mayClose('claude_old', 'cleanup')).toEqual({ ok: true })
    expect(rows(HQ_JOURNAL_KIND.sessionClose)[0]?.title).toBe('Closed to History: quiet 13 h')
    expect(db.getSession('claude_old')).toMatchObject({
      state: 'closed',
      closedAt: clock - 13 * HOUR,
      lastActivityAt: clock - 13 * HOUR
    })
  })
})
