import { describe, expect, it } from 'vitest'
import { hqPlusStamp, slackTsAt } from './hq-plus-stamp'

describe('hq plus stamp', () => {
  const now = new Date(2026, 10, 4, 15, 0).getTime()
  it('shows the time alone today and the date on an earlier day', () => {
    expect(hqPlusStamp(new Date(2026, 10, 4, 14, 2).getTime(), now)).toBe('14:02')
    expect(hqPlusStamp(new Date(2026, 10, 3, 9, 5).getTime(), now)).toBe('3 Nov 09:05')
    expect(hqPlusStamp(new Date(2025, 11, 31, 23, 59).getTime(), now)).toBe('31 Dec 2025 23:59')
  })
  it('reads a Slack ts as its send time', () => {
    expect(slackTsAt('1793717177.237889')).toBe(1793717177238)
    expect(slackTsAt('req:abc')).toBeNull()
    expect(slackTsAt(null)).toBeNull()
  })
})
