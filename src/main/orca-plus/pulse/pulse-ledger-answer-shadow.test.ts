import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from './pulse-db'

const open: PulseDb[] = []
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

describe('ledger answers in shadow', () => {
  it('keeps its own pairs as events and reads the reply reader pairs, leaving waitings alone', () => {
    let id = 0
    let now = 1_000_000
    const db = new PulseDb(':memory:', { now: () => now, newId: () => `id-${++id}` })
    open.push(db)
    const bob = db.upsertPerson({ name: 'Bob', slackUserId: 'U_BOB' })
    const asked = db.addWaiting({
      direction: 'on-them',
      personId: bob.id,
      title: 'Is the import done?',
      source: 'agent'
    })
    now += 1_000
    db.ledgerShadow.record({
      waitingId: asked.id,
      ts: '1700000002.000000',
      messages: ['1700000001.000000', '1700000002.000000'],
      how: 'dm',
      at: now
    })
    expect(db.ledgerShadow.list(0)).toEqual([
      {
        waitingId: asked.id,
        ts: '1700000002.000000',
        messages: ['1700000001.000000', '1700000002.000000'],
        how: 'dm',
        at: now
      }
    ])
    expect(db.ledgerShadow.list(now + 1)).toEqual([])
    expect(db.listWaitings({ status: 'open' })[0]?.replyTs).toBeNull()
    expect(db.ledgerShadow.reader(0)).toEqual([])

    db.recordWaitingReply(asked.id, {
      text: 'Bob: done',
      author: 'Bob',
      ts: '1700000002.000000',
      authorId: 'U_BOB'
    })
    db.recordWaitingReply(asked.id, {
      text: 'Bob: and more',
      author: 'Bob',
      ts: '1700000009.000000'
    })
    expect(db.ledgerShadow.reader(0)).toEqual([
      { waitingId: asked.id, ts: '1700000002.000000', authorId: 'U_BOB' },
      { waitingId: asked.id, ts: '1700000009.000000', authorId: null }
    ])
  })
})
