// Custom build (claude-background-pause): the gate set up on the host that runs the schedules — the
// desktop app and a headless orcad alike — so `claudeBackgroundAdmits` asks a real reading there and
// never lets every job through for want of a gate.
import { join } from 'node:path'
import type { Store } from '../persistence/loading-store/store'
import type { RateLimitService } from '../rate-limits/service/rate-limit-service'
import type { ClaudeBackgroundPause } from '../../shared/claude-background-pause'
import { normalizeClaudeRuntimeSelection } from '../claude-accounts/selection/runtime-selection'
import {
  CLAUDE_BACKGROUND_REFRESH_MS,
  createClaudeBackgroundGate,
  provideClaudeBackgroundGate,
  type ClaudeBackgroundGate
} from './claude-background-gate'

export const CLAUDE_BACKGROUND_PAUSE_FILE = 'claude-background-pause.json'

type GateRateLimits = Pick<
  RateLimitService,
  'usageReading' | 'inactiveClaudeAccountsNow' | 'requestUsageReading' | 'onStateChange'
>

export type InstalledClaudeBackgroundGate = {
  gate: ClaudeBackgroundGate
  stop: () => void
}

export function installClaudeBackgroundGate(deps: {
  store: Pick<Store, 'getSettings'>
  rateLimits: GateRateLimits
  userDataPath: string
  isPackaged: boolean
  /** Desktop extras on a change: the banner, the launchd catch-up. */
  onPauseChanged?: (pause: ClaudeBackgroundPause | null) => void
  /** Desktop extras on every refresh tick. */
  onRefresh?: () => void
}): InstalledClaudeBackgroundGate {
  const { store, rateLimits, userDataPath } = deps
  // Why: the state file lifts at the reset itself, not at the next refresh.
  let atReset: ReturnType<typeof setTimeout> | null = null
  const onChanged = (pause: ClaudeBackgroundPause | null): void => {
    if (atReset) {
      clearTimeout(atReset)
      atReset = null
    }
    if (pause?.resumesAt != null) {
      const wait = Math.min(Math.max(pause.resumesAt - Date.now() + 1_000, 1_000), 2_147_000_000)
      atReset = setTimeout(() => gate.evaluate(), wait)
      atReset.unref?.()
    }
    deps.onPauseChanged?.(pause)
  }
  const gate = createClaudeBackgroundGate({
    reading: () => rateLimits.usageReading('claude'),
    inactive: () => rateLimits.inactiveClaudeAccountsNow() ?? [],
    activeAccountId: () => normalizeClaudeRuntimeSelection(store.getSettings()).host,
    requestReading: (notWithinMs) => rateLimits.requestUsageReading('claude', { notWithinMs }),
    onReadingChange: (listener) => rateLimits.onStateChange(listener),
    now: Date.now,
    statePath: join(userDataPath, CLAUDE_BACKGROUND_PAUSE_FILE),
    logPath: join(userDataPath, 'claude-background-pause.log'),
    // Why: a live check in a development build stands a file in for the weekly window.
    ...(deps.isPackaged
      ? {}
      : { testReadingPath: join(userDataPath, 'claude-background-pause-test.json') }),
    onChanged
  })
  provideClaudeBackgroundGate(gate)
  // A new reading may start or end the pause: the state file follows it at once.
  const unsubscribe = rateLimits.onStateChange(() => gate.evaluate())
  const refresh = (): void => {
    gate.refresh()
    deps.onRefresh?.()
  }
  const first = setTimeout(refresh, 60_000)
  first.unref?.()
  const every = setInterval(refresh, CLAUDE_BACKGROUND_REFRESH_MS)
  every.unref?.()
  return {
    gate,
    stop: () => {
      unsubscribe()
      clearTimeout(first)
      clearInterval(every)
      if (atReset) {
        clearTimeout(atReset)
      }
      provideClaudeBackgroundGate(null)
    }
  }
}
