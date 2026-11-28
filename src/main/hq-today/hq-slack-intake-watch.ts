// Custom build (hq-slack-intake): runs the 👾 watch — a full pass every half minute, and (router v2
// T7) a quick pass the moment Slack pushes the owner's own 👾 or 🆕 down the Socket Mode connection.
// The half-minute pass stays as the insurance for a dropped socket and for removed marks.
import { HQ_INTAKE_EMOJI, hqIntakeKey, hqRouterNewMarkName } from '../../shared/hq-slack-intake'
import { claudeBackgroundAllows } from '../claude-limit-guard/claude-background-gate'
import { createDebouncedSingleFlight } from '../orca-plus/debounced-single-flight'
import type { Store } from '../persistence/loading-store/store'
import { onSlackReactionPush, type SlackReactionPush } from '../slack/slack-reaction-push'
import { getSlackReaderMetadata } from '../slack/slack-reader-token-store'
import { pollHqSlackIntake, type HqSlackIntakeDeps } from './hq-slack-intake'

// Why: no model is involved, and Slack allows about 20 reads a minute of each kind; 30 s uses two.
const POLL_MS = 30_000
const FIRST_POLL_MS = 25_000

export type HqIntakePushDeps = {
  /** The owner's Slack user id (the reader token's), null while none is saved. */
  owner: () => string | null
  /** The mark emoji names now in force; null for a mark that is off. */
  marks: () => readonly (string | null)[]
  kick: () => void
  /** One log line per pushed mark: how long after the reaction it reached Orca+. */
  note?: (push: SlackReactionPush, lagMs: number | null) => void
  now: () => number
}

/** Everyone's reactions in the owner's channels come down the socket; only his own marks wake the watch. */
export function hqIntakePushKick(deps: HqIntakePushDeps): (push: SlackReactionPush) => void {
  return (push) => {
    const owner = deps.owner()
    if (!owner || push.user !== owner || !deps.marks().includes(push.reaction)) {
      return
    }
    deps.note?.(push, push.at === null ? null : Math.max(0, deps.now() - push.at))
    deps.kick()
  }
}

/** The owner's pushed marks for this Orca+, with a line in the router's mark log for each. */
export function hqIntakeOwnerPushes(
  store: Store,
  noteMark: ((key: string, outcome: string) => void) | undefined
): (kick: () => void) => () => void {
  return (kick) =>
    onSlackReactionPush(
      hqIntakePushKick({
        owner: () => getSlackReaderMetadata()?.user.id ?? null,
        marks: () => [HQ_INTAKE_EMOJI, hqRouterNewMarkName(store.getSettings())],
        kick,
        note: (push, lagMs) =>
          noteMark?.(
            hqIntakeKey(push),
            lagMs === null ? 'pushed' : `pushed ${lagMs} ms after the mark`
          ),
        now: Date.now
      })
    )
}

export function startHqSlackIntake(
  deps: HqSlackIntakeDeps & {
    onError?: (message: string) => void
    /** Router v2 T7: calls `kick` when Slack pushes one of the owner's marks; returns the unsubscribe. */
    pushes?: (kick: () => void) => () => void
  }
): () => void {
  // Why (router v2 T7): a quick pass only after a full one, so the first look of a run — which
  // records the marks made before the trial — always sees every mark.
  let fullDone = false
  let quickNext = false
  const flight = createDebouncedSingleFlight(
    async () => {
      const quick = quickNext && fullDone
      quickNext = false
      if (claudeBackgroundAllows('Slack intake')) {
        await pollHqSlackIntake(deps, { quick })
        fullDone ||= !quick
      }
    },
    (error) => {
      console.warn('[hq-slack-intake] poll failed:', error)
      deps.onError?.(error instanceof Error ? error.message : String(error))
    },
    FIRST_POLL_MS
  )
  const timer = setInterval(() => void flight.runNow(), POLL_MS)
  timer.unref?.()
  flight.schedule()
  const unsubscribe = deps.pushes?.(() => {
    quickNext = true
    void flight.runNow()
  })
  return () => {
    clearInterval(timer)
    flight.dispose()
    unsubscribe?.()
  }
}
