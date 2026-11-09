import { describe, expect, it } from 'vitest'
import { HQ_LEDGER_CARD_HOLD_MS, hqLedgerCardReady } from './hq-ledger-cards'

const NOW = 1_794_215_800_000

function row(ts: string, at: number) {
  return { messages: [{ ts, author: 'Ann', authorId: 'U0ANN', text: 'Thanks!', link: null, at }] }
}

// 09.11: «спасибо, всё супер» made five cards in ten minutes, each gone once the model read it.
describe('hqLedgerCardReady', () => {
  it('holds a card until the model read its newest message', () => {
    expect(hqLedgerCardReady(row('2.0', NOW - 10_000), null, NOW)).toBe(false)
    expect(hqLedgerCardReady(row('2.0', NOW - 10_000), { lastTs: '1.0' }, NOW)).toBe(false)
    expect(hqLedgerCardReady(row('2.0', NOW - 10_000), { lastTs: '2.0' }, NOW)).toBe(true)
  })

  it('shows it anyway once the hold is over, so a model down hides nothing for good', () => {
    expect(hqLedgerCardReady(row('2.0', NOW - HQ_LEDGER_CARD_HOLD_MS), null, NOW)).toBe(true)
  })
})
