import { afterEach, describe, expect, it } from 'vitest'
import { PulseCore } from './pulse-core'
import {
  bindChosenThread,
  cardRouteOf,
  saveCardRoute,
  bindSentMessage,
  liveChatOf,
  logRoute,
  ensureRouterLogColumns,
  ownerTaskOf,
  routerBindingFor,
  senderWorkOf,
  taskOfChat
} from './pulse-router-graph'
import { leadOfChat, routerCrumb, routerWorkTarget } from './pulse-router'
import {
  logChoice,
  logOutcome,
  reconcileRouterOutcomes,
  routerStats
} from './pulse-router-outcomes'

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

describe('card routes (T7)', () => {
  it('keeps a card’s route by its key and counts a try for each save', () => {
    const c = core()
    expect(cardRouteOf(c, 'k')).toBeNull()
    saveCardRoute(c, 'k', null, 1)
    expect(cardRouteOf(c, 'k')).toEqual({ at: 1, route: null, tries: 1 })
    saveCardRoute(c, 'k', { target: 'w' }, 2)
    expect(cardRouteOf(c, 'k')).toEqual({ at: 2, route: { target: 'w' }, tries: 2 })
  })

  describe('outcomes (T0)', () => {
    const route = (
      c: PulseCore,
      key: string,
      how: string,
      target: string,
      top: string[] = [target]
    ) => logRoute(c, { key, at: 10, how, target, top, auto: false })
    const outcomeOf = (c: PulseCore, key: string) =>
      c.db.prepare('SELECT outcome, chosen, reason FROM router_log WHERE key = ?').get(key)

    it('reads «sent» when the choice is the offer and «other» when it is another chat', () => {
      const c = core()
      route(c, 'a', 'crumb', 'x')
      route(c, 'b', 'crumb', 'x')
      logChoice(c, 'a', 'x', 20)
      logChoice(c, 'b', 'y', 20)
      expect(outcomeOf(c, 'a')).toMatchObject({ outcome: 'sent', chosen: 'x' })
      expect(outcomeOf(c, 'b')).toMatchObject({ outcome: 'other', chosen: 'y' })
    })

    it('keeps the first outcome', () => {
      const c = core()
      route(c, 'a', 'model', 'x')
      logOutcome(c, 'a', { outcome: 'skipped', at: 20, reason: 'skipped' })
      logOutcome(c, 'a', { outcome: 'paste', at: 21, chosen: 'y' })
      expect(outcomeOf(c, 'a')).toMatchObject({ outcome: 'skipped', chosen: null })
    })

    it('settles cards the bell closed by itself, with a reason', () => {
      const c = core()
      const item = (key: string, createdAt: number, doneAt: number | null, action: string | null) =>
        c.db
          .prepare(
            "INSERT INTO inbox (id, kind, title, urgency, actions, dedupe_key, created_at, done_at, done_action) VALUES (?, 'hq-intake', 't', 'normal', '[]', ?, ?, ?, ?)"
          )
          .run(key, key, createdAt, doneAt, action)
      const week = 7 * 24 * 60 * 60_000
      for (const id of ['gone1', 'gone2', 'auto', 'skip', 'open1']) {
        route(c, `slack:C:${id}`, 'thread', 'x')
      }
      item('hq-intake:C:gone1', 100, 200, 'gone')
      item('hq-intake:C:gone2', 100, 100 + week, 'gone')
      item('hq-intake:C:auto', 100, 200, 'sent')
      item('router:C:skip', 100, 200, 'skipped')
      item('hq-intake:C:open1', 100, null, null)
      route(c, 'slack:C:conv1', 'thread', 'x')
      item('hq-intake:conv:abc:conv1', 100, 200, 'sent')
      route(c, 'slack:C:old', 'thread', 'x')
      c.db.prepare("UPDATE router_log SET chosen = 'y' WHERE key = 'slack:C:old'").run()
      expect(reconcileRouterOutcomes(c, 1_000)).toBe(5)
      expect(outcomeOf(c, 'slack:C:conv1')).toMatchObject({ outcome: 'auto', chosen: 'x' })
      expect(outcomeOf(c, 'slack:C:old')).toMatchObject({ outcome: 'other', chosen: 'y' })
      expect(outcomeOf(c, 'slack:C:gone1')).toMatchObject({
        outcome: 'gone',
        reason: 'mark-removed-or-message-gone'
      })
      expect(outcomeOf(c, 'slack:C:gone2')).toMatchObject({
        outcome: 'gone',
        reason: 'expired-after-a-week'
      })
      expect(outcomeOf(c, 'slack:C:auto')).toMatchObject({ outcome: 'auto', chosen: 'x' })
      expect(outcomeOf(c, 'slack:C:skip')).toMatchObject({ outcome: 'skipped' })
      expect(outcomeOf(c, 'slack:C:open1')).toMatchObject({ outcome: null })
    })

    it('counts a class: chat, same work, top three, and the rest apart', () => {
      const c = core()
      for (const id of ['x', 'x2', 'y', 'z']) {
        session(c, id, 1)
      }
      handoff(c, 'x', 'x2', 5)
      route(c, 'r1', 'crumb', 'x', ['x', 'y', 'z'])
      route(c, 'r2', 'crumb', 'x', ['x', 'y', 'z'])
      route(c, 'r3', 'crumb', 'x', ['x', 'y', 'z'])
      route(c, 'r4', 'crumb', 'x')
      route(c, 'r5', 'crumb', 'x')
      logChoice(c, 'r1', 'x', 20)
      logChoice(c, 'r2', 'x2', 20)
      logChoice(c, 'r3', 'y', 20)
      logOutcome(c, 'r4', { outcome: 'skipped', at: 20, reason: 'skipped' })
      const stats = routerStats(c, 0)
      expect(stats).toEqual([
        {
          how: 'crumb',
          n: 3,
          chatRight: 1,
          workRight: 2,
          top3: 2,
          skipped: 1,
          gone: 0,
          open: 1,
          share: 1
        }
      ])
    })

    it('migrates a router_log made before outcomes', () => {
      const c = core()
      c.db.exec('DROP TABLE router_log')
      c.db.exec(
        'CREATE TABLE router_log (key TEXT PRIMARY KEY, at INTEGER NOT NULL, how TEXT NOT NULL, target TEXT NOT NULL, top TEXT NOT NULL, auto INTEGER NOT NULL, chosen TEXT, chosen_at INTEGER)'
      )
      ensureRouterLogColumns(c.db)
      ensureRouterLogColumns(c.db)
      route(c, 'a', 'crumb', 'x')
      logChoice(c, 'a', 'x', 20)
      expect(outcomeOf(c, 'a')).toMatchObject({ outcome: 'sent' })
    })
  })
})

