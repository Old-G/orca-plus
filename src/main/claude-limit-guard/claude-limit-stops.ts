// Custom build (claude-limit-guard): Claude agents whose turn ended on a usage limit, and the one
// nudge (Esc + a continue prompt) each gets once another account is active or the limit lifted.
import {
  CLAUDE_LIMIT_SWITCH_THRESHOLD_PERCENT,
  type ClaudeLimitStoppedAgent
} from '../../shared/claude-limit-guard'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'

export type ClaudeLimitHookEvent = {
  paneKey: string
  source?: string
  worktreeId?: string
  hookEventName?: string
  stopFailureError?: string
  toolAgentId?: string
  isReplay?: boolean
  providerSession?: { key: string; id: string }
}

export type ClaudeLimitNativeFrame = Record<string, unknown>

export type ClaudeLimitStopsDeps = {
  now: () => number
  activeAccountId: () => string | null
  resumeTerminal: (paneKey: string) => Promise<boolean>
  resumeNativeChat: (sessionId: string) => Promise<boolean>
  onChanged: (stops: ClaudeLimitStoppedAgent[]) => void
  /** True when the stopped turn had written a handoff: that session moves on, it is not continued. */
  checkHandoff?: (stop: ClaudeLimitStoppedAgent) => Promise<boolean>
  log?: (message: string) => void
}

// Why: a stop whose limit is not really lifted (org spend cap, stale reading) would stop again;
// one retry per window keeps that from turning into a loop.
const RELIEF_RETRY_COOLDOWN_MS = 15 * 60_000
const MIN_STOP_AGE_FOR_RELIEF_MS = 60_000

function stopId(kind: ClaudeLimitStoppedAgent['kind'], key: string): string {
  return `${kind}:${key}`
}

function isMainAgentFrame(frame: ClaudeLimitNativeFrame): boolean {
  return frame.parent_tool_use_id === null || frame.parent_tool_use_id === undefined
}

/** A stream-json frame that ends the main agent's turn on a usage limit. */
export function isClaudeLimitStopFrame(frame: ClaudeLimitNativeFrame): boolean {
  if (!isMainAgentFrame(frame)) {
    return false
  }
  if (frame.type === 'assistant') {
    return frame.error === 'rate_limit'
  }
  return frame.type === 'result' && frame.is_error === true && frame.api_error_status === 429
}

/** A frame that proves the main agent is working again. */
function isClaudeProgressFrame(frame: ClaudeLimitNativeFrame): boolean {
  return (
    isMainAgentFrame(frame) &&
    frame.type === 'assistant' &&
    frame.error === undefined &&
    frame.isApiErrorMessage !== true
  )
}

function isUnderThreshold(limits: ProviderRateLimits): boolean {
  if (limits.status !== 'ok' || (!limits.session && !limits.weekly)) {
    return false
  }
  return [limits.session, limits.weekly].every(
    (window) => !window || window.usedPercent < CLAUDE_LIMIT_SWITCH_THRESHOLD_PERCENT
  )
}

