import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import type { RuntimeClient } from '../runtime-client'
import { PULSE_HANDLERS } from './pulse'

// Made-up people, not real data.
const people = [
  { id: 'p-ann', name: 'Ann', slackUserId: 'U1', clickupUserId: null, role: 'PM', notes: null },
  { id: 'p-anna', name: 'Anna', slackUserId: null, clickupUserId: null, role: null, notes: null },
  { id: 'p-bob', name: 'Bob', slackUserId: null, clickupUserId: null, role: null, notes: null }
].map((p) => ({ ...p, createdAt: 1, updatedAt: 1 }))

type Calls = { method: string; params: unknown }[]

function run(
  command: string,
  flags: Record<string, string | boolean>,
  replies: Record<string, unknown> = {}
): { done: Promise<void>; calls: Calls; printed: string[] } {
  const calls: Calls = []
  const printed: string[] = []
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    printed.push(String(line))
  })
  const call = vi.fn(async (method: string, params?: unknown) => {
    calls.push({ method, params })
    const reply =
      method in replies ? replies[method] : method === 'pulse.listPeople' ? people : { id: 'x' }
    return { id: 'r', ok: true, result: reply }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers only use client.call.
  const client = { call } as unknown as RuntimeClient
  const ctx: HandlerContext = {
    flags: new Map(Object.entries(flags)),
    client,
    cwd: '/tmp',
    json: false,
    rawArgs: []
  }
  return { done: PULSE_HANDLERS[command](ctx), calls, printed }
}

const paramsOf = (calls: Calls, method: string) => calls.find((c) => c.method === method)?.params

afterEach(() => {
  vi.restoreAllMocks()
})

describe('orca pulse wait add', () => {
  it('resolves --person by exact name and defaults the source to agent', async () => {
    const { done, calls } = run('pulse wait add', {
      direction: 'on-them',
      title: 'Contract',
      person: 'ann',
      due: '2026-10-01'
    })
    await done
    expect(paramsOf(calls, 'pulse.addWaiting')).toMatchObject({
      direction: 'on-them',
      title: 'Contract',
      personId: 'p-ann',
      source: 'agent',
      dueAt: Date.parse('2026-10-01')
    })
  })

  it('adds an unknown name as a new person', async () => {
    const { done, calls } = run(
      'pulse wait add',
      { direction: 'on-me', title: 'Review', person: 'Carol' },
      { 'pulse.upsertPerson': { id: 'p-carol', name: 'Carol' } }
    )
    await done
    expect(paramsOf(calls, 'pulse.upsertPerson')).toEqual({ name: 'Carol' })
    expect(paramsOf(calls, 'pulse.addWaiting')).toMatchObject({ personId: 'p-carol' })
  })

  it('refuses a name that matches several people, a missing direction and a bad date', async () => {
    await expect(
      run('pulse wait add', { direction: 'on-me', title: 't', person: 'an' }).done
    ).rejects.toThrow(/matches several people: Ann \(p-ann\), Anna \(p-anna\)/)
    await expect(run('pulse wait add', { title: 't' }).done).rejects.toThrow(/--direction/)
    await expect(
      run('pulse wait add', { direction: 'on-me', title: 't', due: 'soon' }).done
    ).rejects.toThrow(/--due/)
  })
})

describe('orca pulse wait list and resolve', () => {
  it('lists open waitings by default and all with --status all', async () => {
    const open = run('pulse wait list', {}, { 'pulse.listWaitings': [] })
    await open.done
    expect(paramsOf(open.calls, 'pulse.listWaitings')).toMatchObject({ status: 'open' })
    expect(open.printed).toEqual(['No waitings.'])
    const all = run('pulse wait list', { status: 'all' }, { 'pulse.listWaitings': [] })
    await all.done
    expect(paramsOf(all.calls, 'pulse.listWaitings')).toMatchObject({ status: undefined })
  })

  it('cancels with --cancel', async () => {
    const { done, calls } = run('pulse wait resolve', { id: 'w1', cancel: true })
    await done
    expect(paramsOf(calls, 'pulse.closeWaiting')).toEqual({
      id: 'w1',
      status: 'cancelled',
      resolution: undefined
    })
  })
})

describe('orca pulse draft', () => {
  it('says when a draft with that fingerprint already exists', async () => {
    const { done, printed } = run(
      'pulse draft add',
      { kind: 'clickup-task', body: 'Fix login', fingerprint: 'f1' },
      { 'pulse.addDraft': { created: false, record: { id: 'd1', status: 'rejected' } } }
    )
    await done
    expect(printed).toEqual(['Draft d1 already exists (rejected); nothing added.'])
  })

  it('refuses an unknown kind', async () => {
    await expect(run('pulse draft add', { kind: 'email', body: 'x' }).done).rejects.toThrow(
      /--kind must be one of/
    )
  })
})

describe('orca pulse person show', () => {
  it('shows the person with only their decisions', async () => {
    const { done, printed } = run(
      'pulse person show',
      { person: 'Bob' },
      {
        'pulse.listWaitings': [],
        'pulse.listDecisions': [
          { id: 'd1', title: 'Hire', personId: 'p-bob', decidedAt: Date.parse('2026-09-01') },
          { id: 'd2', title: 'Other', personId: 'p-ann', decidedAt: Date.parse('2026-09-02') }
        ]
      }
    )
    await done
    const text = printed.join('\n')
    expect(text).toContain('Bob  p-bob')
    expect(text).toContain('2026-09-01 Hire')
    expect(text).not.toContain('Other')
  })

  it('never creates a person', async () => {
    const { done, calls } = run('pulse person show', { person: 'Zed' })
    await expect(done).rejects.toThrow(/No person matches "Zed"/)
    expect(calls.some((c) => c.method === 'pulse.upsertPerson')).toBe(false)
  })
})
