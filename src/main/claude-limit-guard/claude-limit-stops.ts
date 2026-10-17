// Custom build (claude-limit-guard): Claude agents whose turn ended on a usage limit or a rejected
// sign-in, and the one nudge (Esc + a continue prompt) each gets once another account is active, the
// limit lifted, or the owner fixed the sign-in.
import {
  CLAUDE_LIMIT_SWITCH_THRESHOLD_PERCENT,
  claudeLimitStopIsAuth,
  claudeLimitStopOnBaseSignIn,
  type ClaudeLimitStopReason,
  type ClaudeLimitStoppedAgent
} from '../../shared/claude-limit-guard'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { claudeNetworkStopsDue, isClaudeTransientStopFrame } from './claude-network-stops'

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
  /** The subscription a native chat runs on; null for the base sign-in. */
  nativeChatSubscription?: (sessionId: string) => string | null
  onChanged: (stops: ClaudeLimitStoppedAgent[]) => void
  /** Whether a stopped native chat's live child runs on another account than launches use now. */
  nativeChatOnOtherAccount?: (sessionId: string) => Promise<boolean>
  /** The account a native chat's live child spends (null: base sign-in); undefined when unknown. */
  nativeChatAccountId?: (sessionId: string) => string | null | undefined
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

/** A frame that ends the main agent's turn on a rejected sign-in ("Please run /login · 403"). */
export function isClaudeAuthStopFrame(frame: ClaudeLimitNativeFrame): boolean {
  if (!isMainAgentFrame(frame)) {
    return false
  }
  if (frame.type === 'assistant') {
    return frame.error === 'authentication_failed'
  }
  return (
    frame.type === 'result' &&
    frame.is_error === true &&
    (frame.api_error_status === 401 || frame.api_error_status === 403)
  )
}

function nativeStopReason(frame: ClaudeLimitNativeFrame): ClaudeLimitStopReason | null {
  return isClaudeLimitStopFrame(frame) ? 'limit' : isClaudeAuthStopFrame(frame) ? 'auth' : null
}

