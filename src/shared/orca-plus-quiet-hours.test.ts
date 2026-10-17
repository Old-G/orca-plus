import { describe, expect, it } from 'vitest'
import { isOrcaPlusQuietHour, orcaPlusQuietHours } from './orca-plus-quiet-hours'

const at = (hour: number): Date => new Date(2026, 9, 17, hour, 30)

describe('Orca+ quiet hours', () => {
  it('wraps a span past midnight and ends before its end hour', () => {
    const hours = { start: 21, end: 9 }
    expect([20, 21, 23, 0, 8, 9].map((hour) => isOrcaPlusQuietHour(hours, at(hour)))).toEqual([
      false,
      true,
      true,
      true,
      true,
      false
    ])
  })

  it('reads an unset setting and null as off', () => {
    expect(orcaPlusQuietHours({})).toBeNull()
    expect(isOrcaPlusQuietHour(orcaPlusQuietHours({ orcaPlusQuietHours: null }), at(23))).toBe(
      false
    )
    expect(isOrcaPlusQuietHour({ start: 13, end: 14 }, at(13))).toBe(true)
  })
})
