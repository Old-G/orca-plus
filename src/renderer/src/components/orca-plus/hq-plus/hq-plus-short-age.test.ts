import { describe, expect, it } from 'vitest'
import { hqPlusShortAge } from './hq-plus-short-age'

describe('hqPlusShortAge', () => {
  const now = Date.UTC(2026, 10, 26, 12)
  it('fits the board Age column', () => {
    expect(hqPlusShortAge(now - 20_000, now)).toBe('now')
    expect(hqPlusShortAge(now - 5 * 60_000, now)).toBe('5m')
    expect(hqPlusShortAge(now - 3 * 3_600_000 - 1, now)).toBe('3h')
    expect(hqPlusShortAge(now - 2 * 86_400_000, now)).toBe('2d')
    expect(hqPlusShortAge(now - 15 * 86_400_000, now)).toBe('2w')
  })
  it('treats a future time as now', () => {
    expect(hqPlusShortAge(now + 60_000, now)).toBe('now')
  })
})
