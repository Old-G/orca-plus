import { describe, expect, it } from 'vitest'
import type { HqJournalEntry } from './hq-journal'
import type { PulseInboxItem } from './pulse-types'
import { hqPlusFeedInbox } from './hq-plus-feed-inbox'

const DAY = Date.UTC(2026, 10, 13)
const HOUR = 60 * 60_000

function item(over: Partial<PulseInboxItem>): PulseInboxItem {
  return {
    id: 'i',
    kind: 'agent-finished',
    title: 't',
    body: null,
    urgency: 'normal',
    refKind: null,
    refId: null,
    actions: [],
    dedupeKey: null,
    createdAt: DAY - 30 * HOUR,
    readAt: null,
    doneAt: DAY - 29 * HOUR,
    doneAction: null,
    ...over
  }
}

const entry = (over: Partial<HqJournalEntry>): HqJournalEntry =>
  ({ id: 'e', ...over }) as HqJournalEntry

describe('hqPlusFeedInbox (13.11)', () => {
  it('leaves out what was raised and settled before the day, keeps the rest', () => {
    const items = [
      item({ id: 'old-done' }),
      item({ id: 'open', doneAt: null }),
      item({ id: 'done-today', doneAt: DAY + HOUR }),
      item({ id: 'raised-today', createdAt: DAY + HOUR, doneAt: DAY + 2 * HOUR }),
      item({ id: 'report', kind: 'hq-report' }),
      item({ id: 'answer', kind: 'hq-waiting-reply' }),
      item({ id: 'pointed' }),
      item({ id: 'approve', kind: 'outgoing-approval', refId: 'draft-1' }),
      item({ id: 'approve-old', kind: 'outgoing-approval', refId: 'draft-2' })
    ]
    const entries = [
      entry({ id: 'e1', refKind: 'inbox', refId: 'pointed' }),
      entry({ id: 'e2', refKind: 'draft', refId: 'draft-1' })
    ]
    expect(hqPlusFeedInbox(items, entries, DAY).map((kept) => kept.id)).toEqual([
      'open',
      'done-today',
      'raised-today',
      'report',
      'answer',
      'pointed',
      'approve'
    ])
  })

  it('keeps everything when no day is given (the phone, older callers)', () => {
    expect(hqPlusFeedInbox([item({ id: 'old-done' })], [], undefined)).toHaveLength(1)
  })
})
