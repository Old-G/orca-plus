// Router v2 T2: a DM answer with no breadcrumb goes to the author's topic — one topic there, several the
// model's pick among them only (+ «new», which hands it on to the usual choice over all open chats).
import { describe, expect, it, vi } from 'vitest'
import type { HqRouterChat, HqRouterTopic } from '../../shared/hq-router'
import { routeHqIntake, type HqRouterDeps } from './hq-router'
import type { HqIntakeDraft } from './hq-slack-intake-suggest'

const NOW = 1_800_000_000_000
const chat = (id: string): HqRouterChat => ({
  sessionId: id,
  title: `Chat ${id}`,
  project: 'acme',
  repoId: 'repo',
  role: 'worker',
  leadId: null,
  taskRef: null,
  lastReport: null,
  waitsOnAuthor: [],
  lastActivityAt: NOW - 1_000
})
const topic = (id: string, text: string): HqRouterTopic => ({
  chat: id,
  work: id,
  text,
  at: NOW - 60_000,
  source: 'message'
})
const draft = (extra: Partial<HqIntakeDraft> = {}): HqIntakeDraft => ({
  channel: 'D1',
  ts: '200.000001',
  threadTs: null,
  author: 'Ann',
  authorSlackId: 'U1',
  venue: 'dm',
  text: 'Yes, $69 for all of them',
  links: [],
  files: [],
  permalink: null,
  at: NOW,
  ...extra
})
const jevSays = (choice: string) =>
  vi.fn(async (_body: unknown) => ({
    answers: { target: { choice, probabilities: { [choice]: 0.8 } } }
  }))
function deps(extra: Partial<HqRouterDeps> = {}): HqRouterDeps {
  return {
    chats: () => ['a', 'b', 'c', 'd'].map(chat),
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

describe('routeHqIntake — person × topic', () => {
  it('one open topic: there, how=topic, no model asked, not sent by itself', async () => {
    const jev = jevSays('1')
    const topics = vi.fn(() => [topic('b', 'Is the price $69 for every plan?')])
    const route = await routeHqIntake(draft(), deps({ topics, jev }))
    expect(route).toMatchObject({ target: 'b', how: 'topic', auto: false })
    expect(route.why).toContain('Is the price $69')
    expect(topics).toHaveBeenCalledWith({
      slackUserId: 'U1',
      channel: 'D1',
      now: NOW,
      conversationKey: 'slack:D1:200.000001'
    })
    expect(jev).not.toHaveBeenCalled()
  })

  it('several topics: Jev chooses among them only (+ new); its pick is how=topics', async () => {
    const jev = jevSays('2')
    const route = await routeHqIntake(
      draft(),
      deps({ topics: () => [topic('c', 'Which SKU?'), topic('a', 'Price $69?')], jev })
    )
    expect(route).toMatchObject({ target: 'a', how: 'topics', model: 'Jev', confidence: 0.8 })
    const body = jev.mock.calls[0][0] as { questions: { target: { criteria: object } } }
    expect(Object.keys(body.questions.target.criteria)).toEqual(['1', '2', 'new'])
    expect(JSON.stringify(body)).toContain('said: Price $69?')
  })

  it('«new» among the topics: the usual choice over all open chats, never «new»', async () => {
    const calls: unknown[] = []
    const jev = vi.fn(async (body: unknown) => {
      calls.push(body)
      return calls.length === 1
        ? { answers: { target: { choice: 'new' } } }
        : { answers: { target: { choice: '4' } } }
    })
    const route = await routeHqIntake(
      draft(),
      deps({ topics: () => [topic('c', 'Which SKU?'), topic('a', 'Price?')], jev })
    )
    expect(jev).toHaveBeenCalledTimes(2)
    expect(route.how).toBe('model')
    expect(route.target).not.toBe('new')
  })

  it('a topic whose chat is not open is skipped; the one left is the topic', async () => {
    const route = await routeHqIntake(
      draft(),
      deps({ topics: () => [topic('gone', 'Old'), topic('d', 'Ready?')] })
    )
    expect(route).toMatchObject({ target: 'd', how: 'topic' })
  })

  it('a channel message does not read the topics; a breadcrumb or a waiting wins over them', async () => {
    const topics = vi.fn(() => [topic('b', 'Price?')])
    await routeHqIntake(draft({ venue: 'channel', channel: 'C1' }), deps({ topics }))
    expect(topics).not.toHaveBeenCalled()
    const crumbed = await routeHqIntake(
      draft(),
      deps({ topics, crumb: () => ({ chat: 'c', lead: null, chatTitle: null }) })
    )
    expect(crumbed).toMatchObject({ target: 'c', how: 'crumb' })
    const asked = await routeHqIntake(
      draft(),
      deps({ topics, waitsOn: () => new Map([['a', ['Which SKU?']]]) })
    )
    expect(asked).toMatchObject({ target: 'a', how: 'question' })
  })
})
