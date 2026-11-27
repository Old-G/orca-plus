import { afterEach, describe, expect, it } from 'vitest'
import type { HqRoute, HqRouterChat } from '../../shared/hq-router'
import { hqRouteNewMark } from '../../shared/hq-router'
import { PulseCore } from '../orca-plus/pulse/pulse-core'
import { logRoute } from '../orca-plus/pulse/pulse-router-graph'
import { logChoice, logOutcome, routerAutoRecords } from '../orca-plus/pulse/pulse-router-outcomes'
import { routeHqIntake, type HqRouterDeps } from './hq-router'
import { withAutoGate } from './hq-router-auto-gate'
import type { HqIntakeDraft } from './hq-slack-intake-suggest'

const DAY = 24 * 60 * 60_000
const NOW = 100 * DAY
const open: PulseCore[] = []
afterEach(() => {
  for (const c of open.splice(0)) {
    c.close()
  }
})
function core(): PulseCore {
  const c = new PulseCore(':memory:', { now: () => NOW, newId: () => 'x' })
  open.push(c)
  return c
}
const router = (c: PulseCore) => ({ autoRecords: (since: number) => routerAutoRecords(c, since) })

let seq = 0
/** `count` cards of a class the owner sent to the offered chat (or, past `right`, to another one). */
function decided(c: PulseCore, autoClass: string, count: number, right = count, at = NOW - DAY) {
  for (let i = 0; i < count; i++) {
    const key = `${autoClass}:${(seq += 1)}`
    logRoute(c, { key, at, how: 'x', target: 'a', top: ['a'], auto: false, autoClass })
    logChoice(c, key, i < right ? 'a' : 'b', at + 1)
  }
}

const route = (extra: Partial<HqRoute> = {}): HqRoute => ({
  target: 'a',
  targetTitle: 'A',
  repoId: null,
  project: null,
  level: 'worker',
  how: 'question',
  why: 'x',
  auto: false,
  autoClass: 'question',
  alternatives: [],
  confidence: null,
  model: null,
  ...extra
})

describe('router v2 T4: the auto gate', () => {
  it('a class below n 30 waits on «Send»; at 30 of 30 right it goes by itself', () => {
    const c = core()
    decided(c, 'question', 29)
    expect(withAutoGate(route(), {}, router(c), NOW).auto).toBe(false)
    decided(c, 'question', 1)
    expect(withAutoGate(route(), {}, router(c), NOW).auto).toBe(true)
    // Another class has no record of its own.
    expect(withAutoGate(route({ autoClass: 'topic' }), {}, router(c), NOW).auto).toBe(false)
  })

  it('below 98% right stays on «Send»; the settings move the bar', () => {
    const c = core()
    decided(c, 'single-ref', 30, 29)
    expect(withAutoGate(route({ autoClass: 'single-ref' }), {}, router(c), NOW).auto).toBe(false)
    const lower = { hqRouterAuto: { minRight: 0.95 } }
    expect(withAutoGate(route({ autoClass: 'single-ref' }), lower, router(c), NOW).auto).toBe(true)
    const higherN = { hqRouterAuto: { minN: 40, minRight: 0.95 } }
    expect(withAutoGate(route({ autoClass: 'single-ref' }), higherN, router(c), NOW).auto).toBe(
      false
    )
  })

  it('counts only the window, and not skipped, gone or open cards', () => {
    const c = core()
    decided(c, 'topic', 30, 30, NOW - 31 * DAY)
    expect(withAutoGate(route({ autoClass: 'topic' }), {}, router(c), NOW).auto).toBe(false)
    for (let i = 0; i < 40; i++) {
      logRoute(c, {
        key: `s${i}`,
        at: NOW - DAY,
        how: 'topic',
        target: 'a',
        top: ['a'],
        auto: false,
        autoClass: 'topic'
      })
      if (i % 2 === 0) {
        logOutcome(c, `s${i}`, { outcome: i % 4 === 0 ? 'skipped' : 'gone', at: NOW })
      }
    }
    expect(routerAutoRecords(c, NOW - 30 * DAY).get('topic')).toBeUndefined()
    // A week's window from the settings drops the old ones too.
    decided(c, 'topic', 30, 30, NOW - 10 * DAY)
    expect(withAutoGate(route({ autoClass: 'topic' }), {}, router(c), NOW).auto).toBe(true)
    expect(
      withAutoGate(route({ autoClass: 'topic' }), { hqRouterAuto: { days: 7 } }, router(c), NOW)
        .auto
    ).toBe(false)
  })

  it('a card the class sent by itself counts as right; one sent elsewhere counts as wrong', () => {
    const c = core()
    for (let i = 0; i < 30; i++) {
      logRoute(c, {
        key: `a${i}`,
        at: NOW - DAY,
        how: 'thread',
        target: 'a',
        top: ['a'],
        auto: true,
        autoClass: 'thread-choice'
      })
      logOutcome(c, `a${i}`, { outcome: 'auto', at: NOW, chosen: 'a' })
    }
    expect(routerAutoRecords(c, 0).get('thread-choice')).toEqual({ n: 30, right: 30 })
    decided(c, 'thread-choice', 1, 0)
    expect(routerAutoRecords(c, 0).get('thread-choice')).toEqual({ n: 31, right: 30 })
    expect(withAutoGate(route({ autoClass: 'thread-choice' }), {}, router(c), NOW).auto).toBe(false)
  })

  it('a model pick and a route to «new» never go by itself; 🆕 keeps its own send', () => {
    const c = core()
    decided(c, 'question', 30)
    expect(
      withAutoGate(route({ how: 'model', autoClass: null, auto: true }), {}, router(c), NOW).auto
    ).toBe(false)
    expect(withAutoGate(route({ target: 'new' }), {}, router(c), NOW).auto).toBe(false)
    expect(withAutoGate(hqRouteNewMark(), {}, router(c), NOW).auto).toBe(true)
  })

  it('👾 on an answer to our open question goes to the waiting chat — by itself once the class is proved', async () => {
    const c = core()
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
    const draft: HqIntakeDraft = {
      channel: 'C1',
      ts: '200.000001',
      threadTs: null,
      author: 'Ann',
      authorSlackId: 'U1',
      venue: 'channel',
      text: 'Yes, the export is ready',
      links: [],
      files: [],
      permalink: null,
      at: NOW
    }
    const deps: HqRouterDeps = {
      chats: () => [chat('a'), chat('waiting'), chat('b')],
      crumb: () => null,
      boundChat: () => null,
      history: () => [],
      waitsOn: () => new Map([['waiting', ['Is the export ready?']]]),
      jev: null,
      fallback: async () => ({ ok: false, error: 'off' }),
      now: () => NOW
    }
    const routed = await routeHqIntake(draft, deps)
    expect(routed).toMatchObject({ target: 'waiting', how: 'question', autoClass: 'question' })
    expect(withAutoGate(routed, {}, router(c), NOW).auto).toBe(false)
    decided(c, 'question', 30)
    expect(withAutoGate(routed, {}, router(c), NOW)).toMatchObject({
      target: 'waiting',
      auto: true
    })
  })
})
