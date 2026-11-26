import { describe, expect, it } from 'vitest'
import type { HqJournalEntry } from './hq-journal'
import { hqPlusLog } from './hq-plus-log'
import { HQ_INTAKE_KIND, HQ_NOTE_CARD_KEY_PREFIX } from './hq-slack-intake'
import type { PulseInboxItem } from './pulse-types'

const NOW = Date.UTC(2026, 10, 26, 12)
const DAY_START = NOW - 6 * 60 * 60_000

function note(id: string): HqJournalEntry {
  return {
    id: `j-${id}`,
    at: NOW - 60 * 60_000,
    workspace: 'acme',
    kind: 'waiting.open',
    project: null,
    address: null,
    sessionId: null,
    personId: null,
    title: `Ann waits on the owner: Acme MR for ${id}`,
    body: null,
    needs: 'owner:decide',
    status: 'open',
    replyTo: null,
    refKind: 'waiting',
    refId: id,
    links: [],
    source: 'pulse-wait:slack-promise',
    dedupeKey: `waiting.open:${id}`
  }
}

function card(id: string, over: Partial<PulseInboxItem> = {}): PulseInboxItem {
  return {
    id: `i-${id}`,
    kind: HQ_INTAKE_KIND,
    title: 'To work: Note',
    body: null,
    urgency: 'urgent',
    refKind: 'slack-message',
    refId: null,
    actions: [],
    dedupeKey: `${HQ_NOTE_CARD_KEY_PREFIX}${id}`,
    createdAt: NOW - 30 * 60_000,
    readAt: null,
    doneAt: null,
    doneAction: null,
    ...over
  }
}

describe('hqPlusLog and the To work card of a Notes line', () => {
  it('shows the Notes line once while its To work card is open', () => {
    const log = hqPlusLog([note('n1')], [card('n1')], DAY_START)
    expect(log.filter((item) => item.kind === 'card' && item.type === 'wait')).toEqual([])
    expect(log.some((item) => item.id === 'inbox:i-n1')).toBe(true)
  })

  it('shows the Notes card again once the To work card is handled', () => {
    const log = hqPlusLog(
      [note('n1')],
      [card('n1', { doneAt: NOW - 60_000, doneAction: 'skipped' })],
      DAY_START
    )
    expect(log.filter((item) => item.kind === 'card' && item.type === 'wait')).toHaveLength(1)
  })

  it('leaves other lines’ Notes cards alone', () => {
    const log = hqPlusLog([note('n1'), note('n2')], [card('n1')], DAY_START)
    const waits = log.filter((item) => item.kind === 'card' && item.type === 'wait')
    expect(waits.map((item) => item.id)).toEqual(['j-n2'])
  })
})
