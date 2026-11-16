import { describe, expect, it } from 'vitest'
import {
  claudeBackgroundPause,
  claudeBackgroundPauseFromReading,
  describeClaudeBackgroundPause
} from './claude-background-pause'
import type { ProviderRateLimits } from './agent-usage/rate-limits/rate-limit-types'

const NOW = 1_790_590_000_000
const HOUR = 60 * 60_000
const RESET = NOW + 30 * HOUR

function reading(
  weekly: number | null,
  options: { resetsAt?: number | null; updatedAt?: number; provenance?: string } = {}
): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent: 10, windowMinutes: 300, resetsAt: NOW + HOUR, resetDescription: null },
    weekly:
      weekly === null
        ? null
        : {
            usedPercent: weekly,
            windowMinutes: 10080,
            resetsAt: options.resetsAt === undefined ? RESET : options.resetsAt,
            resetDescription: null
          },
    updatedAt: options.updatedAt ?? NOW,
    error: null,
    status: 'ok',
    ...(options.provenance ? { usageMetadata: { authProvenance: options.provenance } } : {})
  }
}

describe('claudeBackgroundPauseFromReading', () => {
  it('lets background work run under 95% of the week', () => {
    expect(claudeBackgroundPauseFromReading(reading(94.9), NOW)).toBeNull()
    expect(claudeBackgroundPauseFromReading(reading(10), NOW)).toBeNull()
  })

  it('pauses at 95% until the weekly reset', () => {
    expect(claudeBackgroundPauseFromReading(reading(95), NOW)).toEqual({
      weeklyPercent: 95,
      resumesAt: RESET
    })
    expect(claudeBackgroundPauseFromReading(reading(99.6), NOW)?.weeklyPercent).toBe(100)
  })

  it('lets work run again once the reset time passed, with no new reading', () => {
    expect(claudeBackgroundPauseFromReading(reading(99), RESET)).toBeNull()
    expect(claudeBackgroundPauseFromReading(reading(99), RESET + 1)).toBeNull()
  })

  it('trusts a reading without a reset time only while it is recent', () => {
    expect(claudeBackgroundPauseFromReading(reading(97, { resetsAt: null }), NOW)).toEqual({
      weeklyPercent: 97,
      resumesAt: null
    })
    expect(
      claudeBackgroundPauseFromReading(reading(97, { resetsAt: null }), NOW + 7 * HOUR)
    ).toBeNull()
  })

  it('never pauses on a missing reading or window', () => {
    expect(claudeBackgroundPauseFromReading(null, NOW)).toBeNull()
    expect(claudeBackgroundPauseFromReading(reading(null), NOW)).toBeNull()
  })
})

describe('claudeBackgroundPause', () => {
  it('reads the selected account, not another account the main reading came from', () => {
    const inactive = [
      { accountId: 'b', rateLimits: reading(40), updatedAt: NOW, isFetching: false }
    ]
    expect(
      claudeBackgroundPause({
        reading: reading(98, { provenance: 'managed:a' }),
        inactive,
        activeAccountId: 'b',
        now: NOW
      })
    ).toBeNull()
    expect(
      claudeBackgroundPause({
        reading: reading(30, { provenance: 'managed:a' }),
        inactive: [{ ...inactive[0], rateLimits: reading(96) }],
        activeAccountId: 'b',
        now: NOW
      })
    ).toEqual({ weeklyPercent: 96, resumesAt: RESET, accountId: 'b' })
  })

  it('takes a reading that names no account as the selected one', () => {
    expect(
      claudeBackgroundPause({ reading: reading(96), inactive: [], activeAccountId: 'a', now: NOW })
    ).toEqual({ weeklyPercent: 96, resumesAt: RESET, accountId: 'a' })
  })

  it('describes the pause in the words the logs use', () => {
    expect(
      describeClaudeBackgroundPause({ weeklyPercent: 96, resumesAt: RESET, accountId: null })
    ).toBe(`paused 95% (weekly 96%, until ${new Date(RESET).toISOString()})`)
  })
})
