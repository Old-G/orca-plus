import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from './pulse-db'
import { PulseCore } from './pulse-core'
import { liveSessionOf } from './pulse-chat-chain'

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
function session(c: PulseCore, id: string, lastAt: number, parent: string | null = null): void {
  c.db
    .prepare(
      `INSERT INTO sessions (session_id, workspace, state, opened_at, last_activity_at, parent_session_id)
       VALUES (?, 'w', 'done', ?, ?, ?)`
    )
    .run(id, lastAt, lastAt, parent)
}

describe('liveSessionOf', () => {
  it('is the chat itself when nothing continued it', () => {
    expect(liveSessionOf(core(), 'a')).toBe('a')
  })
  it('follows handoffs to the last chat of the chain', () => {
    const c = core()
    handoff(c, 'a', 'b', 1)
    handoff(c, 'b', 'c', 2)
    expect(liveSessionOf(c, 'a')).toBe('c')
    expect(liveSessionOf(c, 'b')).toBe('c')
  })
  it('follows a parent link the dispatcher wrote', () => {
    const c = core()
    session(c, 'b', 5, 'a')
    expect(liveSessionOf(c, 'a')).toBe('b')
  })
  it('takes the most recently active chat at a fork and survives a loop', () => {
    const c = core()
    session(c, 'b', 10)
    session(c, 'c', 20)
    handoff(c, 'a', 'b', 1)
    handoff(c, 'a', 'c', 2)
    handoff(c, 'c', 'a', 3)
    expect(liveSessionOf(c, 'a')).toBe('c')
  })
  it('is reachable through PulseDb', () => {
    const db = new PulseDb(':memory:', { now: () => 1, newId: () => 'y' })
    expect(db.liveSessionOf('z')).toBe('z')
    db.close()
  })
})
