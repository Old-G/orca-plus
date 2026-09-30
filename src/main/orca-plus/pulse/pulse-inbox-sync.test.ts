import { afterEach, describe, expect, it } from 'vitest'
import { onPulseChanged } from './pulse-change-events'
import { PulseDb } from './pulse-db'
import { INBOX_GONE_ACTION } from './pulse-inbox'

const open: PulseDb[] = []

function openDb(): PulseDb {
  let tick = 1_000
  let id = 0
  const db = new PulseDb(':memory:', { now: () => (tick += 1_000), newId: () => `id-${++id}` })
  open.push(db)
  return db
}

afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

const item = (dedupeKey: string) => ({ kind: 'ignored', title: dedupeKey, dedupeKey })

function openKeys(db: PulseDb): (string | null)[] {
  return db
    .listInbox()
    .map((entry) => entry.dedupeKey)
    .sort()
}

describe('syncInboxKind', () => {
  it('raises the missing items under the synced kind and leaves present ones alone', () => {
    const db = openDb()
    expect(db.syncInboxKind('agent-waiting', [item('a')])).toEqual({ raised: 1, closed: 0 })
    const [first] = db.listInbox()
    expect(first).toMatchObject({ kind: 'agent-waiting', dedupeKey: 'a' })
    expect(db.syncInboxKind('agent-waiting', [item('a'), item('b')])).toEqual({
      raised: 1,
      closed: 0
    })
    expect(openKeys(db)).toEqual(['a', 'b'])
    expect(db.listInbox().find((entry) => entry.dedupeKey === 'a')?.id).toBe(first?.id)
  })

  it('closes items the producer no longer reports as gone, and raises them again if they return', () => {
    const db = openDb()
    db.syncInboxKind('agent-waiting', [item('a'), item('b')])
    expect(db.syncInboxKind('agent-waiting', [item('b')])).toEqual({ raised: 0, closed: 1 })
    expect(openKeys(db)).toEqual(['b'])
    const gone = db.listInbox({ includeDone: true }).find((entry) => entry.dedupeKey === 'a')
    expect(gone?.doneAction).toBe(INBOX_GONE_ACTION)
    expect(db.syncInboxKind('agent-waiting', [item('a'), item('b')])).toEqual({
      raised: 1,
      closed: 0
    })
    expect(openKeys(db)).toEqual(['a', 'b'])
  })

  it('does not raise again a key the user already answered', () => {
    const db = openDb()
    db.syncInboxKind('claude-limit', [item('card-1')])
    const [card] = db.listInbox()
    db.markInboxDone(card!.id, 'dismiss')
    expect(db.syncInboxKind('claude-limit', [item('card-1')])).toEqual({ raised: 0, closed: 0 })
    expect(db.listInbox()).toEqual([])
  })

  it('touches only its own kind', () => {
    const db = openDb()
    db.addInboxItem({ kind: 'handoff', title: 'offer', dedupeKey: 'handoff:1' })
    db.addInboxItem({ kind: 'agent-waiting', title: 'unkeyed' })
    expect(db.syncInboxKind('agent-waiting', [])).toEqual({ raised: 0, closed: 1 })
    expect(openKeys(db)).toEqual(['handoff:1'])
  })

  it('writes the whole sync in one transaction and notifies once', () => {
    const db = openDb()
    db.syncInboxKind('agent-waiting', [item('a'), item('b')])
    let changes = 0
    const off = onPulseChanged(() => {
      changes += 1
    })
    try {
      // Why: a nested BEGIN from the per-item writers would throw here.
      expect(db.syncInboxKind('agent-waiting', [item('c'), item('d')])).toEqual({
        raised: 2,
        closed: 2
      })
    } finally {
      off()
    }
    expect(changes).toBe(1)
    expect(db.syncInboxKind('agent-waiting', [item('c'), item('d')])).toEqual({
      raised: 0,
      closed: 0
    })
  })
})
