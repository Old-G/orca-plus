// Custom build (hq-dispatcher-cleanup A5, hq-cold-handoff L3, 28.11): which chats the sweep closes by
// itself, and when a message to a quiet, full chat starts a new chat instead.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HQ_JOURNAL_KIND, type HqJournalInput } from '../../shared/hq-journal'
import type { HqDispatcherCleanupMode, HqLiveSession } from '../../shared/hq-sessions'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { decideHqColdChat } from './hq-cold-chat'
import { decideHqChatCleanup } from './hq-session-cleanup'
import { createHqSessions, type HqSessionsService } from './hq-sessions'

const MIN = 60_000
const HOUR = 60 * MIN
const T0 = new Date(2026, 10, 28, 15, 0).getTime()

function chat(sessionId: string, over: Partial<HqLiveSession> = {}): HqLiveSession {
  return {
    sessionId,
    address: `acme-api/${sessionId}`,
    project: 'acme-api',
    workspace: 'acme',
    worktreeId: 'r-api::/w/api',
    name: sessionId,
    state: 'done',
    midTurn: false,
    lastActivityAt: T0 - 3 * HOUR,
    contextPct: 20,
    ownerAt: null,
    onScreen: false,
    tabOpen: true,
    role: 'worker',
    ...over
  }
}

function report(sessionId: string, at: number): HqJournalInput {
  return {
    workspace: 'acme',
    kind: HQ_JOURNAL_KIND.chatReport,
    at,
    project: 'acme-api',
    address: `acme-api/${sessionId}`,
    sessionId,
    personId: null,
    title: `DONE ${sessionId}`,
    body: 'Done',
    needs: 'nobody',
    status: 'done',
    replyTo: null,
    refKind: 'session',
    refId: sessionId,
    source: 'chat-report',
    dedupeKey: `chat-report:${sessionId}:${at}`
  }
}

describe('decideHqChatCleanup (A5)', () => {
  const launched =
    (at = T0 - 4 * HOUR) =>
    () => ({ by: 'claude_lead', at })
  const base = {
    onRow: new Set<string>(),
    launch: launched(),
    hasReport: () => true,
    now: T0
  }
  const ids = (input: Parameters<typeof decideHqChatCleanup>[0]) =>
    decideHqChatCleanup(input).map((action) => `${action.sessionId}:${action.reason}`)

  it('closes a finished launched chat quiet 2 h with a report, and a parked one at once', () => {
    expect(
      ids({
        ...base,
        sessions: [
          chat('quiet'),
          chat('fresh', { lastActivityAt: T0 - HOUR }),
          chat('parked', { lastActivityAt: T0 - MIN, handedOffTo: 'next' })
        ]
      })
    ).toEqual(['quiet:quiet', 'parked:parked'])
  })

  it('leaves working, waiting, closed, on-screen, owner-read, Lead and plan-row chats', () => {
    expect(
      ids({
        ...base,
        onRow: new Set(['row']),
        sessions: [
          chat('working', { state: 'working', midTurn: true }),
          chat('waiting', { state: 'waiting' }),
          chat('closed', { state: 'closed', tabOpen: false }),
          chat('shown', { onScreen: true }),
          chat('read', { ownerAt: T0 - 10 * MIN }),
          chat('lead', { role: 'lead' }),
          chat('row')
        ]
      })
    ).toEqual([])
  })

  it('never closes a chat the owner opened himself unless it is parked', () => {
    expect(
      ids({
        ...base,
        launch: () => null,
        sessions: [chat('mine'), chat('mine-parked', { handedOffTo: 'next' })]
      })
    ).toEqual(['mine-parked:parked'])
  })

  it('closes a launch never used after 30 min, not a young one or one that worked', () => {
    const sessions = [chat('empty', { lastActivityAt: 0 })]
    expect(ids({ ...base, hasReport: () => false, sessions })).toEqual(['empty:empty'])
    expect(
      ids({ ...base, hasReport: () => false, launch: launched(T0 - 10 * MIN), sessions })
    ).toEqual([])
    expect(
      ids({
        ...base,
        hasReport: () => false,
        sessions: [chat('worked', { lastActivityAt: T0 - 3 * HOUR + 30 * MIN })]
      })
    ).toEqual([])
  })

  it('closes nothing when the plan rows are not known, and at most five a sweep', () => {
    const many = Array.from({ length: 8 }, (_, i) => chat(`c${i}`))
    expect(ids({ ...base, onRow: null, sessions: many })).toEqual([])
    expect(ids({ ...base, sessions: many })).toHaveLength(5)
  })
})

