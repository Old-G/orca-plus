import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from './pulse-db'

const open: PulseDb[] = []
function db(): PulseDb {
  const made = new PulseDb(':memory:')
  open.push(made)
  return made
}
afterEach(() => {
  for (const made of open.splice(0)) {
    made.close()
  }
})

const link = (sessionId: string, parentSessionId: string, at = 1) =>
  ({ sessionId, parentSessionId, via: 'launch', at }) as const

describe('chat links', () => {
  it('keeps the first parent of a chat and lists the links newest first', () => {
    const d = db()
    expect(d.chats.link(link('kid', 'brain', 1))).toBe(true)
    expect(d.chats.link(link('kid', 'other', 2))).toBe(false)
    expect(d.chats.link(link('strata', 'brain', 3))).toBe(true)
    expect(d.chats.list().links.map((row) => [row.sessionId, row.parentSessionId])).toEqual([
      ['strata', 'brain'],
      ['kid', 'brain']
    ])
  })

  it('writes no link to itself or one that closes a loop', () => {
    const d = db()
    expect(d.chats.link(link('a', 'a'))).toBe(false)
    d.chats.link(link('b', 'a'))
    d.chats.link(link('c', 'b'))
    expect(d.chats.link(link('a', 'c'))).toBe(false)
  })

  it('a handoff is a continuation, not a child, and no link joins the two halves', () => {
    const d = db()
    const base = {
      address: 'acme/x',
      agent: 'claude',
      worktreeId: null,
      workspace: 'w',
      project: 'acme',
      state: 'working' as const,
      contextPct: null,
      taskRef: null,
      at: 1
    }
    d.noteSessions([
      { ...base, sessionId: 'old', parentSessionId: null },
      { ...base, sessionId: 'new', parentSessionId: 'old' }
    ])
    expect(d.chats.link(link('old', 'new'))).toBe(false)
    expect(d.chats.link(link('new', 'old'))).toBe(false)
    expect(d.chats.list()).toEqual({
      links: [],
      continues: [{ sessionId: 'new', fromSessionId: 'old' }]
    })
  })
})