export function createClaudeLimitStops(deps: ClaudeLimitStopsDeps) {
  const stops = new Map<string, ClaudeLimitStoppedAgent>()
  const lastReliefResumeAt = new Map<string, number>()
  const resuming = new Set<string>()

  const publish = (): void => deps.onChanged([...stops.values()])

  const handedOff = async (stop: ClaudeLimitStoppedAgent): Promise<boolean> =>
    (await deps.checkHandoff?.(stop).catch(() => false)) === true

  const record = (stop: ClaudeLimitStoppedAgent): void => {
    stops.set(stopId(stop.kind, stop.key), stop)
    deps.log?.(`${stop.kind} ${stop.key} stopped on a usage limit`)
    publish()
    // Why: raises the handoff offer now; a limit-cut turn never sends the `done` that would.
    void handedOff(stop)
  }

  const forget = (id: string): void => {
    if (stops.delete(id)) {
      publish()
    }
  }

  const resume = async (stop: ClaudeLimitStoppedAgent): Promise<void> => {
    const id = stopId(stop.kind, stop.key)
    if (resuming.has(id)) {
      return
    }
    resuming.add(id)
    try {
      if (await handedOff(stop)) {
        // Why: "continue" would push the old session past its own handoff into auto-compact.
        deps.log?.(`${stop.kind} ${stop.key} handed off before the limit; not nudged`)
        if (stops.get(id) === stop) {
          forget(id)
        }
        return
      }
      const sent =
        stop.kind === 'terminal'
          ? await deps.resumeTerminal(stop.key)
          : await deps.resumeNativeChat(stop.key)
      deps.log?.(`${stop.kind} ${stop.key} ${sent ? 'nudged to continue' : 'could not be nudged'}`)
      // Why: a pane or session that no longer exists will never need the nudge.
      if (stops.get(id) === stop) {
        forget(id)
      }
    } catch (error) {
      deps.log?.(`${stop.kind} ${stop.key} nudge failed: ${String(error)}`)
    } finally {
      resuming.delete(id)
    }
  }

  return {
    list(): ClaudeLimitStoppedAgent[] {
      return [...stops.values()]
    },

    onHookStatus(event: ClaudeLimitHookEvent): void {
      if (event.source !== 'claude' || event.isReplay || event.toolAgentId) {
        return
      }
      const id = stopId('terminal', event.paneKey)
      if (event.hookEventName === 'StopFailure' && event.stopFailureError === 'rate_limit') {
        record({
          kind: 'terminal',
          key: event.paneKey,
          worktreeId: event.worktreeId ?? null,
          accountId: deps.activeAccountId(),
          stoppedAt: deps.now(),
          resetsAt: null,
          sessionId: event.providerSession?.key === 'session_id' ? event.providerSession.id : null
        })
        return
      }
      if (event.hookEventName === 'UserPromptSubmit') {
        forget(id)
      }
    },

    onNativeFrame(sessionId: string, worktreeId: string | null, frame: ClaudeLimitNativeFrame) {
      const id = stopId('native-chat', sessionId)
      if (isClaudeLimitStopFrame(frame)) {
        if (!stops.has(id)) {
          record({
            kind: 'native-chat',
            key: sessionId,
            worktreeId,
            accountId: deps.activeAccountId(),
            stoppedAt: deps.now(),
            resetsAt: null,
            sessionId
          })
        }
        return
      }
      if (isClaudeProgressFrame(frame)) {
        forget(id)
      }
    },

    forgetTerminal(paneKey: string): void {
      forget(stopId('terminal', paneKey))
    },

    forgetNativeChat(sessionId: string): void {
      forget(stopId('native-chat', sessionId))
    },

    /** Another account became active: every agent stopped on a different account continues. */
    async onAccountChanged(activeAccountId: string | null): Promise<void> {
      const due = [...stops.values()].filter((stop) => stop.accountId !== activeAccountId)
      await Promise.all(due.map(resume))
    },

    /** The active account has room again (window reset): agents stopped on it continue once. */
    async onActiveUsage(activeAccountId: string | null, limits: ProviderRateLimits): Promise<void> {
      if (!isUnderThreshold(limits)) {
        return
      }
      const now = deps.now()
      const due = [...stops.values()].filter((stop) => {
        const id = stopId(stop.kind, stop.key)
        return (
          stop.accountId === activeAccountId &&
          now - stop.stoppedAt >= MIN_STOP_AGE_FOR_RELIEF_MS &&
          now - (lastReliefResumeAt.get(id) ?? 0) >= RELIEF_RETRY_COOLDOWN_MS
        )
      })
      for (const stop of due) {
        lastReliefResumeAt.set(stopId(stop.kind, stop.key), now)
      }
      await Promise.all(due.map(resume))
    }
  }
}

export type ClaudeLimitStops = ReturnType<typeof createClaudeLimitStops>