describe('decideHqColdChat (L3)', () => {
  const cold = (over: Partial<HqLiveSession> = {}, tokens: number | null = 120_000) =>
    decideHqColdChat({ session: chat('w', over), tokens, from: 'claude_lead', now: T0 }).cold

  it('is cold only when quiet over an hour with 100k+ tokens', () => {
    expect(cold()).toBe(true)
    expect(cold({ lastActivityAt: T0 - 30 * MIN })).toBe(false)
    expect(cold({}, 50_000)).toBe(false)
    expect(cold({}, null)).toBe(false)
  })

  it('never for a Lead, a chat mid-turn, one the owner is in, or one writing to itself', () => {
    expect(cold({ role: 'lead' })).toBe(false)
    expect(cold({ midTurn: true, state: 'waiting' })).toBe(false)
    expect(cold({ onScreen: true })).toBe(false)
    expect(decideHqColdChat({ session: chat('w'), tokens: 200_000, from: 'w', now: T0 }).cold).toBe(
      false
    )
  })
})

describe('the sweep and the send (A5, L3)', () => {
  let db: PulseDb
  let live: HqLiveSession[]
  let cleanup: HqDispatcherCleanupMode
  let coldOn: boolean
  let closed: string[]
  let launched: string[]
  let delivered: { sessionId: string; prompt: string }[]
  let service: HqSessionsService

  beforeEach(() => {
    db = new PulseDb(':memory:')
    live = []
    cleanup = 'on'
    coldOn = false
    closed = []
    launched = []
    delivered = []
    service = createHqSessions({
      mode: () => 'off',
      enabled: () => true,
      autoHandoff: () => false,
      roomOf: async () => 'acme',
      dispatcherCaller: () => ({ cwd: '/hq' }),
      pulse: {
        list: (query) => db.listJournal(query),
        record: (inputs) => db.recordJournal(inputs),
        noteSessions: (inputs) => db.noteSessions(inputs),
        getSession: (sessionId) => db.getSession(sessionId),
        releaseAddress: (sessionId, address, at) => db.releaseSessionAddress(sessionId, address, at)
      },
      live: async () => live,
      send: async () => {
        throw new Error('not used')
      },
      workspaceFor: async (_project, worktreeId) => ({
        worktreeId: worktreeId ?? 'r-api::/w/api',
        name: 'Acme API'
      }),
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
      offers: () => [],
      startHandoff: async () => ({ ok: true }),
      planLeads: async () => [],
      launchedBy: () => null,
      reassignLead: async () => ({ ok: true, moved: 0 }),
      closeChat: async (sessionId) => {
        closed.push(sessionId)
        return true
      },
      cleanupMode: () => cleanup,
      planRowChats: () => new Set(['row']),
      launchOf: (sessionId) =>
        sessionId === 'mine' ? null : { by: 'claude_lead', at: T0 - 5 * HOUR },
      coldChatHandoff: () => coldOn,
      contextTokens: async () => 150_000,
      sync: async () => {},
      now: () => T0,
      log: () => {}
    })
  })

  afterEach(() => db.close())

  it('closes only done chats off every plan row, with the dispatcher itself off', async () => {
    db.recordJournal(['done1', 'row', 'mine', 'lead'].map((id) => report(id, T0 - 3 * HOUR)))
    live = [
      chat('done1'),
      chat('row'),
      chat('mine'),
      chat('lead', { role: 'lead' }),
      chat('busy', { state: 'working', midTurn: true })
    ]
    const result = await service.sweep({ run: true })
    expect(result.actions.filter((action) => action.kind === 'cleanup')).toHaveLength(1)
    expect(closed).toEqual(['done1'])
    expect(db.listJournal({ kind: HQ_JOURNAL_KIND.sessionClose })).toHaveLength(1)
  })

  it('report mode writes «Would close» and closes nothing; off lists nothing', async () => {
    db.recordJournal([report('done1', T0 - 3 * HOUR)])
    live = [chat('done1')]
    cleanup = 'report'
    await service.sweep({ run: true })
    expect(closed).toEqual([])
    expect(db.listJournal({ kind: HQ_JOURNAL_KIND.sessionPlan })[0]?.title).toMatch(
      /^Would close acme-api\/done1 to History/
    )
    cleanup = 'off'
    expect((await service.sweep()).actions).toEqual([])
  })

  it('a message to a cold chat opens a new chat from its report; off, it goes as before', async () => {
    live = [chat('w')]
    expect(await service.coldHandoff({ sessionId: 'w', work: 'next step', from: null })).toBe(null)
    coldOn = true
    expect(await service.coldHandoff({ sessionId: 'w', work: 'next step', from: null })).toBe(
      'claude_new1'
    )
    expect(delivered[0]?.sessionId).toBe('claude_new1')
    expect(delivered[0]?.prompt).toContain('next step')
    expect(db.getSession('claude_new1')?.parentSessionId).toBe('w')
  })
})
