import { describe, expect, it, vi } from 'vitest'
import type { HqRouterChat } from '../../shared/hq-router'
import {
  hqRouterKey,
  hqRouterLinkedMessage,
  hqRouterMarkLine,
  hqRouterTextDraft,
  hqRouterTextTs,
  routeHqIntake,
  type HqRouterDeps
} from './hq-router'
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
  it("the owner's earlier choice for the thread is the thread-choice class", async () => {
    const route = await routeHqIntake(
      draft(),
      deps({ binding: () => ({ chat: 'a', source: 'choice' }) })
    )
    expect(route).toMatchObject({
      target: 'a',
      how: 'thread',
      auto: false,
      autoClass: 'thread-choice'
    })
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

describe('two marks (28.11)', () => {
  it('🆕 is a new chat sent by itself: no chat, thread, crumb or model is read', async () => {
    const chats = vi.fn(() => [chat('a')])
    const jev = vi.fn(async () => ({}))
    const route = await routeHqIntake(
      draft({ newMark: true }),
      deps({
        chats,
        jev,
        boundChat: () => 'a',
        binding: () => ({ chat: 'a', source: 'choice' }),
        waitsOn: () => new Map([['a', ['Is the export ready?']]])
      })
    )
    expect(route).toMatchObject({
      target: 'new',
      how: 'new-mark',
      level: 'new',
      auto: true,
      alternatives: []
    })
    expect(chats).not.toHaveBeenCalled()
    expect(jev).not.toHaveBeenCalled()
  })
  it('👾 never offers «new» to the model, and a «new» answer is a card to pick a chat', async () => {
    const bodies: Record<string, unknown>[] = []
    const route = await routeHqIntake(
      draft({ threadTs: null }),
      deps({
        jev: async (body) => {
          bodies.push(body)
          return { answers: { target: { choice: 'new', probabilities: { new: 0.9, '1': 0.1 } } } }
        }
      })
    )
    const criteria = (bodies[0].questions as Record<string, { criteria: Record<string, string> }>)
      .target.criteria
    expect(Object.keys(criteria)).not.toContain('new')
    expect(route).toMatchObject({ how: 'model', auto: false })
    expect(route.target).toBe('new')
    expect(route.why).toContain('pick a chat')
  })
  it('👾 prompts for the fallback model do not mention «new» either', async () => {
    const fallback = vi.fn(async (_prompt: string) => ({
      ok: true as const,
      text: '{"target": 1}'
    }))
    const route = await routeHqIntake(draft({ threadTs: null }), deps({ fallback }))
    expect(fallback.mock.calls[0][0]).not.toMatch(/"new"|or "new"/)
    expect(route.how).toBe('model')
    expect(route.target).not.toBe('new')
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

describe('hqRouterMarkLine (T1c)', () => {
  it('writes one line per mark and outcome, not one per poll', () => {
    const lines: string[] = []
    const seen = new Set<string>()
    const at = Date.UTC(2026, 10, 26, 18)
    hqRouterMarkLine('hq-intake:D1:1.1', 'card up', (line) => lines.push(line), at, seen)
    hqRouterMarkLine('hq-intake:D1:1.1', 'card up', (line) => lines.push(line), at, seen)
    hqRouterMarkLine('hq-intake:D1:1.1', 'routed crumb → s1', (line) => lines.push(line), at, seen)
    expect(lines).toEqual([
      '2026-11-26T18:00:00.000Z 👾 hq-intake:D1:1.1 card up\n',
      '2026-11-26T18:00:00.000Z 👾 hq-intake:D1:1.1 routed crumb → s1\n'
    ])
  })
})

describe('pasted text (T4)', () => {
  it('gets a Slack-shaped ts that two pastes in one millisecond do not share', () => {
    expect(hqRouterTextTs(1_764_100_000_123, 1)).toBe('1764100000.123001')
    expect(hqRouterTextTs(1_764_100_000_123, 2)).not.toBe(hqRouterTextTs(1_764_100_000_123, 1))
  })

  it('is a draft with no Slack message, its author from «Name wrote:» and its links', () => {
    const pasted = hqRouterTextDraft(
      'Bob wrote: access granted, see https://acme.example/x',
      NOW,
      1
    )
    expect(pasted).toMatchObject({
      channel: 'text',
      author: 'Bob',
      authorSlackId: null,
      threadTs: null,
      permalink: null,
      links: ['https://acme.example/x'],
      at: NOW
    })
    expect(hqRouterTextDraft('access granted', NOW, 2).author).toBe('Pasted text')
  })

  it('is routed by the model over the open chats, one call, never sent by itself', async () => {
    const jev = vi.fn(async () => ({ choice: '1', probabilities: { '1': 0.7, new: 0.1 } }))
    const done = await routeHqIntake(
      hqRouterTextDraft('Bob wrote: the export is green', NOW, 3),
      deps({ chats: () => [chat('S1'), chat('S2')], jev })
    )
    expect(jev).toHaveBeenCalledTimes(1)
    expect(done.auto).toBe(false)
  })
})
