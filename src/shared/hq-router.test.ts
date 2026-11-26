import { describe, expect, it } from 'vitest'
import {
  HQ_ROUTER_NEW,
  hqRouteBySignals,
  hqRouterRefs,
  hqRouterShortlist,
  type HqRouterChat,
  type HqRouterInput
} from './hq-router'
import {
  hqRouteByModel,
  hqRouterFallbackAnswer,
  hqRouterJevAnswer,
  hqRouterJevBody,
  readHqRoute
} from './hq-router-model'

const NOW = 10_000_000_000

function chat(id: string, extra: Partial<HqRouterChat> = {}): HqRouterChat {
  return {
    sessionId: id,
    title: `chat ${id}`,
    project: 'acme',
    repoId: 'repo-acme',
    role: null,
    leadId: null,
    taskRef: null,
    lastReport: null,
    waitsOnAuthor: [],
    lastActivityAt: NOW - 1_000,
    ...extra
  }
}

function input(extra: Partial<HqRouterInput> = {}): HqRouterInput {
  return {
    text: 'Ann: hello',
    author: 'Ann',
    venue: 'Slack DM',
    crumb: null,
    boundChat: null,
    history: [],
    chats: [],
    now: NOW,
    ...extra
  }
}

describe('router refs', () => {
  it('finds tasks, MRs and branches, not links', () => {
    expect(
      hqRouterRefs(
        'DEV-1234 and dev-77; see !42, https://gitlab.com/acme/x/-/merge_requests/9 and branch `feat/new-export`; https://acme.example/a/b-c'
      )
    ).toEqual({ tasks: ['DEV-1234', 'DEV-77'], mrs: ['42', '9'], branches: ['feat/new-export'] })
  })
})

describe('router signals', () => {
  it('a crumb wins, then a bound thread (the only one sent by itself), then a named task', () => {
    const chats = [
      chat('a', { title: 'Export' }),
      chat('b', { taskRef: 'DEV-1234' }),
      chat('lead', { role: 'lead', title: 'LEAD · Export' })
    ]
    const crumbRoute = hqRouteBySignals(
      input({ chats, crumb: { chat: 'a', lead: 'lead', chatTitle: 'Export' }, boundChat: 'b' })
    )
    expect(crumbRoute).toMatchObject({ target: 'a', how: 'crumb', auto: false, level: 'worker' })
    expect(crumbRoute?.why).toContain('Breadcrumb: «Export»')
    expect(crumbRoute?.alternatives[0]?.sessionId).toBe('lead')

    expect(hqRouteBySignals(input({ chats, boundChat: 'b', boundByChoice: true }))).toMatchObject({
      target: 'b',
      how: 'thread',
      auto: true
    })
    const byRef = hqRouteBySignals(input({ chats, text: 'about DEV-1234' }))
    expect(byRef).toMatchObject({ target: 'b', how: 'ref', auto: false })
    expect(byRef?.why).toBe("DEV-1234 is «chat b»'s work")
    expect(hqRouteBySignals(input({ chats, text: 'nothing here' }))).toBeNull()
  })

  it('a crumb whose chat closed goes to its Lead and says so', () => {
    const chats = [chat('lead', { role: 'lead', title: 'LEAD · Export' })]
    const route = hqRouteBySignals(
      input({ chats, crumb: { chat: 'gone', lead: 'lead', chatTitle: 'W · export' } })
    )
    expect(route).toMatchObject({ target: 'lead', level: 'lead', how: 'crumb' })
    expect(route?.why).toBe('Breadcrumb: «W · export» is closed; its Lead «LEAD · Export»')
  })

  it('a crumb to nothing open falls through', () => {
    expect(
      hqRouteBySignals(
        input({ chats: [chat('x')], crumb: { chat: 'gone', lead: null, chatTitle: null } })
      )
    ).toBeNull()
  })
})

describe('router shortlist', () => {
  it('orders open questions, history, fresh Leads, then recent, eight at most', () => {
    const chats = [
      ...Array.from({ length: 10 }, (_, i) => chat(`r${i}`, { lastActivityAt: NOW - i })),
      chat('old-lead', { role: 'lead', lastActivityAt: NOW - 10 * 86_400_000 }),
      chat('lead', { role: 'lead', lastActivityAt: NOW - 86_400_000 }),
      chat('waits', { waitsOnAuthor: ['Ann: export?'], lastActivityAt: NOW - 5_000 }),
      chat('before', { lastActivityAt: NOW - 9_000 })
    ]
    const short = hqRouterShortlist(input({ chats, history: ['before', 'closed'] }))
    expect(short.map((c) => c.sessionId)).toEqual([
      'waits',
      'before',
      'lead',
      'r0',
      'r1',
      'r2',
      'r3',
      'r4'
    ])
  })
})

describe('router model step', () => {
  const short = [chat('a'), chat('b'), chat('c')]

  it('asks Jev one choice over the numbers and new', () => {
    const body = hqRouterJevBody(input(), short)
    const target = (body.questions as Record<string, { type: string; criteria: object }>).target
    expect(body.model).toBe('typesafe/jev-1.14')
    expect(target.type).toBe('choice')
    expect(Object.keys(target.criteria)).toEqual(['1', '2', '3', 'new'])
  })

  it('reads Jev’s pick, ranking and share', () => {
    const answer = hqRouterJevAnswer(
      { answers: { target: { choice: '2', probabilities: { '2': 0.7, new: 0.2, '1': 0.1 } } } },
      short
    )
    expect(answer).toEqual({ pick: 'b', ranked: [HQ_ROUTER_NEW, 'a'], confidence: 0.7 })
    expect(hqRouterJevAnswer({ answers: { target: { choice: '9' } } }, short)).toBeNull()
    expect(hqRouterJevAnswer('nope', short)).toBeNull()
  })

  it('a pick names the chat and the share; new offers the two best open', () => {
    const picked = hqRouteByModel(
      input({ history: ['b'] }),
      short,
      { pick: 'b', ranked: ['c'], confidence: 0.7 },
      'Jev'
    )
    expect(picked).toMatchObject({ target: 'b', how: 'model', auto: false })
    expect(picked.why).toBe("Jev picked «chat b» (70%); Ann's messages went there before")
    expect(picked.alternatives.map((a) => a.sessionId)).toEqual(['c', 'a'])

    const fresh = hqRouteByModel(
      input(),
      short,
      { pick: 'new', ranked: ['c'], confidence: 0.6 },
      'Jev'
    )
    expect(fresh).toMatchObject({ target: 'new', level: 'new', auto: false })
    expect(fresh.alternatives.map((a) => a.sessionId)).toEqual(['c', 'a'])

    expect(hqRouteByModel(input(), short, null, 'Jev')).toMatchObject({
      target: 'new',
      how: 'fallback',
      why: 'No model answered — pick a chat'
    })
  })

  it('reads the fallback model’s JSON', () => {
    expect(hqRouterFallbackAnswer('{"target": 3, "alternatives": [1, 9]}', short)).toEqual({
      pick: 'c',
      ranked: ['a'],
      confidence: null
    })
    expect(hqRouterFallbackAnswer('{"target": "new"}', short)?.pick).toBe('new')
    expect(hqRouterFallbackAnswer('no json', short)).toBeNull()
  })

  it('keeps a route through storage', () => {
    const route = hqRouteByModel(input(), short, { pick: 'a', ranked: [], confidence: 0.5 }, 'Jev')
    expect(readHqRoute(JSON.parse(JSON.stringify(route)))).toEqual(route)
    expect(readHqRoute({ target: 'a' })).toBeNull()
  })
})
