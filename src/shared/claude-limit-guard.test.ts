import { describe, expect, it } from 'vitest'
import {
  appendClaudeUsageSample,
  claudeLimitsAccountId,
  claudeLimitSwitchSuggestionKey,
  describeClaudeAccount,
  forecastClaudeUsage,
  forecastClaudeWindowExhaustion,
  shouldAutoSwitchClaudeAccount,
  suggestClaudeAccountSwitch,
  CLAUDE_LIMIT_AUTO_SWITCH_COOLDOWN_MS,
  type ClaudeLimitSwitchSuggestion,
  type ClaudeUsageSample
} from './claude-limit-guard'
import type { InactiveAccountUsage, ProviderRateLimits } from './rate-limit-types'

const MIN = 60_000
const NOW = 1_790_590_000_000
const RESET = NOW + 90 * MIN

function sample(minutesAgo: number, sessionPercent: number, resetsAt = RESET): ClaudeUsageSample {
  return {
    at: NOW - minutesAgo * MIN,
    sessionPercent,
    sessionResetsAt: resetsAt,
    weeklyPercent: 50,
    weeklyResetsAt: NOW + 3 * 24 * 60 * MIN
  }
}

function limits(
  session: number,
  weekly: number,
  status: 'ok' | 'error' = 'ok'
): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent: session, windowMinutes: 300, resetsAt: RESET, resetDescription: null },
    weekly: {
      usedPercent: weekly,
      windowMinutes: 10080,
      resetsAt: NOW + 3 * 24 * 60 * MIN,
      resetDescription: null
    },
    updatedAt: NOW,
    error: null,
    status
  }
}

function inactive(accountId: string, rateLimits: ProviderRateLimits | null): InactiveAccountUsage {
  return { accountId, rateLimits, updatedAt: NOW - MIN, isFetching: false }
}

describe('forecastClaudeWindowExhaustion', () => {
  it('extrapolates the recent pace to 100%', () => {
    // 60% → 80% in 20 minutes = 1%/min → 20 more minutes.
    const samples = [sample(20, 60), sample(10, 70), sample(0, 80)]
    expect(forecastClaudeWindowExhaustion(samples, 'session', NOW)).toBe(NOW + 20 * MIN)
  })

  it('returns null when the window resets before it would run out', () => {
    const samples = [sample(20, 10), sample(0, 12)]
    expect(forecastClaudeWindowExhaustion(samples, 'session', NOW)).toBeNull()
  })

  it('ignores samples from the previous window', () => {
    const samples = [sample(25, 95, RESET - 5 * 60 * MIN), sample(20, 60), sample(0, 80)]
    expect(forecastClaudeWindowExhaustion(samples, 'session', NOW)).toBe(NOW + 20 * MIN)
  })

  it('needs at least five minutes of history and rising usage', () => {
    expect(
      forecastClaudeWindowExhaustion([sample(2, 60), sample(0, 80)], 'session', NOW)
    ).toBeNull()
    expect(
      forecastClaudeWindowExhaustion([sample(20, 80), sample(0, 80)], 'session', NOW)
    ).toBeNull()
  })

  it('picks the window that runs out first', () => {
    const samples = [sample(20, 60), sample(0, 80)]
    expect(forecastClaudeUsage(samples, NOW)).toEqual({
      window: 'session',
      exhaustsAt: NOW + 20 * MIN
    })
  })
})

describe('appendClaudeUsageSample', () => {
  it('drops samples beyond the longest lookback', () => {
    const old = { ...sample(0, 1), at: NOW - 7 * 60 * MIN }
    expect(appendClaudeUsageSample([old, sample(5, 2)], sample(0, 3))).toEqual([
      sample(5, 2),
      sample(0, 3)
    ])
  })
})

describe('suggestClaudeAccountSwitch', () => {
  it('stays quiet below the threshold', () => {
    expect(
      suggestClaudeAccountSwitch({
        activeAccountId: 'a',
        active: limits(89, 40),
        inactive: [inactive('b', limits(10, 10))],
        now: NOW
      })
    ).toBeNull()
  })

  it('suggests the inactive account with the most room at 90%', () => {
    expect(
      suggestClaudeAccountSwitch({
        activeAccountId: 'a',
        active: limits(92, 40),
        inactive: [inactive('b', limits(30, 60)), inactive('c', limits(5, 20))],
        now: NOW
      })
    ).toEqual({
      fromAccountId: 'a',
      toAccountId: 'c',
      window: 'session',
      usedPercent: 92,
      resetsAt: RESET,
      targetFreePercent: 80
    })
  })

  it('counts the weekly window too', () => {
    const suggestion = suggestClaudeAccountSwitch({
      activeAccountId: 'a',
      active: limits(20, 95),
      inactive: [inactive('b', limits(10, 10))],
      now: NOW
    })
    expect(suggestion?.window).toBe('weekly')
  })

  it('skips accounts that are nearly spent, stale, or failed', () => {
    expect(
      suggestClaudeAccountSwitch({
        activeAccountId: 'a',
        active: limits(95, 40),
        inactive: [
          inactive('b', limits(91, 10)),
          { ...inactive('c', limits(1, 1)), updatedAt: NOW - 60 * MIN },
          inactive('d', limits(1, 1, 'error')),
          inactive('e', null)
        ],
        now: NOW
      })
    ).toBeNull()
  })

  it('suggests after an observed limit stop even when the reading lags', () => {
    const suggestion = suggestClaudeAccountSwitch({
      activeAccountId: 'a',
      active: limits(80, 40),
      inactive: [inactive('b', limits(10, 10))],
      now: NOW,
      limitStopObserved: true
    })
    expect(suggestion?.usedPercent).toBe(100)
    expect(suggestion?.toAccountId).toBe('b')
  })

  it('keys cards by account and window instance', () => {
    const base = {
      fromAccountId: 'a',
      toAccountId: 'b',
      window: 'session' as const,
      usedPercent: 91,
      resetsAt: RESET,
      targetFreePercent: 80
    }
    expect(claudeLimitSwitchSuggestionKey(base)).toBe(
      claudeLimitSwitchSuggestionKey({ ...base, resetsAt: RESET + 1000, usedPercent: 95 })
    )
    expect(claudeLimitSwitchSuggestionKey(base)).not.toBe(
      claudeLimitSwitchSuggestionKey({ ...base, resetsAt: RESET + 5 * 60 * MIN })
    )
  })
})

