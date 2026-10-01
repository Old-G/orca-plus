// Custom build (claude-limit-guard): pace forecast and switch suggestion for two Claude subscriptions.
import type { InactiveAccountUsage, ProviderRateLimits, RateLimitWindow } from './rate-limit-types'

export const CLAUDE_LIMIT_SWITCH_THRESHOLD_PERCENT = 90

export type ClaudeUsageSample = {
  at: number
  sessionPercent: number | null
  sessionResetsAt: number | null
  weeklyPercent: number | null
  weeklyResetsAt: number | null
}

export type ClaudeLimitWindowKind = 'session' | 'weekly'

export type ClaudeUsageForecast = {
  window: ClaudeLimitWindowKind
  exhaustsAt: number
}

export type ClaudeLimitSwitchSuggestion = {
  fromAccountId: string | null
  toAccountId: string
  window: ClaudeLimitWindowKind
  usedPercent: number
  resetsAt: number | null
  /** Null when the target's usage could not be read. */
  targetFreePercent: number | null
}

const PACE_LOOKBACK_MS: Record<ClaudeLimitWindowKind, number> = {
  session: 30 * 60_000,
  weekly: 6 * 60 * 60_000
}
const MIN_PACE_SPAN_MS = 5 * 60_000
// Why: resetsAt drifts by milliseconds between polls; a new window moves it by minutes or more.
const SAME_WINDOW_TOLERANCE_MS = 2 * 60_000
const INACTIVE_USAGE_MAX_AGE_MS = 15 * 60_000

function sampleWindow(
  sample: ClaudeUsageSample,
  window: ClaudeLimitWindowKind
): { percent: number | null; resetsAt: number | null } {
  return window === 'session'
    ? { percent: sample.sessionPercent, resetsAt: sample.sessionResetsAt }
    : { percent: sample.weeklyPercent, resetsAt: sample.weeklyResetsAt }
}

function isSameWindow(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && Math.abs(a - b) <= SAME_WINDOW_TOLERANCE_MS
}

export function toClaudeUsageSample(limits: ProviderRateLimits, at: number): ClaudeUsageSample {
  return {
    at,
    sessionPercent: limits.session?.usedPercent ?? null,
    sessionResetsAt: limits.session?.resetsAt ?? null,
    weeklyPercent: limits.weekly?.usedPercent ?? null,
    weeklyResetsAt: limits.weekly?.resetsAt ?? null
  }
}

/** When the window runs out at the pace seen since the lookback start; null if it outlasts its reset. */
export function forecastClaudeWindowExhaustion(
  samples: readonly ClaudeUsageSample[],
  window: ClaudeLimitWindowKind,
  now: number
): number | null {
  const latest = samples.at(-1)
  if (!latest) {
    return null
  }
  const current = sampleWindow(latest, window)
  if (current.percent === null || current.percent >= 100) {
    return null
  }
  const earliest = samples.find((sample) => {
    const candidate = sampleWindow(sample, window)
    return (
      sample.at >= now - PACE_LOOKBACK_MS[window] &&
      candidate.percent !== null &&
      isSameWindow(candidate.resetsAt, current.resetsAt)
    )
  })
  if (!earliest || latest.at - earliest.at < MIN_PACE_SPAN_MS) {
    return null
  }
  const startPercent = sampleWindow(earliest, window).percent ?? current.percent
  const perMs = (current.percent - startPercent) / (latest.at - earliest.at)
  if (perMs <= 0) {
    return null
  }
  const exhaustsAt = latest.at + (100 - current.percent) / perMs
  if (current.resetsAt !== null && exhaustsAt >= current.resetsAt) {
    return null
  }
  return Math.round(exhaustsAt)
}

export function forecastClaudeUsage(
  samples: readonly ClaudeUsageSample[],
  now: number
): ClaudeUsageForecast | null {
  const forecasts = (['session', 'weekly'] as const)
    .map((window) => ({ window, exhaustsAt: forecastClaudeWindowExhaustion(samples, window, now) }))
    .filter((entry): entry is ClaudeUsageForecast => entry.exhaustsAt !== null)
  forecasts.sort((a, b) => a.exhaustsAt - b.exhaustsAt)
  return forecasts[0] ?? null
}

/** Appends a sample, dropping ones older than the longest lookback. */
export function appendClaudeUsageSample(
  samples: readonly ClaudeUsageSample[],
  sample: ClaudeUsageSample
): ClaudeUsageSample[] {
  const cutoff = sample.at - PACE_LOOKBACK_MS.weekly
  const kept = samples.filter((entry) => entry.at >= cutoff && entry.at < sample.at)
  return [...kept, sample]
}

function mostUsedWindow(
  limits: ProviderRateLimits
): { window: ClaudeLimitWindowKind; data: RateLimitWindow } | null {
  const windows = [
    limits.session ? { window: 'session' as const, data: limits.session } : null,
    limits.weekly ? { window: 'weekly' as const, data: limits.weekly } : null
  ].filter((entry) => entry !== null)
  windows.sort((a, b) => b.data.usedPercent - a.data.usedPercent)
  return windows[0] ?? null
}

function freePercent(limits: ProviderRateLimits): number | null {
  const worst = mostUsedWindow(limits)
  return worst ? Math.max(0, 100 - worst.data.usedPercent) : null
}

/**
 * Suggests the inactive account with the most room once the active one crosses the threshold
 * (or already stopped agents). Returns null when no other account has room either.
 * Custom build (claude-limit-guard): once an agent has actually stopped, an account whose usage
 * could not be read is still offered (free = null) — only one known to be spent is held back.
 */
