// Custom build (claude-background-pause): one answer to «may background work start now». Once the
// selected Claude account has used 95% of its weekly window, scheduled automations, HQ's background
// model calls and the launchd jobs hold off until the window resets — then they start again by
// themselves, because the pause lasts only while the reading's reset time is still ahead.
import type {
  InactiveAccountUsage,
  ProviderRateLimits
} from './agent-usage/rate-limits/rate-limit-types'
import { claudeLimitsAccountId } from './claude-limit-guard'

export const CLAUDE_BACKGROUND_PAUSE_PERCENT = 95

// Why: a reading with no reset time can only hold the pause while it is recent; an old one could
// otherwise keep background work off forever.
const NO_RESET_READING_MAX_AGE_MS = 6 * 60 * 60_000

export type ClaudeBackgroundPause = {
  weeklyPercent: number
  /** When the weekly window resets and background work starts again; null when the reading has none. */
  resumesAt: number | null
  accountId: string | null
}

/** The pause one reading calls for, or null when background work may run. */
export function claudeBackgroundPauseFromReading(
  reading: ProviderRateLimits | null | undefined,
  now: number
): Omit<ClaudeBackgroundPause, 'accountId'> | null {
  const weekly = reading?.weekly
  if (!reading || !weekly || weekly.usedPercent < CLAUDE_BACKGROUND_PAUSE_PERCENT) {
    return null
  }
  if (weekly.resetsAt !== null) {
    return weekly.resetsAt > now
      ? { weeklyPercent: Math.round(weekly.usedPercent), resumesAt: weekly.resetsAt }
      : null
  }
  return now - reading.updatedAt <= NO_RESET_READING_MAX_AGE_MS
    ? { weeklyPercent: Math.round(weekly.usedPercent), resumesAt: null }
    : null
}

/**
 * The selected account's pause. Background jobs run on the account Orca+ selected, so the reading
 * must be that account's: the main reading when it names it (or names no account), else that
 * account's inactive-account reading. No reading of it → no pause: an unknown limit never stops work.
 */
export function claudeBackgroundPause(input: {
  reading: ProviderRateLimits | null | undefined
  inactive: readonly InactiveAccountUsage[] | undefined
  activeAccountId: string | null
  now: number
}): ClaudeBackgroundPause | null {
  const readingAccount = input.reading ? claudeLimitsAccountId(input.reading) : undefined
  const own =
    input.reading && (readingAccount === undefined || readingAccount === input.activeAccountId)
      ? input.reading
      : input.activeAccountId === null
        ? null
        : (input.inactive?.find((entry) => entry.accountId === input.activeAccountId)?.rateLimits ??
          null)
  const pause = claudeBackgroundPauseFromReading(own, input.now)
  return pause ? { ...pause, accountId: input.activeAccountId } : null
}

/** «paused 95%» line the gate logs; launchd scripts write the same words. */
export function describeClaudeBackgroundPause(pause: ClaudeBackgroundPause): string {
  const until = pause.resumesAt === null ? 'unknown' : new Date(pause.resumesAt).toISOString()
  return `paused ${CLAUDE_BACKGROUND_PAUSE_PERCENT}% (weekly ${pause.weeklyPercent}%, until ${until})`
}
