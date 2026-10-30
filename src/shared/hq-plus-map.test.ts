import { describe, expect, it } from 'vitest'
import { hqPlusMapFeedPlace, hqPlusMapModel } from './hq-plus-map'
import type { HqPlusCard, HqPlusLogItem } from './hq-plus-log'
import type { PulseInboxItem } from './pulse-types'

function inbox(kind: string, refId: string | null = null): PulseInboxItem {
  return {
    id: `i-${kind}`,
    kind,
    title: 'Ann: look at the diff',
    body: null,
    urgency: 'normal',
    refKind: null,
    refId,
    actions: [],
    dedupeKey: null,
    createdAt: 1,
    readAt: null,
    doneAt: null,
    doneAction: null
  }
}

function card(over: Partial<HqPlusCard> & { id: string }): HqPlusCard {
  return {
    kind: 'card',
    at: 1,
    room: 'work',
    project: 'acme',
    address: null,
    sessionId: null,
    type: 'bell',
    title: 'Something',
    body: null,
    report: null,
    open: true,
    done: null,
    entry: null,
    inbox: null,
    ...over
  }
}

function conversation(id: string, key: string, project: string | null, open = true): HqPlusCard {
  const part = card({
    id: `${id}-part`,
    project,
    inbox: inbox('slack-request', JSON.stringify({ id: 'D1:1.2', kind: 'answer' }))
  })
  return card({
    id,
    project,
    type: 'conversation',
    open,
    done: open ? null : { by: 'status', status: 'closed' },
    conversation: {
      key,
      title: 'Thread',
      guessed: false,
      messages: [],
      parts: open ? [part] : [],
      link: null
    }
  })
}

const line: HqPlusLogItem = {
  kind: 'line',
  id: 'l1',
  at: 1,
  room: 'work',
  project: 'acme',
  address: null,
  sessionId: 's1',
  tone: 'agent',
  title: 'Chat finished'
}

describe('hqPlusMapFeedPlace', () => {
  it('keeps chat turns and decided Approves out, the rest by where it stands', () => {
    const ask = conversation('c1', 'slack:C1:1', 'acme')
    const closed = conversation('c2', 'slack:C1:2', 'acme', false)
    const approve = card({
      id: 'a1',
      type: 'approve',
      open: false,
      done: { by: 'action', action: 'send', at: 2 }
    })
    const fyi = card({
      id: 'f1',
      inbox: inbox('slack-request', JSON.stringify({ id: 'D1:1.3', kind: 'fyi' }))
    })
    expect(hqPlusMapFeedPlace(line)).toBeNull()
    expect(hqPlusMapFeedPlace(approve)).toBeNull()
    expect(hqPlusMapFeedPlace(ask)).toBe('you')
    expect(hqPlusMapFeedPlace(closed)).toBe('done')
    expect(hqPlusMapFeedPlace(fyi)).toBe('fyi')
  })
})

describe('hqPlusMapModel', () => {
  it('draws sources into projects and unfolds talks, people and chats', () => {
    const model = hqPlusMapModel({
      projects: ['acme', 'quiet-one', 'shop'],
      items: [
        conversation('c1', 'slack:C1:1', 'acme'),
        conversation('c2', 'clickup:t1', 'acme', false),
        conversation('c3', 'slack:C9:1', null),
        card({ id: 'r1', project: 'shop', type: 'reply' }),
        card({ id: 'q1', project: 'shop', type: 'move', sessionId: 's-shop' })
      ],
      waits: [
        { id: 'w1', personName: 'Ann', project: 'shop', title: 'Pricing', at: 10, answerId: 'r1' },
        { id: 'w2', personName: 'Ann', project: 'shop', title: 'Logo', at: 5, answerId: null },
        { id: 'w3', personName: 'Bob', project: 'shop', title: 'Access', at: 1, answerId: null }
      ],
      chats: [
        { key: 'k1', project: 'shop', state: 'done', sessionId: 's-old' },
        { key: 'k2', project: 'shop', state: 'asks', sessionId: 's-shop' }
      ]
    })
    expect(model.sources).toEqual([
      { source: 'slack', count: 2 },
      { source: 'clickup', count: 1 }
    ])
    expect(model.projects.map((project) => project.slug)).toEqual(['shop', 'acme', 'Unsorted'])
    const shop = model.projects[0]
    // Why: the answer is on Ann's leaf and the chat's question on its chat leaf, not twice.
    expect(shop.leaves.map((leaf) => leaf.key)).toEqual([
      'person:Ann',
      'person:Bob',
      'chat:k2',
      'chat:k1'
    ])
    expect(shop).toMatchObject({ you: 2, waits: 3, chats: 2, oldestWaitAt: 1 })
    const acme = model.projects[1]
    expect(acme.sources).toEqual({ slack: 1, clickup: 1 })
    expect(acme.leaves).toEqual([
      { kind: 'talk', key: 'talk:c1', itemId: 'c1', title: 'Something', source: 'slack' }
    ])
    expect(model.projects[2]).toMatchObject({ unsorted: true, you: 1 })
  })

  it('puts HQ own rows and waits with no project under HQ, not Unsorted', () => {
    const model = hqPlusMapModel({
      projects: [],
      items: [card({ id: 'a1', project: null, type: 'approve' })],
      waits: [{ id: 'w1', personName: null, project: null, title: 'Ping', at: 1, answerId: null }],
      chats: []
    })
    expect(model.projects.map((project) => [project.slug, project.unsorted])).toEqual([
      ['HQ', false]
    ])
    expect(model.projects[0].leaves.map((leaf) => leaf.key)).toEqual(['talk:a1', 'person:Someone'])
  })

  it('unfolds a project into its six most pressing chats, counting them all', () => {
    const states = ['quiet', 'done', 'done', 'quiet', 'working', 'quiet', 'asks', 'done'] as const
    const model = hqPlusMapModel({
      projects: ['acme'],
      items: [],
      waits: [],
      chats: states.map((state, index) => ({
        key: `k${index}`,
        project: 'acme',
        state,
        sessionId: null
      }))
    })
    const [acme] = model.projects
    expect(acme.chats).toBe(8)
    expect(acme.leaves.map((leaf) => leaf.key)).toEqual([
      'chat:k6',
      'chat:k4',
      'chat:k1',
      'chat:k2',
      'chat:k7',
      'chat:k0'
    ])
  })
})
