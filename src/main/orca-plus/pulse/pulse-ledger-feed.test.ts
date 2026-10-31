import { afterEach, describe, expect, it } from 'vitest'
import type { HqLedgerSignal } from '../../../shared/hq-ledger'
import { hqLedgerSignalOfCard } from '../../../shared/hq-ledger-from-inbox'
import { PulseDb } from './pulse-db'

const open: PulseDb[] = []
let tick = 0
function openDb(): PulseDb {
  let id = 0
  tick = 1_000_000
  const db = new PulseDb(':memory:', { now: () => tick, newId: () => `id-${++id}` })
  open.push(db)
  return db
}
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

const THREAD = 'slack:C0123HUBXY:1700000000.000100'
function signal(over: Partial<HqLedgerSignal>): HqLedgerSignal {
  return {
    key: THREAD,
    ts: '1700000001.000000',
    at: tick + 1,
    author: 'Ann',
    authorId: 'U_ANN',
    fromOwner: false,
    text: 'hi',
    link: null,
    reader: 'slack-mention',
    forOwner: true,
    project: null,
    title: 'Thread',
    ...over
  }
}

describe('ledger feed', () => {
  it('lists the window’s conversations with their messages and places every waiting', () => {
    const db = openDb()
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Mark 37 pairs',
      source: 'slack',
      sourceRef:
        'https://acme.slack.com/archives/C0123HUBXY/p1700000000000100?thread_ts=1700000000.000100'
    })
    const elsewhere = db.addWaiting({
      direction: 'on-them',
      title: 'Review',
      source: 'clickup',
      sourceRef: 'https://app.clickup.com/t/31632516/DEV-1'
    })
    db.ingestLedgerSignal(signal({ fromOwner: true, author: 'Owner', text: 'Mark them?' }))
    db.ingestLedgerSignal(signal({ ts: '1700000002.000000', text: 'Done', at: tick + 2 }))

    const feed = db.listLedgerFeed(tick - 1)
    expect(feed.waitingPlaces).toEqual({ [asked.id]: THREAD, [elsewhere.id]: 'clickup:DEV-1' })
    expect(feed.conversations).toEqual([
      expect.objectContaining({
        key: THREAD,
        messages: [
          expect.objectContaining({ direction: 'out', text: 'Mark them?' }),
          expect.objectContaining({ direction: 'in', author: 'Ann', text: 'Done' })
        ]
      })
    ])
    // Why: a conversation older than the window stays while a waiting of the window lives in it.
    expect(db.listLedgerFeed(tick + 100).conversations.map((c) => c.key)).toEqual([THREAD])
  })

  it('keeps the owner’s project for the thread and gives a channel’s new threads the same', () => {
    const db = openDb()
    db.ingestLedgerSignal(signal({}))
    db.setLedgerProject(THREAD, 'hub')
    db.ingestLedgerSignal(signal({ key: 'slack:C0123HUBXY:1700000009.000100', ts: '1700000009.1' }))
    // A DM spans every project: no rule for its other talks.
    db.ingestLedgerSignal(signal({ key: 'slack:D0ANN:1700000000.1', ts: '1700000000.1' }))
    db.setLedgerProject('slack:D0ANN:1700000000.1', 'hub')
    db.ingestLedgerSignal(
      signal({ key: 'slack:D0ANN:1800000000.1', ts: '1800000000.1', at: tick + 1e9 })
    )

    const rows = db.listLedgerFeed(0).conversations
    expect(rows.map((row) => [row.key, row.project, row.projectHow])).toEqual([
      [THREAD, 'hub', 'owner'],
      ['slack:C0123HUBXY:1700000009.000100', 'hub', 'rule'],
      ['slack:D0ANN:1700000000.1', 'hub', 'owner'],
      ['slack:D0ANN:1800000000.1', null, null]
    ])
  })
})

describe('ledger states the feed relies on (Codex, 30.10)', () => {
  const stateOf = (db: PulseDb, key = THREAD): string | undefined =>
    db.listLedgerConversations().find((row) => row.key === key)?.state

  it('settles a conversation once its waiting is closed, and a new message raises it again', () => {
    const db = openDb()
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Mark 37 pairs',
      source: 'slack',
      sourceRef: THREAD
    })
    db.ingestLedgerSignal(signal({ text: 'Done' }))
    expect(stateOf(db)).toBe('you')
    db.closeWaiting(asked.id, 'resolved', 'Close waiting')
    expect(stateOf(db)).toBe('done')
    db.ingestLedgerSignal(signal({ ts: '1700000005.000000', text: 'One more thing', at: tick + 5 }))
    expect(stateOf(db)).toBe('you')
  })

  it('keeps a newer request when the waiting it followed is closed (Codex, 31.10)', () => {
    const db = openDb()
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Mark 37 pairs',
      source: 'slack',
      sourceRef: THREAD
    })
    db.ingestLedgerSignal(signal({ text: 'Done' }))
    db.ingestLedgerSignal(
      signal({ ts: '1700000003.000000', text: 'Also, can you check 12 more?', at: tick + 3 })
    )
    db.closeWaiting(asked.id, 'resolved', 'Close waiting')
    expect(stateOf(db)).toBe('you')
  })

  it('settles the conversation when the recorded answer is the newest message', () => {
    const db = openDb()
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Mark 37 pairs',
      source: 'slack',
      sourceRef: THREAD
    })
    db.ingestLedgerSignal(signal({ text: 'Working on it' }))
    db.ingestLedgerSignal(signal({ ts: '1700000003.000000', text: 'Done', at: tick + 3 }))
    db.recordWaitingReply(asked.id, { ts: '1700000003.000000', text: 'Done', author: 'Ann' })
    db.closeWaiting(asked.id, 'resolved', 'Close waiting')
    expect(stateOf(db)).toBe('done')
  })

  it('does not let a late guess raise a conversation the owner already answered', () => {
    const db = openDb()
    const first = db.ingestLedgerSignal(signal({ forOwner: false, text: 'fyi: deploy at 5' }))
    db.ingestLedgerSignal(
      signal({ ts: '1700000002.000000', fromOwner: true, author: 'Owner', at: tick + 2 })
    )
    db.setLedgerGuess(first.conversationId, {
      project: 'hub',
      how: 'model',
      state: 'you',
      gist: 'Deploy'
    })
    expect(stateOf(db)).toBe('fyi')
    // The guess still raises a talk whose newest message is the person's.
    db.ingestLedgerSignal(
      signal({ ts: '1700000003.000000', forOwner: false, text: 'and?', at: tick + 3 })
    )
    db.setLedgerGuess(first.conversationId, {
      project: null,
      how: 'model',
      state: 'you',
      gist: null
    })
    expect(stateOf(db)).toBe('you')
  })

  it('reads a card the owner already handled as waiting on nobody', () => {
    const lookups = { waitingRef: () => null, personAuthorId: () => null }
    const card = {
      kind: 'hq-intake',
      title: 'Ann: hi',
      createdAt: tick,
      refId: JSON.stringify({ channel: 'C0123HUBXY', ts: '1700000000.000100', author: 'Ann' })
    }
    expect(hqLedgerSignalOfCard(card, lookups)?.forOwner).toBe(true)
    expect(hqLedgerSignalOfCard({ ...card, doneAt: tick }, lookups)?.forOwner).toBe(false)
  })
})
