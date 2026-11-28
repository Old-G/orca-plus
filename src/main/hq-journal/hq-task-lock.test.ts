// Custom build (hq-task-lock, A3): the plan-row lock, end to end — the CLI's claim / bind / release
// against Orca+'s lock over the pulse table, with the open tabs deciding whether a holder still holds.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import type { HqSession } from '../../shared/hq-journal'
import { createHqTaskLock, HQ_TASK_STARTING_MS, type HqTaskLock } from './hq-task-lock'
import { claimHqTaskLock, withHqTaskLock } from '../../cli/hq-task-lock'
import type { RuntimeClient } from '../../cli/runtime/client'

const LEAD = '11111111-1111-4111-8111-111111111111'
const W1 = '22222222-2222-4222-8222-222222222222'
const W2 = '33333333-3333-4333-8333-333333333333'
const KEY = { plan: '2026-11-28-refunds', row: 'T3' }
const BRIEF = 'W · T3 refund cap. От лида (LEAD · Refunds).\nХод — в runs/2026-11-28-refunds/T3.md.'

const dbs: PulseDb[] = []
afterEach(() => {
  for (const made of dbs.splice(0)) {
    made.close()
  }
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function session(sessionId: string, address: string, closedAt: number | null = null): HqSession {
  return {
    sessionId,
    address,
    agent: 'claude',
    worktreeId: null,
    workspace: 'acme-api',
    project: 'acme-api',
    state: 'working',
    contextPct: null,
    openedAt: 1,
    lastActivityAt: 1,
    closedAt,
    parentSessionId: null,
    taskRef: null
  }
}

function setup(options: { open?: string[] | null; successor?: Record<string, string> } = {}) {
  const db = new PulseDb(':memory:')
  dbs.push(db)
  let clock = 1_000
  const open = { ids: options.open === undefined ? [] : options.open }
  const sessions = new Map<string, HqSession>([
    [W1, session(W1, 'acme-api/w-t3-refund-cap')],
    [W2, session(W2, 'acme-api/w-t3-refund-cap-2')]
  ])
  const lock = createHqTaskLock({
    store: () => db.chats,
    getSession: (id) => sessions.get(id) ?? null,
    liveSessionOf: (id) => options.successor?.[id] ?? id,
    openTabs: () => (open.ids ? new Set(open.ids) : null),
    now: () => clock
  })
  return {
    db,
    lock,
    open,
    sessions,
    tick: (ms: number) => {
      clock += ms
    }
  }
}

/** A CLI client whose `hq.taskLock` is the lock itself, as the RPC method calls it. */
function clientOf(lock: HqTaskLock): Pick<RuntimeClient, 'call' | 'isRemote'> {
  const call = vi.fn(async (method: string, params?: unknown) => {
    expect(method).toBe('hq.taskLock')
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the CLI sends these fields.
    const p = params as Record<string, string>
    const key = { plan: p.plan, row: p.row }
    const result =
      p.action === 'claim'
        ? lock.claim({ ...key, callerSessionId: p.callerSessionId ?? null })
        : p.action === 'bind'
          ? lock.bind({ ...key, ticket: p.ticket, sessionId: p.sessionId })
          : lock.release({ ...key, ticket: p.ticket })
    return { id: 'r', ok: true as const, result }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: claimHqTaskLock only calls `call`.
  return { call, isRemote: false } as unknown as Pick<RuntimeClient, 'call' | 'isRemote'>
}

const startedChat = (sessionId: string) => async () => ({
  result: { outcome: { kind: 'structured' as const, sessionId } }
})

async function launch(
  lock: HqTaskLock,
  started: string,
  flags: Record<string, string> = {},
  prompt = BRIEF
) {
  const client = clientOf(lock)
  const hold = await claimHqTaskLock(client, new Map(Object.entries(flags)), {
    prompt: { text: prompt }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test outcome has the fields the lock reads.
  return withHqTaskLock(hold, startedChat(started) as never)
}

describe('plan-row lock (hq-task-lock, A3)', () => {
  it('refuses a second launch of a row whose chat is open, naming that chat', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('ORCA_AGENT_SESSION_ID', LEAD)
    const t = setup()
    await launch(t.lock, W1)
    expect(t.db.chats.taskLockOf(KEY)?.sessionId).toBe(W1)
    t.open.ids = [LEAD, W1]
    await expect(launch(t.lock, W2)).rejects.toMatchObject({
      code: 'task_locked',
      message: expect.stringContaining(
        'acme-api/w-t3-refund-cap (22222222-2222-4222-8222-222222222222, working)'
      )
    })
    expect(t.db.chats.taskLockOf(KEY)?.sessionId).toBe(W1)
  })

  it('moves the lock to the new chat once the holder is closed', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('ORCA_AGENT_SESSION_ID', LEAD)
    const t = setup({ open: [LEAD] })
    t.db.chats.setTaskLock({ ...KEY, sessionId: W1, at: 1 })
    await launch(t.lock, W2)
    expect(t.db.chats.taskLockOf(KEY)?.sessionId).toBe(W2)
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('lock moves from acme-api/w-t3-refund-cap')
    )
  })

  it('lets the holder start the next chat of its own row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('ORCA_AGENT_SESSION_ID', W1)
    const t = setup({ open: [W1] })
    t.db.chats.setTaskLock({ ...KEY, sessionId: W1, at: 1 })
    await launch(t.lock, W2)
    expect(t.db.chats.taskLockOf(KEY)?.sessionId).toBe(W2)
  })

  it('follows a handoff: the open chat continuing the holder still holds the row', async () => {
    vi.stubEnv('ORCA_AGENT_SESSION_ID', LEAD)
    const t = setup({ open: [W2], successor: { [W1]: W2 } })
    t.db.chats.setTaskLock({ ...KEY, sessionId: W1, at: 1 })
    expect(t.lock.claim({ ...KEY, callerSessionId: LEAD })).toMatchObject({
      taken: false,
      reason: 'open',
      holder: { sessionId: W2 }
    })
  })

  it('reads the journal when the tabs are unknown, as just after a restart', () => {
    const t = setup({ open: null })
    t.db.chats.setTaskLock({ ...KEY, sessionId: W1, at: 1 })
    expect(t.lock.claim({ ...KEY, callerSessionId: LEAD }).taken).toBe(false)
    t.sessions.set(W1, session(W1, 'acme-api/w-t3-refund-cap', 5))
    expect(t.lock.claim({ ...KEY, callerSessionId: LEAD }).taken).toBe(true)
  })

  it('refuses a launch of a row another launch is still starting, until it binds, fails or lapses', async () => {
    const t = setup()
    const first = t.lock.claim({ ...KEY, callerSessionId: LEAD })
    expect(first.taken).toBe(true)
    expect(t.lock.claim({ ...KEY, callerSessionId: LEAD })).toMatchObject({
      taken: false,
      reason: 'starting'
    })
    if (!first.taken) {
      throw new Error('unreachable')
    }
    expect(t.lock.release({ ...KEY, ticket: first.ticket })).toEqual({ released: true })
    const second = t.lock.claim({ ...KEY, callerSessionId: LEAD })
    expect(second.taken).toBe(true)
    t.tick(HQ_TASK_STARTING_MS + 1)
    expect(t.lock.claim({ ...KEY, callerSessionId: LEAD }).taken).toBe(true)
  })

  it('frees the row when the launch throws', async () => {
    vi.stubEnv('ORCA_AGENT_SESSION_ID', LEAD)
    const t = setup()
    const client = clientOf(t.lock)
    const hold = await claimHqTaskLock(client, new Map(), { prompt: { text: BRIEF } })
    await expect(
      withHqTaskLock(hold, async () => {
        throw new Error('setup failed')
      })
    ).rejects.toThrow('setup failed')
    expect(t.lock.claim({ ...KEY, callerSessionId: LEAD }).taken).toBe(true)
    expect(t.db.chats.taskLockOf(KEY)).toBeNull()
  })

  it('locks nothing for a terminal start, a prompt without a row, --task none or a replay', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const t = setup()
    const client = clientOf(t.lock)
    const hold = await claimHqTaskLock(client, new Map(), { prompt: { text: BRIEF } })
    await withHqTaskLock(
      hold,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the lock reads only outcome.kind.
      async () => ({ result: { outcome: { kind: 'terminal' as const } } }) as never
    )
    expect(t.db.chats.taskLockOf(KEY)).toBeNull()
    expect(
      await claimHqTaskLock(client, new Map(), { prompt: { text: 'Fix the build' } })
    ).toBeNull()
    expect(
      await claimHqTaskLock(client, new Map([['task', 'none']]), { prompt: { text: BRIEF } })
    ).toBeNull()
    expect(
      await claimHqTaskLock(client, new Map(), { prompt: { text: BRIEF }, operationId: 'op-1' })
    ).toBeNull()
  })

  it('takes the row --task names over the brief', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const t = setup()
    await launch(t.lock, W1, { task: '2026-11-28-refunds:T9' })
    expect(t.db.chats.taskLockOf({ plan: '2026-11-28-refunds', row: 'T9' })?.sessionId).toBe(W1)
    expect(t.db.chats.taskLockOf(KEY)).toBeNull()
  })

  it('starts as before when the host cannot lock', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: claimHqTaskLock only calls `call`.
    const client = {
      isRemote: false,
      call: vi.fn(async () => {
        throw new Error('Unknown method hq.taskLock')
      })
    } as unknown as Pick<RuntimeClient, 'call' | 'isRemote'>
    expect(await claimHqTaskLock(client, new Map(), { prompt: { text: BRIEF } })).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('T3 of 2026-11-28-refunds is not locked')
    )
  })
})