describe('claude account identity', () => {
  it('names the account a reading came from', () => {
    const reading = limits(10, 10)
    expect(claudeLimitsAccountId(reading)).toBeUndefined()
    expect(
      claudeLimitsAccountId({ ...reading, usageMetadata: { authProvenance: 'managed:abc' } })
    ).toBe('abc')
    expect(claudeLimitsAccountId({ ...reading, usageMetadata: { authProvenance: 'system' } })).toBe(
      null
    )
  })

  it('adds the organization only when two accounts share an email', () => {
    const a = { id: 'a', email: 'me@example.com', organizationName: 'Work' }
    const b = { id: 'b', email: 'me@example.com', organizationName: 'Personal' }
    const c = { id: 'c', email: 'other@example.com', organizationName: 'Solo' }
    expect(describeClaudeAccount([a, b, c], a)).toBe('me@example.com · Work')
    expect(describeClaudeAccount([a, b, c], c)).toBe('other@example.com')
  })
})

describe('suggestClaudeAccountSwitch after a real stop', () => {
  it('offers an account whose usage could not be read, saying so', () => {
    expect(
      suggestClaudeAccountSwitch({
        activeAccountId: 'personal',
        active: limits(100, 60),
        inactive: [inactive('work', limits(0, 0, 'error'))],
        now: NOW,
        limitStopObserved: true
      })
    ).toMatchObject({ toAccountId: 'work', targetFreePercent: null, usedPercent: 100 })
  })

  it('works without any reading of the active account', () => {
    expect(
      suggestClaudeAccountSwitch({
        activeAccountId: 'personal',
        active: null,
        inactive: [inactive('work', null)],
        now: NOW,
        limitStopObserved: true
      })
    ).toMatchObject({
      toAccountId: 'work',
      window: 'session',
      resetsAt: null,
      targetFreePercent: null
    })
  })

  it('prefers an account known to have room, and never offers one known to be spent', () => {
    const spent = inactive('spent', limits(97, 40))
    expect(
      suggestClaudeAccountSwitch({
        activeAccountId: 'personal',
        active: limits(100, 60),
        inactive: [inactive('unread', null), spent, inactive('roomy', limits(20, 30))],
        now: NOW,
        limitStopObserved: true
      })?.toAccountId
    ).toBe('roomy')
    expect(
      suggestClaudeAccountSwitch({
        activeAccountId: 'personal',
        active: limits(100, 60),
        inactive: [spent],
        now: NOW,
        limitStopObserved: true
      })
    ).toBeNull()
  })

  it('still needs a real stop before offering an unread account', () => {
    expect(
      suggestClaudeAccountSwitch({
        activeAccountId: 'personal',
        active: limits(95, 60),
        inactive: [inactive('work', null)],
        now: NOW
      })
    ).toBeNull()
  })
})

describe('shouldAutoSwitchClaudeAccount', () => {
  const suggestion: ClaudeLimitSwitchSuggestion = {
    fromAccountId: 'personal',
    toAccountId: 'lh',
    window: 'session',
    usedPercent: 100,
    resetsAt: null,
    targetFreePercent: 70
  }
  const base = { suggestion, stoppedOnLimit: 2, lastAutoSwitchAt: null, now: NOW }

  it('switches once agents stopped and the other account is read as having room', () => {
    expect(shouldAutoSwitchClaudeAccount(base)).toBe(true)
  })

  it('only warns (card) while nothing has stopped yet', () => {
    expect(shouldAutoSwitchClaudeAccount({ ...base, stoppedOnLimit: 0 })).toBe(false)
  })

  it('leaves an unread or spent target to the owner', () => {
    expect(
      shouldAutoSwitchClaudeAccount({
        ...base,
        suggestion: { ...suggestion, targetFreePercent: null }
      })
    ).toBe(false)
    expect(
      shouldAutoSwitchClaudeAccount({
        ...base,
        suggestion: { ...suggestion, targetFreePercent: 0 }
      })
    ).toBe(false)
    expect(shouldAutoSwitchClaudeAccount({ ...base, suggestion: null })).toBe(false)
  })

  it('does not flip back within the cooldown', () => {
    const lastAutoSwitchAt = NOW - CLAUDE_LIMIT_AUTO_SWITCH_COOLDOWN_MS + MIN
    expect(shouldAutoSwitchClaudeAccount({ ...base, lastAutoSwitchAt })).toBe(false)
    expect(
      shouldAutoSwitchClaudeAccount({
        ...base,
        lastAutoSwitchAt: NOW - CLAUDE_LIMIT_AUTO_SWITCH_COOLDOWN_MS
      })
    ).toBe(true)
  })
})