const HOOK_STOP_REASONS: Readonly<Record<string, ClaudeLimitStopReason>> = {
  rate_limit: 'limit',
  authentication_failed: 'auth'
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
  // Why: kept apart from `stops`, which every reader treats as a limit (cards, account switching).
  const networkStops = new Map<string, ClaudeLimitStoppedAgent>()
  const lastNetworkResumeAt = new Map<string, number>()
  const lastReliefResumeAt = new Map<string, number>()
  const resuming = new Set<string>()

  const publish = (): void => deps.onChanged([...stops.values()])

  const handedOff = async (stop: ClaudeLimitStoppedAgent): Promise<boolean> =>
    (await deps.checkHandoff?.(stop).catch(() => false)) === true

  const record = (stop: ClaudeLimitStoppedAgent): void => {
    stops.set(stopId(stop.kind, stop.key), stop)
    deps.log?.(
      `${stop.kind} ${stop.key} ${claudeLimitStopIsAuth(stop) ? 'stopped: sign-in rejected' : 'stopped on a usage limit'}`
    )
    publish()
    // Why: raises the handoff offer now; a limit-cut turn never sends the `done` that would.
    void handedOff(stop)
  }

  const recordNetwork = (stop: ClaudeLimitStoppedAgent): void => {
    networkStops.set(stopId(stop.kind, stop.key), stop)
    deps.log?.(
      `${stop.kind} ${stop.key} stopped on a network error; continues when the API answers`
    )
  }

  const forget = (id: string): void => {
    if (stops.delete(id)) {
      publish()
    }
  }

  const drop = (from: Map<string, ClaudeLimitStoppedAgent>, id: string): void => {
    if (from === stops) {
      forget(id)
    } else {
      from.delete(id)
    }
  }

  const resume = async (
    stop: ClaudeLimitStoppedAgent,
    from: Map<string, ClaudeLimitStoppedAgent> = stops
  ): Promise<void> => {
    const id = stopId(stop.kind, stop.key)
    if (resuming.has(id)) {
      return
    }
    resuming.add(id)
    try {
      if (await handedOff(stop)) {
        // Why: "continue" would push the old session past its own handoff into auto-compact.
        deps.log?.(`${stop.kind} ${stop.key} handed off before the limit; not nudged`)
        if (from.get(id) === stop) {
          drop(from, id)
        }
        return
      }
      const sent =
        stop.kind === 'terminal'
          ? await deps.resumeTerminal(stop.key)
          : await deps.resumeNativeChat(stop.key)
      deps.log?.(`${stop.kind} ${stop.key} ${sent ? 'nudged to continue' : 'could not be nudged'}`)
      // Why: a pane or session that no longer exists will never need the nudge.
      if (from.get(id) === stop) {
        drop(from, id)
      }
    } catch (error) {
      deps.log?.(`${stop.kind} ${stop.key} nudge failed: ${String(error)}`)
    } finally {
      resuming.delete(id)
    }
  }

  // Why: a chat keeps the account it spawned on after a switch; its stop belongs to that account, or
  // the card would offer to switch to the very account that ran out.
  const nativeChatAccount = (sessionId: string): string | null => {
    const own = deps.nativeChatAccountId?.(sessionId)
    return own === undefined ? deps.activeAccountId() : own
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
      const reason =
        event.hookEventName === 'StopFailure'
          ? HOOK_STOP_REASONS[event.stopFailureError ?? '']
          : undefined
      if (event.hookEventName === 'StopFailure' && event.stopFailureError === 'server_error') {
        recordNetwork({
          kind: 'terminal',
          key: event.paneKey,
          worktreeId: event.worktreeId ?? null,
          accountId: deps.activeAccountId(),
          stoppedAt: deps.now(),
          resetsAt: null
        })
        return
      }
      if (reason) {
        record({
          kind: 'terminal',
          reason,
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
        networkStops.delete(id)
      }
    },

    onNativeFrame(sessionId: string, worktreeId: string | null, frame: ClaudeLimitNativeFrame) {
      const id = stopId('native-chat', sessionId)
      if (isClaudeTransientStopFrame(frame)) {
        if (!networkStops.has(id)) {
          recordNetwork({
            kind: 'native-chat',
            key: sessionId,
            worktreeId,
            accountId: nativeChatAccount(sessionId),
            stoppedAt: deps.now(),
            resetsAt: null,
            sessionId
          })
        }
        return
      }
      const reason = nativeStopReason(frame)
      if (reason) {
        if (!stops.has(id)) {
          record({
            kind: 'native-chat',
            reason,
            key: sessionId,
            worktreeId,
            accountId: nativeChatAccount(sessionId),
            stoppedAt: deps.now(),
            resetsAt: null,
            sessionId,
            subscriptionId: deps.nativeChatSubscription?.(sessionId) ?? null
          })
        }
        return
      }
      if (isClaudeProgressFrame(frame)) {
        forget(id)
        networkStops.delete(id)
      }
    },

    forgetTerminal(paneKey: string): void {
      forget(stopId('terminal', paneKey))
      networkStops.delete(stopId('terminal', paneKey))
    },

    forgetNativeChat(sessionId: string): void {
      forget(stopId('native-chat', sessionId))
      networkStops.delete(stopId('native-chat', sessionId))
    },

    /** Another account became active: every agent stopped on a different account continues. */
    async onAccountChanged(activeAccountId: string | null): Promise<void> {
      const onBase = [...stops.values()].filter(claudeLimitStopOnBaseSignIn)
      // Why: a stop records the selection at the stop, but a chat's child keeps the account it spawned on.
      const runsElsewhere = await Promise.all(
        onBase.map(async (stop) =>
          stop.kind === 'native-chat'
            ? ((await deps.nativeChatOnOtherAccount?.(stop.key).catch(() => false)) ?? false)
            : false
        )
      )
      const due = onBase.filter(
        (stop, index) => stop.accountId !== activeAccountId || runsElsewhere[index]
      )
      await Promise.all(due.map((stop) => resume(stop)))
    },

    /** The owner fixed the sign-in (or says it is fixed): agents stopped on a rejected one continue. */
    async resumeAuthStops(): Promise<number> {
      const due = [...stops.values()].filter(
        (stop) => claudeLimitStopIsAuth(stop) && claudeLimitStopOnBaseSignIn(stop)
      )
      await Promise.all(due.map((stop) => resume(stop)))
      return due.length
    },

    /** The active account has room again (window reset): agents stopped on it continue once. */
    async onActiveUsage(activeAccountId: string | null, limits: ProviderRateLimits): Promise<void> {
      const now = deps.now()
      // Custom build (claude-network-continue): a usage reading that came back means the API is reachable.
      if (limits.status === 'ok') {
        const back = claudeNetworkStopsDue(networkStops, lastNetworkResumeAt, now)
        await Promise.all(back.map((stop) => resume(stop, networkStops)))
      }
      if (!isUnderThreshold(limits)) {
        return
      }
      const due = [...stops.values()].filter((stop) => {
        const id = stopId(stop.kind, stop.key)
        return (
          stop.accountId === activeAccountId &&
          !claudeLimitStopIsAuth(stop) &&
          claudeLimitStopOnBaseSignIn(stop) &&
          now - stop.stoppedAt >= MIN_STOP_AGE_FOR_RELIEF_MS &&
          now - (lastReliefResumeAt.get(id) ?? 0) >= RELIEF_RETRY_COOLDOWN_MS
        )
      })
      for (const stop of due) {
        lastReliefResumeAt.set(stopId(stop.kind, stop.key), now)
      }
      await Promise.all(due.map((stop) => resume(stop)))
    }
  }
}

export type ClaudeLimitStops = ReturnType<typeof createClaudeLimitStops>
