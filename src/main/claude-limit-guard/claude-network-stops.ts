// Custom build (claude-network-continue): Claude turns the API connection cut — offline, DNS, a dropped
// connection, a sleeping Mac, a 5xx — and when each may be nudged to continue.
import type { ClaudeLimitStoppedAgent } from '../../shared/claude-limit-guard'

type Frame = Record<string, unknown>

// Custom build (network auto-continue, A10 28.11): at most this many nudges in a row per agent; real
// progress (output, a tool call, a finished turn) starts the count over.
export const CLAUDE_NETWORK_CONTINUE_MAX_ATTEMPTS = 3
// Why: the pause before nudge n (1-based), counted from the stop it answers. The CLI has already
// retried for a while before it gives up, so the first waits a minute; the last one covers an outage
// of a quarter of an hour (19.11: 30 minutes, W47 median 15).
const NETWORK_CONTINUE_DELAYS_MS = [60_000, 3 * 60_000, 10 * 60_000] as const

/** The turn the agent gets: visible in the chat as Orca+'s, and still a plain «go on» to the agent. */
export function claudeNetworkContinuePrompt(attempt: number): string {
  return `Orca+ · связь с API оборвалась посреди хода, продолжаю сам (попытка ${attempt} из ${CLAUDE_NETWORK_CONTINUE_MAX_ATTEMPTS}). Продолжай с того места, где остановился.`
}

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

/** Pause before the next nudge of an agent that has had `sent` nudges in a row; null once used up. */
export function claudeNetworkContinueDelayMs(sent: number): number | null {
  return sent < CLAUDE_NETWORK_CONTINUE_MAX_ATTEMPTS ? NETWORK_CONTINUE_DELAYS_MS[sent] : null
}

/** Stops whose pause is over, with the attempt number each nudge carries. */
export function claudeNetworkStopsDue(
  stops: ReadonlyMap<string, ClaudeLimitStoppedAgent>,
  sentInRow: ReadonlyMap<string, number>,
  now: number
): { id: string; stop: ClaudeLimitStoppedAgent; attempt: number }[] {
  return [...stops.entries()].flatMap(([id, stop]) => {
    const sent = sentInRow.get(id) ?? 0
    const delay = claudeNetworkContinueDelayMs(sent)
    return delay !== null && now - stop.stoppedAt >= delay ? [{ id, stop, attempt: sent + 1 }] : []
  })
}

export type ClaudeNetworkStopsDeps = {
  now: () => number
  /** The owner's switch. */
  enabled: () => boolean
  /** Calls `tick` once after `delayMs`: when the stop just recorded falls due. */
  scheduleTick?: (delayMs: number) => void
  log?: (message: string) => void
  /** True while the limit guard is already nudging this agent. */
  isResuming: (id: string) => boolean
  /** Sends `prompt` and drops the stop from `from` once sent (the limit guard's own resume). */
  resume: (
    stop: ClaudeLimitStoppedAgent,
    from: Map<string, ClaudeLimitStoppedAgent>,
    prompt: string
  ) => Promise<void>
}

/** Agents cut by the network, waiting for their nudge; kept apart from the limit stops every reader
 *  treats as a limit (cards, account switching). */
export function createClaudeNetworkStops(deps: ClaudeNetworkStopsDeps) {
  const stops = new Map<string, ClaudeLimitStoppedAgent>()
  // Nudges sent in a row per agent, kept across its stops until it gets through again.
  const sentInRow = new Map<string, number>()

  return {
    has: (id: string): boolean => stops.has(id),

    record(id: string, stop: ClaudeLimitStoppedAgent): void {
      const what = `${stop.kind} ${stop.key} stopped on a network error`
      if (!deps.enabled()) {
        deps.log?.(`${what}; auto-continue is off`)
        return
      }
      const sent = sentInRow.get(id) ?? 0
      const delay = claudeNetworkContinueDelayMs(sent)
      if (delay === null) {
        // Why: the cap — a link that keeps failing waits for the owner instead of looping.
        deps.log?.(`${what} again; ${sent} nudges used, left to the owner`)
        return
      }
      stops.set(id, stop)
      deps.scheduleTick?.(delay)
      deps.log?.(`${what}; nudge ${sent + 1} in ${Math.round(delay / 1000)}s`)
    },

    /** Someone wrote to the agent (the owner, or the nudge itself): this stop is answered. */
    answered(id: string): void {
      stops.delete(id)
    },

    /** The agent got through again: its next network stop starts a fresh count. */
    progress(id: string): void {
      stops.delete(id)
      sentInRow.delete(id)
    },

    async tick(): Promise<void> {
      if (!deps.enabled()) {
        stops.clear()
        return
      }
      // Why: picked and counted before any await, so a second tick cannot send the same attempt.
      const due = claudeNetworkStopsDue(stops, sentInRow, deps.now()).filter(
        ({ id }) => !deps.isResuming(id)
      )
      for (const { id, attempt } of due) {
        sentInRow.set(id, attempt)
      }
      await Promise.all(
        due.map(({ stop, attempt }) =>
          deps.resume(stop, stops, claudeNetworkContinuePrompt(attempt))
        )
      )
    }
  }
}
