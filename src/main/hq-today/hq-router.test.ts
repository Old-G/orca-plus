import { describe, expect, it, vi } from 'vitest'
import type { HqRouterChat } from '../../shared/hq-router'
import { hqRouterKey, hqRouterLinkedMessage, routeHqIntake, type HqRouterDeps } from './hq-router'
import type { HqIntakeDraft } from './hq-slack-intake-suggest'

const NOW = 1_800_000_000_000
const chat = (id: string, extra: Partial<HqRouterChat> = {}): HqRouterChat => ({
  sessionId: id,
  title: `Chat ${id}`,
  project: 'acme',
  repoId: 'repo',
  role: 'worker',
  leadId: null,
  taskRef: null,
  lastReport: null,
  waitsOnAuthor: [],
  lastActivityAt: NOW - 1_000,
  ...extra
})
const draft = (extra: Partial<HqIntakeDraft> = {}): HqIntakeDraft => ({
  channel: 'D1',
  ts: '200.000001',
  threadTs: '100.000001',
  author: 'Ann',
  authorSlackId: 'U1',
  venue: 'dm',
  text: 'Done, see the export',
  links: [],
  files: [],
  permalink: null,
  at: NOW,
  ...extra
})
function deps(extra: Partial<HqRouterDeps> = {}): HqRouterDeps {
  return {
    chats: () => [chat('a'), chat('b'), chat('lead', { role: 'lead' })],
    crumb: () => null,
    boundChat: () => null,
    history: () => [],
    waitsOn: () => new Map(),
    jev: null,
    fallback: async () => ({ ok: false, error: 'off' }),
    now: () => NOW,
    ...extra
  }
}

describe('routeHqIntake', () => {
  it('a reply under our message goes to its task, on the card (no sending by itself)', async () => {
    const route = await routeHqIntake(
      draft(),
      deps({ binding: () => ({ chat: 'b', source: 'approve' }), leadOf: () => 'lead' })
    )
    expect(route).toMatchObject({ target: 'b', how: 'crumb', auto: false })
    expect(route.alternatives[0].sessionId).toBe('lead')
  })
  it("the owner's earlier choice for the thread is sent by itself", async () => {
    const route = await routeHqIntake(
      draft(),
      deps({ binding: () => ({ chat: 'a', source: 'choice' }) })
    )
    expect(route).toMatchObject({ target: 'a', how: 'thread', auto: true })
  })
  it('a thread a chat only posted in (no owner choice) is a hint, never sent by itself', async () => {
    const route = await routeHqIntake(draft(), deps({ boundChat: () => 'a' }))
    expect(route).toMatchObject({ target: 'a', how: 'thread', auto: false })
  })
  it('one open question to the author puts its chat first, without sending', async () => {
    const route = await routeHqIntake(
      draft({ threadTs: null }),
      deps({ waitsOn: () => new Map([['b', ['Is the export ready?']]]) })
    )
    expect(route).toMatchObject({ target: 'b', how: 'question', auto: false })
    expect(route.why).toContain('Is the export ready?')
  })
  it('asks the fallback model when Jev does not answer in time', async () => {
    const fallback = vi.fn(async () => ({
      ok: true as const,
      text: '{"target": 2, "alternatives": [1]}'
    }))
    const route = await routeHqIntake(
      draft({ threadTs: null }),
      deps({
        jev: (_body, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          ),
        fallback,
        timeoutMs: 20
      })
    )
    expect(fallback).toHaveBeenCalledOnce()
    expect(route.auto).toBe(false)
    expect(route.model).toBe('Haiku')
  })
})

describe('router helpers', () => {
  it('reads a linked Slack message', () => {
    expect(hqRouterLinkedMessage(['https://x.slack.com/archives/C1/p1700000000123456'])).toEqual({
      channel: 'C1',
      ts: '1700000000.123456'
    })
  })
  it('takes the key from the environment, else from the named env file', () => {
    expect(hqRouterKey({ OPENROUTER_API_KEY: ' k1 ' }, null, () => null)).toBe('k1')
    expect(hqRouterKey({}, '/f', () => 'A=1\nexport OPENROUTER_API_KEY="k2"\n')).toBe('k2')
    expect(hqRouterKey({}, null, () => null)).toBeNull()
  })
})
