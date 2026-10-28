import { describe, expect, it } from 'vitest'
import { hqPlusTickerMark } from './hq-plus-ticker-mark'
import type { HqPlusLogItem } from '../../../../../shared/hq-plus-log'

const where = { room: 'acme', project: 'acme-api', address: null, sessionId: null }

describe('hqPlusTickerMark', () => {
  it('marks what asks the owner apart from what only happened', () => {
    const card = (open: boolean): HqPlusLogItem => ({
      ...where,
      kind: 'card',
      id: 'c',
      at: 1,
      type: 'approve',
      title: 'Approve',
      body: null,
      report: null,
      open,
      done: null,
      entry: null,
      inbox: null
    })
    expect(hqPlusTickerMark(card(true))).toBe('✋')
    expect(hqPlusTickerMark(card(false))).toBe('✅')
    expect(
      hqPlusTickerMark({
        ...where,
        kind: 'line',
        id: 'l',
        at: 1,
        tone: 'agent',
        title: 'Done',
        journalKind: 'chat.report'
      })
    ).toBe('🤖')
    expect(
      hqPlusTickerMark({
        ...where,
        kind: 'line',
        id: 'p',
        at: 1,
        tone: 'person',
        title: 'Ann answered'
      })
    ).toBe('🗣️')
    expect(
      hqPlusTickerMark({
        ...where,
        kind: 'line',
        id: 'x',
        at: 1,
        tone: 'system',
        title: 'x',
        journalKind: 'odd'
      })
    ).toBe('🔹')
  })
})
