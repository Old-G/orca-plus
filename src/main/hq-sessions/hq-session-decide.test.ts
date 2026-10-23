import { describe, expect, it } from 'vitest'
import type { HqLiveSession } from '../../shared/hq-sessions'
import { decideHqDispatch, decideHqHandoff } from './hq-session-decide'

const NOW = new Date(2026, 9, 24, 15, 0).getTime()
const MIN = 60_000
const HOUR = 60 * MIN

function chat(over: Partial<HqLiveSession> = {}): HqLiveSession {
  return {
    sessionId: 'claude_a',
    address: 'acme-api/refunds',
    project: 'acme-api',
    workspace: 'acme',
    worktreeId: 'r-api::/w/api',
    name: 'refunds',
    state: 'done',
    midTurn: false,
    lastActivityAt: NOW - 2 * HOUR,
    contextPct: 30,
    ownerAt: NOW - 3 * HOUR,
    tabOpen: true,
    ...over
  }
}

const decide = (sessions: HqLiveSession[], unreviewed = 0) =>
  decideHqDispatch({
    project: 'acme-api',
    address: 'acme-api/refunds',
    sessions,
    unreviewed,
    now: NOW
  })

describe('HQ+ session dispatcher: continue, new or queue', () => {
  it('continues the thread’s chat while it has room and was active within 12 h', () => {
    expect(decide([chat()])).toMatchObject({ kind: 'continue', sessionId: 'claude_a' })
    // A chat closed to History is brought back the same way.
    expect(decide([chat({ tabOpen: false, state: 'closed', contextPct: null })])).toMatchObject({
      kind: 'continue',
      why: '«refunds»: context unknown, active 2.0 h ago'
    })
  })

  it('hands the thread to a new chat seeded from the old one when it is full or quiet', () => {
    expect(decide([chat({ contextPct: 64 })])).toEqual({
      kind: 'new',
      address: 'acme-api/refunds',
      project: 'acme-api',
      seedFrom: 'claude_a',
      why: '«refunds» is 64% full'
    })
    expect(decide([chat({ lastActivityAt: NOW - 13 * HOUR })])).toMatchObject({
      kind: 'new',
      seedFrom: 'claude_a',
      why: '«refunds» has been quiet 13 h'
    })
  })

  it('keeps its hands off a chat the owner is in or one mid-turn', () => {
    expect(decide([chat({ ownerAt: NOW - 5 * MIN })])).toMatchObject({
      kind: 'queue',
      why: 'the owner is in «refunds»'
    })
    expect(decide([chat({ state: 'working', midTurn: true })])).toMatchObject({ kind: 'queue' })
    expect(decide([chat({ state: 'waiting', midTurn: true })])).toMatchObject({
      kind: 'queue',
      why: "«refunds» is mid-turn, waiting for the owner's permission"
    })
    // «Working» with nothing heard for 12 h has hung: a new chat takes the thread over.
    expect(
      decide([chat({ state: 'working', midTurn: true, lastActivityAt: NOW - 14 * HOUR })])
    ).toMatchObject({
      kind: 'new',
      seedFrom: 'claude_a'
    })
    // A full chat is not continued anyway, so the owner in it does not hold the new one back.
    expect(decide([chat({ ownerAt: NOW - 5 * MIN, contextPct: 70 })])).toMatchObject({
      kind: 'new',
      seedFrom: 'claude_a'
    })
  })

  it('opens no third live chat on a project, nor a new one while five questions wait', () => {
    const others = [
      chat({ sessionId: 'claude_b', address: 'acme-api/docs', state: 'working', name: 'docs' }),
      chat({ sessionId: 'claude_c', address: 'acme-api/ci', state: 'waiting', name: 'ci' })
    ]
    expect(decide(others)).toEqual({
      kind: 'queue',
      address: 'acme-api/refunds',
      why: 'acme-api already has 2 live chats («docs», «ci»)'
    })
    expect(decide([], 5)).toMatchObject({ kind: 'queue', why: '5 questions wait for the owner' })
    // A quiet chat on the project no longer holds a place.
    expect(decide([others[0], { ...others[1], lastActivityAt: NOW - 13 * HOUR }])).toMatchObject({
      kind: 'new',
      seedFrom: null
    })
  })
})

describe('HQ+ session dispatcher: handoffs', () => {
  it('starts a handoff the owner left for a few minutes, never one he is looking at', () => {
    const old = chat({ ownerAt: NOW - 20 * MIN })
    expect(decideHqHandoff({ raisedAt: NOW - MIN, session: old, now: NOW })).toMatchObject({
      start: false
    })
    expect(decideHqHandoff({ raisedAt: NOW - 5 * MIN, session: old, now: NOW })).toEqual({
      start: true,
      why: '«refunds» handed off 5 min ago'
    })
    expect(
      decideHqHandoff({ raisedAt: NOW - 5 * MIN, session: chat({ ownerAt: NOW }), now: NOW })
    ).toEqual({ start: false, why: 'the owner is looking at «refunds»' })
  })
})