const close = (c: PulseCore, id: string): void =>
  void c.db
    .prepare("UPDATE sessions SET state = 'closed', closed_at = 5 WHERE session_id = ?")
    .run(id)
const footer = (workId: string) => ({
  ref: 'abc123',
  chatId: null,
  workId,
  chatTitle: 'W · export',
  leadTitle: null,
  project: 'acme',
  task: null
})

describe('router v2 T1: works', () => {
  it('knows a sender’s work unless it is a one-off chat with no role and no parent', () => {
    const c = core()
    role(c, 'w', 'worker')
    link(c, 'ask', 'w')
    handoff(c, 'solo1', 'solo2', 10)
    expect(senderWorkOf(c, 'w')).toEqual({ work: 'w', known: true })
    expect(senderWorkOf(c, 'ask')).toEqual({ work: 'w', known: true })
    expect(senderWorkOf(c, 'solo2')).toEqual({ work: 'solo1', known: true })
    expect(senderWorkOf(c, 'inbox')).toEqual({ work: 'inbox', known: false })
  })

  it('binds our message to the work the Approve card confirmed, over the sender’s', () => {
    const c = core()
    bindSentMessage(c, {
      channel: 'C1',
      ts: '1.0',
      threadTs: null,
      sender: 'ask',
      at: 1,
      work: 'W1'
    })
    bindSentMessage(c, { channel: 'C1', ts: '2.0', threadTs: '1.0', sender: 'ask', at: 2 })
    expect(routerBindingFor(c, { channel: 'C1', threadTs: '1.0', linked: null, at: 1 })?.task).toBe(
      'W1'
    )
    expect(routerBindingFor(c, { channel: 'C1', threadTs: '1.0', linked: null, at: 3 })?.task).toBe(
      'ask'
    )
  })

  it('a work goes to its chat now, its Lead once closed, and nowhere with no live Lead', () => {
    const c = core()
    for (const id of ['W1', 'W2', 'L1', 'L2']) {
      session(c, id, 1)
    }
    role(c, 'W1', 'worker')
    role(c, 'L1', 'lead')
    role(c, 'L2', 'lead')
    link(c, 'W1', 'L1')
    link(c, 'L2', 'L1')
    handoff(c, 'W1', 'W2', 10)
    expect(routerWorkTarget(c, 'W1')).toMatchObject({ chat: 'W2', lead: 'L2' })
    close(c, 'W2')
    expect(routerWorkTarget(c, 'W1')).toMatchObject({ chat: null, lead: 'L2' })
    close(c, 'L2')
    expect(routerWorkTarget(c, 'W1')).toMatchObject({ chat: null, lead: null })
  })

  it('a `w` footer names the work itself, not the chat that sent the message', () => {
    const c = core()
    const work = '5a7fefad-4a7f-4676-bd5e-b46493c68fe9'
    const next = '9b9b9b9b-0000-4000-8000-000000000000'
    session(c, work, 1)
    session(c, next, 2)
    handoff(c, work, next, 10)
    const crumb = routerCrumb(c, {
      footers: [footer('5a7fefad')],
      channel: 'C1',
      threadTs: null,
      linked: null,
      at: 20
    })
    expect(crumb).toEqual({ chat: next, lead: null, chatTitle: 'W · export', work })
  })
})
