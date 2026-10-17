// Custom build (claude-network-continue): Claude turns the API connection cut — offline, DNS, a dropped
// connection, a sleeping Mac, a 5xx — and when each may be nudged to continue.
import type { ClaudeLimitStoppedAgent } from '../../shared/claude-limit-guard'

type Frame = Record<string, unknown>

// Why: one nudge per network stop, no more than one per 10 minutes per agent, so a link that keeps
// dropping does not turn into a loop.
const NETWORK_RETRY_COOLDOWN_MS = 10 * 60_000
const MIN_NETWORK_STOP_AGE_MS = 20_000

/** A frame that ends the main agent's turn on a transient API failure: not a limit, not its choice. */
export function isClaudeTransientStopFrame(frame: Frame): boolean {
  if (frame.parent_tool_use_id !== null && frame.parent_tool_use_id !== undefined) {
    return false
  }
  if (frame.type === 'assistant') {
    return frame.error === 'server_error'
  }
  return (
    frame.type === 'result' &&
    frame.is_error === true &&
    typeof frame.api_error_status === 'number' &&
    frame.api_error_status >= 500
  )
}

/** Stops old enough and past their cooldown; marks them nudged now. */
export function claudeNetworkStopsDue(
  stops: ReadonlyMap<string, ClaudeLimitStoppedAgent>,
  lastResumeAt: Map<string, number>,
  now: number
): ClaudeLimitStoppedAgent[] {
  const due = [...stops.entries()].filter(
    ([id, stop]) =>
      now - stop.stoppedAt >= MIN_NETWORK_STOP_AGE_MS &&
      now - (lastResumeAt.get(id) ?? 0) >= NETWORK_RETRY_COOLDOWN_MS
  )
  for (const [id] of due) {
    lastResumeAt.set(id, now)
  }
  return due.map(([, stop]) => stop)
}
