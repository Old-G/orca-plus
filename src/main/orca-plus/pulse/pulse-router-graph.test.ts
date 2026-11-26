import { afterEach, describe, expect, it } from 'vitest'
import { PulseCore } from './pulse-core'
import {
  bindChosenThread,
  bindSentMessage,
  liveChatOf,
  logChoice,
  logRoute,
  ownerTaskOf,
  routerBindingFor,
  taskOfChat
} from './pulse-router-graph'
import { leadOfChat } from './pulse-router'

const open: PulseCore[] = []
function core(): PulseCore {
  const c = new PulseCore(':memory:', { now: () => 1_000, newId: () => 'x' })
  open.push(c)
  return c
}
afterEach(() => {
  for (const c of open.splice(0)) {
    c.close()
  }
})
function handoff(c: PulseCore, from: string, to: string, at: number): void {
  c.db
    .prepare(
      `INSERT INTO journal (id, at, workspace, kind, session_id, title, needs, ref_kind, ref_id, source)
       VALUES (?, ?, 'w', 'session.handoff', ?, 'Handoff', 'nobody', 'session', ?, 'test')`
    )
    .run(`h-${from}-${to}`, at, to, from)
}
function session(c: PulseCore, id: string, at: number): void {
  c.db
    .prepare(
      `INSERT INTO sessions (session_id, workspace, state, opened_at, last_activity_at)
       VALUES (?, 'w', 'working', ?, ?)`
    )
    .run(id, at, at)
}
const role = (c: PulseCore, id: string, r: string): void =>
  void c.db.prepare('INSERT INTO chat_roles (session_id, role, at) VALUES (?, ?, 1)').run(id, r)
const link = (c: PulseCore, id: string, parent: string): void =>
  void c.db
    .prepare(
      "INSERT INTO chat_links (session_id, parent_session_id, via, at) VALUES (?, ?, 'launch', 1)"
    )
    .run(id, parent)

describe('router graph: tasks', () => {
  it('names a task by the first chat of its handoff chain', () => {
    const c = core()
    handoff(c, 'w1', 'w2', 10)
    handoff(c, 'w2', 'w3', 20)
    expect(taskOfChat(c, 'w3')).toBe('w1')
    expect(taskOfChat(c, 'solo')).toBe('solo')
  })
  it('a one-off chat with no role writes for its parent task; a worker for its own', () => {
    const c = core()
    handoff(c, 'p1', 'p2', 5)
    link(c, 'ask', 'p2')
    role(c, 'w', 'worker')
    link(c, 'w', 'lead')
    expect(ownerTaskOf(c, 'ask')).toBe('p1')
    expect(ownerTaskOf(c, 'w')).toBe('w')
    expect(ownerTaskOf(c, 'inbox')).toBe('inbox')
  })
})

describe('router graph: Lead succession', () => {
  it('a Lead launched by a Lead takes its task over', () => {
    const c = core()
    role(c, 'L1', 'lead')
    role(c, 'L2', 'lead')
    role(c, 'W', 'worker')
    link(c, 'L2', 'L1')
    link(c, 'W', 'L1')
    expect(liveChatOf(c, 'L1')).toBe('L2')
    expect(taskOfChat(c, 'L2')).toBe('L1')
    expect(liveChatOf(c, 'W')).toBe('W')
  })
})

describe('router graph: bindings', () => {
  it('a reply in the thread of our message goes to the live chat of the sending task', () => {
    const c = core()
    bindSentMessage(c, { channel: 'D1', ts: '100.1', threadTs: null, sender: 'w1', at: 100 })
    handoff(c, 'w1', 'w2', 200)
    expect(
      routerBindingFor(c, { channel: 'D1', threadTs: '100.1', linked: null, at: 300 })
    ).toEqual({
      task: 'w1',
      chat: 'w2',
      source: 'approve'
    })
  })
  it('a mediator binds the parent task; the latest message in the thread wins', () => {
    const c = core()
    link(c, 'ask', 'main')
    bindSentMessage(c, { channel: 'C1', ts: '5.0', threadTs: '1.0', sender: 'other', at: 5 })
    bindSentMessage(c, { channel: 'C1', ts: '7.0', threadTs: '1.0', sender: 'ask', at: 7 })
    expect(routerBindingFor(c, { channel: 'C1', threadTs: '1.0', linked: null, at: 8 })?.chat).toBe(
      'main'
    )
    expect(routerBindingFor(c, { channel: 'C1', threadTs: '1.0', linked: null, at: 6 })?.chat).toBe(
      'other'
    )
  })
  it("the owner's choice outranks our message, and a link names its message", () => {
    const c = core()
    bindSentMessage(c, { channel: 'C1', ts: '2.0', threadTs: '1.0', sender: 'a', at: 2 })
    bindSentMessage(c, { channel: 'C2', ts: '9.0', threadTs: null, sender: 'b', at: 9 })
    bindChosenThread(c, { channel: 'C1', threadTs: '1.0', chat: 'z', at: 3 })
    expect(
      routerBindingFor(c, { channel: 'C1', threadTs: '1.0', linked: null, at: 4 })
    ).toMatchObject({
      chat: 'z',
      source: 'choice'
    })
    expect(
      routerBindingFor(c, {
        channel: 'D9',
        threadTs: null,
        linked: { channel: 'C2', ts: '9.0' },
        at: 10
      })?.chat
    ).toBe('b')
    expect(routerBindingFor(c, { channel: 'D9', threadTs: null, linked: null, at: 10 })).toBeNull()
  })
  it('after a lead change the task keeps its chat and names the new Lead', () => {
    const c = core()
    session(c, 'w', 1)
    role(c, 'w', 'worker')
    role(c, 'L1', 'lead')
    role(c, 'L2', 'lead')
    link(c, 'w', 'L1')
    bindSentMessage(c, { channel: 'D1', ts: '1.0', threadTs: null, sender: 'w', at: 1 })
    c.db
      .prepare(
        "INSERT INTO chat_lead_moves (chat, from_lead, to_lead, session_id, to_session_id, at) VALUES ('w', 'L1', 'L2', 'w', 'L2', 5)"
      )
      .run()
    const bound = routerBindingFor(c, { channel: 'D1', threadTs: '1.0', linked: null, at: 9 })
    expect(bound?.chat).toBe('w')
    expect(leadOfChat(c, 'w')).toBe('L2')
  })
})

describe('router log', () => {
  it('keeps the first route of a card and the owner choice once', () => {
    const c = core()
    logRoute(c, { key: 'k', at: 1, how: 'crumb', target: 'a', top: ['a', 'b'], auto: false })
    logRoute(c, { key: 'k', at: 2, how: 'model', target: 'b', top: ['b'], auto: false })
    logChoice(c, 'k', 'b', 3)
    logChoice(c, 'k', 'c', 4)
    expect(c.db.prepare('SELECT how, target, top, chosen FROM router_log').get()).toEqual({
      how: 'crumb',
      target: 'a',
      top: '["a","b"]',
      chosen: 'b'
    })
  })
})
