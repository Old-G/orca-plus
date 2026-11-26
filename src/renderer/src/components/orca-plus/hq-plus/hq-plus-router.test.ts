import { describe, expect, it } from 'vitest'
import type { HqRoute } from '../../../../../shared/hq-router'
import type { HqIntake } from '../../../../../shared/hq-slack-intake'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import {
  hqPlusRouterCardOf,
  hqPlusRouterCards,
  hqPlusRouterChatWorktree,
  hqPlusRouterSendsTo,
  hqPlusWorktreeOfSession
} from './hq-plus-router'

const route = (target: string): HqRoute => ({
  target,
  targetTitle: target === 'new' ? null : `Chat ${target}`,
  repoId: 'repo',
  project: 'acme',
  level: 'worker',
  how: 'model',
  why: 'Ann wrote to this chat before',
  auto: false,
  alternatives: [],
  confidence: 0.7,
  model: 'Jev'
})

const intake = (extra: Partial<HqIntake> = {}): HqIntake => ({
  channel: 'D1',
  ts: '100.000001',
  threadTs: null,
  author: 'Ann',
  authorSlackId: 'U1',
  venue: 'dm',
  text: 'the export is green',
  links: [],
  files: [],
  permalink: null,
  at: 1,
  repoId: null,
  project: null,
  summary: '',
  ...extra
})

const item = (id: string, body: HqIntake, extra: Partial<PulseInboxItem> = {}): PulseInboxItem => ({
  id,
  kind: 'hq-intake',
  title: 'To work: Ann',
  body: null,
  urgency: 'urgent',
  refKind: 'slack-message',
  refId: JSON.stringify(body),
  actions: [],
  dedupeKey: `hq-intake:${body.channel}:${body.ts}`,
  createdAt: 1,
  readAt: null,
  doneAt: null,
  doneAction: null,
  ...extra
})

describe('hqPlusRouterCards', () => {
  it('lists the routed cards and the pasted ones, newest first', () => {
    const cards = hqPlusRouterCards([
      item('marked', intake({ route: route('S1') }), { createdAt: 1 }),
      item('pasted', intake({ channel: 'text', pasted: true }), {
        createdAt: 3,
        dedupeKey: 'router:text:300.000001'
      }),
      item('link', intake({ pasted: true, route: route('S2') }), {
        createdAt: 2,
        dedupeKey: 'router:D1:200.000001'
      })
    ])
    expect(cards.map((card) => card.item.id)).toEqual(['pasted', 'link', 'marked'])
  })

  it('leaves out a mention the router never saw, a done card and other kinds', () => {
    expect(
      hqPlusRouterCards([
        item('mention', intake({ via: 'mention' })),
        // Why (T7 routes every To work card): a routed mention or ledger card keeps its own look.
        item('routed-mention', intake({ via: 'mention', route: route('S1') })),
        item('ledger', intake({ conversationId: 'c1', route: route('S1') })),
        item('done', intake({ route: route('S1') }), { doneAt: 5 }),
        item('other', intake({ route: route('S1') }), { kind: 'decision' })
      ])
    ).toEqual([])
  })
})

describe('hqPlusRouterSendsTo', () => {
  it('is the chat the router picked; a new chat waits for the owner', () => {
    expect(hqPlusRouterSendsTo(intake({ route: route('S1') }))).toBe('S1')
    expect(hqPlusRouterSendsTo(intake({ route: route('new') }))).toBeNull()
    expect(hqPlusRouterSendsTo(intake())).toBeNull()
  })
})

describe('hqPlusWorktreeOfSession', () => {
  it('finds the workspace whose tab holds the chat', () => {
    const tabs = {
      w1: [{ contentType: 'terminal', entityId: 'S1' }],
      w2: [{ contentType: 'agent-session', entityId: 'S1' }]
    }
    expect(hqPlusWorktreeOfSession(tabs, 'S1')).toBe('w2')
    expect(hqPlusWorktreeOfSession(tabs, 'S9')).toBeNull()
  })
})

describe('hqPlusRouterCardOf', () => {
  it('is the Router card for an open 👾 mark, null for a mention or nothing', () => {
    expect(hqPlusRouterCardOf(item('m', intake({ route: route('S1') })))?.item.id).toBe('m')
    expect(hqPlusRouterCardOf(item('x', intake({ via: 'mention', route: route('S1') })))).toBeNull()
    expect(hqPlusRouterCardOf(null)).toBeNull()
  })
})

describe('hqPlusRouterChatWorktree', () => {
  it('reopens a chat with no tab where the router read it (owner 26.11: a done chat takes «Send»)', () => {
    const tabs = { w2: [{ contentType: 'agent-session', entityId: 'S1' }] }
    expect(hqPlusRouterChatWorktree(tabs, 'S1', 'w9')).toBe('w2')
    expect(hqPlusRouterChatWorktree(tabs, 'S5', 'w9')).toBe('w9')
    expect(hqPlusRouterChatWorktree(tabs, 'S5', null)).toBe('')
  })
})
