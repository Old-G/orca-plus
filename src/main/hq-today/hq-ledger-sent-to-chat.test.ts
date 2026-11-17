import { afterEach, describe, expect, it } from 'vitest'
import type { HqLedgerSignal } from '../../shared/hq-ledger'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { HQ_SEND_TO_CHAT_MAX, hqRecordSentToChat } from './hq-ledger-sent-to-chat'

const MR = 'gitlab:acme/app!7'
const T0 = 1_000_000
const open: PulseDb[] = []
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

function setup(): {
  db: PulseDb
  comment: (n: number, at?: number) => void
  send: (upTo: number) => boolean
} {
  let id = 0
  const db = new PulseDb(':memory:', { now: () => T0 + 10_000, newId: () => `id-${++id}` })
  open.push(db)
  const comment = (n: number, at = T0 + n): void => {
    const signal: HqLedgerSignal = {
      key: MR,
      ts: `note:${String(n)}`,
      at,
      author: 'Bob',
      authorId: 'bob',
      fromOwner: false,
      text: `comment ${String(n)}`,
      link: null,
      reader: 'gitlab-mr-notes',
      forOwner: true,
      project: null,
      title: 'Comment: MR'
    }
    db.ingestLedgerSignal(signal)
  }
  const send = (upTo: number): boolean =>
    hqRecordSentToChat(
      {
        ingest: (signal) => db.ingestLedgerSignal(signal),
        lastDirection: (key) => db.lastLedgerDirection(key),
        close: (key) => db.closeLedgerConversation(key),
        now: () => T0 + 10_000
      },
      MR,
      { sessionId: 'claude_1', chat: 'app', upTo }
    ).closed
  return { db, comment, send }
}

describe('Send to chat on an MR card', () => {
  it('owes the chat every comment since the last send, not the card’s six', () => {
    const { db, comment, send } = setup()
    for (let n = 1; n <= 8; n++) {
      comment(n)
    }
    const unsent = db.listLedgerUnsent(MR, HQ_SEND_TO_CHAT_MAX)
    expect(unsent.map((m) => m.text)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `comment ${n}`))
    expect(send(T0 + 8)).toBe(true)
    expect(db.listLedgerUnsent(MR, HQ_SEND_TO_CHAT_MAX)).toEqual([])
  })

  it('keeps the card open when a comment came in while the send was on its way', () => {
    const { db, comment, send } = setup()
    comment(1)
    comment(5)
    expect(send(T0 + 1)).toBe(false)
    expect(db.listLedgerOpenKeys('gitlab-mr-notes')).toEqual([MR])
    expect(db.listLedgerUnsent(MR, HQ_SEND_TO_CHAT_MAX).map((m) => m.text)).toEqual(['comment 5'])
  })

  it('keeps comments sharing a time with the last one of a full batch in that batch', () => {
    const { db, comment, send } = setup()
    for (let n = 1; n <= HQ_SEND_TO_CHAT_MAX - 1; n++) {
      comment(n)
    }
    comment(HQ_SEND_TO_CHAT_MAX, T0 + 100)
    comment(HQ_SEND_TO_CHAT_MAX + 1, T0 + 100)
    const unsent = db.listLedgerUnsent(MR, HQ_SEND_TO_CHAT_MAX)
    expect(unsent.map((m) => m.text).slice(-2)).toEqual([
      `comment ${HQ_SEND_TO_CHAT_MAX}`,
      `comment ${HQ_SEND_TO_CHAT_MAX + 1}`
    ])
    expect(send(Math.max(...unsent.map((m) => m.at)))).toBe(true)
    expect(db.listLedgerUnsent(MR, HQ_SEND_TO_CHAT_MAX)).toEqual([])
  })
})
