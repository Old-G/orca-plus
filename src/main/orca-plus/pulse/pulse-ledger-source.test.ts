import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from './pulse-db'
import type { HqLedgerSignal } from '../../../shared/hq-ledger'

const open: PulseDb[] = []
let tick = 1_792_000_000_000
function openDb(): PulseDb {
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

function signal(over: Partial<HqLedgerSignal>): HqLedgerSignal {
  return {
    key: 'slack:C0HUB:1700000000.000100',
    ts: '1700000000.000100',
    at: 1_700_000_000_000,
    author: 'Ann',
    authorId: 'U0ANN',
    fromOwner: false,
    text: 'Can the service account read orders_view until Friday?',
    link: 'https://acme.example/archives/C0HUB/p1700000000000100',
    reader: 'slack-mention',
    forOwner: true,
    project: null,
    title: 'orders_view access',
    ...over
  }
}

describe('slackSourceMessage', () => {
  it('gives the whole root line of a thread, with its author and link', () => {
    const db = openDb()
    db.ingestLedgerSignal(signal({}))
    expect(db.slackSourceMessage('C0HUB', '1700000000.000100')).toEqual({
      author: 'Ann',
      at: 1_700_000_000_000,
      text: 'Can the service account read orders_view until Friday?',
      link: 'https://acme.example/archives/C0HUB/p1700000000000100'
    })
  })

  it('answers the newest line from someone else, not the owner’s own', () => {
    const db = openDb()
    db.ingestLedgerSignal(signal({}))
    db.ingestLedgerSignal(
      signal({
        ts: '1700000001.000100',
        at: 1_700_000_010_000,
        author: 'Bob',
        text: 'Same for me',
        link: null
      })
    )
    db.ingestLedgerSignal(
      signal({
        ts: '1700000002.000100',
        at: 1_700_000_020_000,
        fromOwner: true,
        author: 'Owner',
        text: 'Looking'
      })
    )
    expect(db.slackSourceMessage('C0HUB', '1700000000.000100')).toMatchObject({
      author: 'Bob',
      text: 'Same for me',
      link: null
    })
  })

  it('skips the scout’s summaries and the ClickUp bot, which are not what a person said', () => {
    const db = openDb()
    db.ingestLedgerSignal(signal({}))
    db.ingestLedgerSignal(
      signal({ ts: 'req:1', at: 1_700_000_010_000, author: null, text: 'Summary' })
    )
    db.ingestLedgerSignal(
      signal({
        ts: '1700000003.000100',
        at: 1_700_000_020_000,
        authorId: '-1',
        text: 'Bot comment'
      })
    )
    expect(db.slackSourceMessage('C0HUB', '1700000000.000100')?.author).toBe('Ann')
  })

  it('takes the newest incoming line of a DM when the reply has no thread', () => {
    const db = openDb()
    db.ingestLedgerSignal(
      signal({ key: 'slack:D0ANN:1700000000.1', ts: '1700000000.1', text: 'Are you there?' })
    )
    expect(db.slackSourceMessage('D0ANN', null)?.text).toBe('Are you there?')
  })

  it('has nothing for a top-level post in a channel or a thread the ledger never saw', () => {
    const db = openDb()
    db.ingestLedgerSignal(signal({}))
    expect(db.slackSourceMessage('C0HUB', null)).toBeNull()
    expect(db.slackSourceMessage('C0HUB', '1.1')).toBeNull()
  })
})
