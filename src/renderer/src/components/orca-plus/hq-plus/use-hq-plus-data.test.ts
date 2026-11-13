import { describe, expect, it } from 'vitest'
import { hqPlusSameAs } from './use-hq-plus-data'

describe('hqPlusSameAs (13.11)', () => {
  it('tells a repeated answer from a new one, ignoring the field that changes on every call', () => {
    const last = { current: new Map<string, string>() }
    expect(hqPlusSameAs(last, 'feed', { rows: [1], now: 1 }, 'now')).toBe(false)
    expect(hqPlusSameAs(last, 'feed', { rows: [1], now: 2 }, 'now')).toBe(true)
    expect(hqPlusSameAs(last, 'feed', { rows: [1, 2], now: 3 }, 'now')).toBe(false)
    expect(hqPlusSameAs(last, 'waits', { rows: [1, 2] })).toBe(false)
  })
})
