import { describe, expect, it } from 'vitest'
import type { HqRouterChat } from '../../../shared/hq-router'
import type { PulseDraft } from '../../../shared/pulse-types'
import { outgoingWorkPlan, type OutgoingWorkSources } from './outgoing-work'

const chat = (
  id: string,
  role: HqRouterChat['role'],
  extra: Partial<HqRouterChat> = {}
): HqRouterChat => ({
  sessionId: id,
  title: `Chat ${id}`,
  project: 'acme',
  repoId: null,
  role,
  leadId: null,
  taskRef: null,
  lastReport: null,
  waitsOnAuthor: [],
  lastActivityAt: 1,
  ...extra
})

const draft = (body: string, toolInput: Record<string, unknown> = {}): PulseDraft =>
  ({
    id: 'd1',
    body,
    target: 'C0AAAAAAAAA',
    call: {
      service: 'Slack',
      operation: 'send message',
      agentSessionId: 'ask',
      toolInput,
      cwd: '/p/acme'
    }
  }) as unknown as PulseDraft

function sources(over: Partial<OutgoingWorkSources> = {}): OutgoingWorkSources {
  return {
    senderWork: () => ({ work: 'ask', known: false }),
    threadWork: () => null,
    chats: () => [
      chat('W1', 'worker', { taskRef: 'DEV-123' }),
      chat('L1', 'lead', { lastActivityAt: 5 }),
      chat('L2', 'lead', { lastActivityAt: 9 }),
      chat('L3', 'lead', { lastActivityAt: 2 })
    ],
    workOfChat: (id) => (id === 'W2' ? 'W1' : id),
    liveChat: (work) => (work === 'W1' ? 'W2' : work),
    title: (id) => `Chat ${id}`,
    ...over
  }
}

describe('outgoing work plan (router v2 T1)', () => {
  it('a chat with a work of its own binds it; the thread’s and the open Leads are the other picks', () => {
    const plan = outgoingWorkPlan(
      draft('Status update', { thread_ts: '1792000000.000100' }),
      sources({
        senderWork: () => ({ work: 'W1', known: true }),
        threadWork: () => 'L1'
      })
    )
    expect(plan).toEqual({
      current: 'W1',
      suggested: false,
      choices: [
        { id: 'W1', title: 'Chat W2', why: 'this chat’s work' },
        { id: 'L1', title: 'Chat L1', why: 'this thread’s work' },
        { id: 'L2', title: 'Chat L2', why: 'an open Lead' }
      ]
    })
  })

  it('a one-off chat gets the router’s guess: the thread’s work first', () => {
    const plan = outgoingWorkPlan(
      draft('About DEV-123', { thread_ts: '1792000000.000100' }),
      sources({ threadWork: () => 'L3' })
    )
    expect(plan?.current).toBe('L3')
    expect(plan?.suggested).toBe(true)
    expect(plan?.choices.map((choice) => choice.id)).toEqual(['L3', 'W1', 'ask', 'L2', 'L1'])
  })

  it('a one-off chat with no bound thread gets the work its text names, else stays its own', () => {
    expect(outgoingWorkPlan(draft('DEV-123 is merged'), sources())?.current).toBe('W1')
    const plain = outgoingWorkPlan(draft('Thanks!'), sources())
    expect(plain).toMatchObject({ current: 'ask', suggested: false })
  })

  it('offers nothing without a sending chat', () => {
    const none = { ...draft('x'), call: { ...draft('x').call, agentSessionId: null } }
    expect(outgoingWorkPlan(none as PulseDraft, sources())).toBeNull()
  })
})