export function suggestClaudeAccountSwitch(input: {
  activeAccountId: string | null
  /** Null when no reading of the active account exists yet. */
  active: ProviderRateLimits | null
  inactive: readonly InactiveAccountUsage[]
  now: number
  limitStopObserved?: boolean
}): ClaudeLimitSwitchSuggestion | null {
  const worst = input.active ? mostUsedWindow(input.active) : null
  if (!worst && !input.limitStopObserved) {
    return null
  }
  const overThreshold = (worst?.data.usedPercent ?? 0) >= CLAUDE_LIMIT_SWITCH_THRESHOLD_PERCENT
  if (!overThreshold && !input.limitStopObserved) {
    return null
  }
  const activeUsed = input.limitStopObserved ? 100 : (worst?.data.usedPercent ?? 0)
  const others = input.inactive.filter((entry) => entry.accountId !== input.activeAccountId)
  const read = (entry: InactiveAccountUsage): number | null =>
    entry.rateLimits?.status === 'ok' && input.now - entry.updatedAt <= INACTIVE_USAGE_MAX_AGE_MS
      ? freePercent(entry.rateLimits)
      : null
  const known = others
    .map((entry) => ({ accountId: entry.accountId, free: read(entry) }))
    .filter(
      (entry): entry is { accountId: string; free: number } =>
        entry.free !== null && 100 - entry.free < CLAUDE_LIMIT_SWITCH_THRESHOLD_PERCENT
    )
    .filter((entry) => entry.free > 100 - activeUsed)
  known.sort((a, b) => b.free - a.free)
  const unknown = input.limitStopObserved ? others.find((entry) => read(entry) === null) : undefined
  const best = known[0] ?? (unknown ? { accountId: unknown.accountId, free: null } : null)
  if (!best) {
    return null
  }
  return {
    fromAccountId: input.activeAccountId,
    toAccountId: best.accountId,
    window: worst?.window ?? 'session',
    usedPercent: Math.round(activeUsed),
    resetsAt: worst?.data.resetsAt ?? null,
    targetFreePercent: best.free === null ? null : Math.round(best.free)
  }
}

/** One card per account and window instance; a dismissed card stays dismissed until the window resets. */
export function claudeLimitSwitchSuggestionKey(suggestion: ClaudeLimitSwitchSuggestion): string {
  const resetBucket =
    suggestion.resetsAt === null ? 'none' : Math.round(suggestion.resetsAt / 600_000)
  return `${suggestion.fromAccountId ?? 'system'}:${suggestion.window}:${resetBucket}`
}

/** `auth`: the API rejected the sign-in ("Please run /login · 403"), not a limit. */
export type ClaudeLimitStopReason = 'limit' | 'auth'

/** A Claude turn that ended on a usage limit or a rejected sign-in, awaiting a nudge. */
export type ClaudeLimitStoppedAgent = {
  kind: 'terminal' | 'native-chat'
  /** Absent on stops recorded before reasons existed: a limit. */
  reason?: ClaudeLimitStopReason
  /** Hook pane key for terminals; structured session id for native chats. */
  key: string
  worktreeId: string | null
  accountId: string | null
  stoppedAt: number
  resetsAt: number | null
  /** Claude session id, when known; for native chats it is the key. */
  sessionId?: string | null
  /** Custom build (claude-subscriptions): the subscription a native chat ran on; null = the base sign-in. */
  subscriptionId?: string | null
}

/** Managed-account switching rewrites only the base `~/.claude` sign-in, so it helps only stops made there. */
export function claudeLimitStopOnBaseSignIn(stop: ClaudeLimitStoppedAgent): boolean {
  return !stop.subscriptionId || stop.subscriptionId === 'base'
}

export function claudeLimitStopIsAuth(stop: ClaudeLimitStoppedAgent): boolean {
  return stop.reason === 'auth'
}

export const CLAUDE_LIMIT_CONTINUE_PROMPT = 'продолжай'

// Why: a guard against flip-flopping between two accounts that both run dry.
export const CLAUDE_LIMIT_AUTO_SWITCH_COOLDOWN_MS = 10 * 60_000

/**
 * Custom build (claude-limit-guard): agents already stopped on the active account's limit and
 * another account is read as having room — switch without asking. An unread target stays a card:
 * switching blind could land the agents on a spent account.
 */
export function shouldAutoSwitchClaudeAccount(input: {
  suggestion: ClaudeLimitSwitchSuggestion | null
  stoppedOnLimit: number
  lastAutoSwitchAt: number | null
  now: number
}): boolean {
  return (
    input.suggestion !== null &&
    input.stoppedOnLimit > 0 &&
    input.suggestion.targetFreePercent !== null &&
    input.suggestion.targetFreePercent > 0 &&
    (input.lastAutoSwitchAt === null ||
      input.now - input.lastAutoSwitchAt >= CLAUDE_LIMIT_AUTO_SWITCH_COOLDOWN_MS)
  )
}

/** The account a usage reading came from: an id, null for the system default, undefined if unknown. */
export function claudeLimitsAccountId(limits: ProviderRateLimits): string | null | undefined {
  const provenance = limits.usageMetadata?.authProvenance
  if (!provenance) {
    return undefined
  }
  return provenance.startsWith('managed:') ? provenance.slice('managed:'.length) : null
}

type ClaudeAccountIdentity = { id: string; email: string; organizationName?: string | null }

/** The email, plus the organization when another account shares that email. */
export function describeClaudeAccount(
  accounts: readonly ClaudeAccountIdentity[],
  account: ClaudeAccountIdentity
): string {
  const sharesEmail = accounts.some(
    (other) => other.id !== account.id && other.email === account.email
  )
  return sharesEmail && account.organizationName
    ? `${account.email} · ${account.organizationName}`
    : account.email
}
