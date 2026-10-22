// Custom build (hq-slack-intake): Slack messages the owner marked with 👾, read with his own token every
// half minute and raised as «To work» in the bell. Removing the reaction closes one still open; one he
// already sent on or skipped never comes back. Custom build (hq-slack-mentions): messages that @mention
// him are raised the same way and stay until he handles them.
import {
  HQ_INTAKE_KIND,
  hqIntakeBellItem,
  hqIntakeKey,
  readHqIntake,
  type HqIntake
} from '../../shared/hq-slack-intake'
import type { PulseBellInput } from '../../shared/pulse-bell'
import { createDebouncedSingleFlight } from '../orca-plus/debounced-single-flight'
import type { HqIntakeDraft, HqIntakeGuess } from './hq-slack-intake-suggest'

// Why: a mark older than this is an old reaction found on the first run, not a new request.
export const HQ_INTAKE_WINDOW_MS = 7 * 24 * 60 * 60_000
// Why: no model is involved, and Slack allows about 20 reads a minute of each kind; 30 s uses two.
const POLL_MS = 30_000
const FIRST_POLL_MS = 25_000
// Why: a mention older than this on a look is history (Orca+ was off), left to the Slack scout.
export const HQ_MENTION_FRESH_MS = 2 * 60 * 60_000

export type HqIntakeReadApi = {
  /** The owner's 👾-marked messages, newest first; `complete` is false when older reactions went unread. */
  marked: () => Promise<{ drafts: HqIntakeDraft[]; complete: boolean }>
  /** Messages since `since` (ms) that @mention the owner, newest first. */
  mentioned: (since: number) => Promise<HqIntakeDraft[]>
}

export type HqSlackIntakeDeps = {
  /** Null when no reader token is saved. */
  read: <T>(run: (api: HqIntakeReadApi) => Promise<T>) => Promise<T | null>
  /** Bell items of this kind already raised (open or handled), by dedupe key. */
  raised: () => Map<string, string | null>
  guess: (draft: HqIntakeDraft) => Promise<HqIntakeGuess>
  sync: (kind: string, items: readonly PulseBellInput[]) => void
  now: () => number
}

export async function pollHqSlackIntake(deps: HqSlackIntakeDeps): Promise<number> {
  const read = await deps.read(async (api) => ({
    marked: await api.marked(),
    // Why: a token without search:read still serves the 👾 marks.
    mentioned: await api.mentioned(deps.now() - HQ_MENTION_FRESH_MS).catch((error: unknown) => {
      console.warn(
        '[hq-slack-intake] mentions not read:',
        error instanceof Error ? error.message : error
      )
      return []
    })
  }))
  // Why: no token or a failed read says nothing about which marks are gone.
  if (read === null) {
    return 0
  }
  const raised = deps.raised()
  const items = new Map<string, PulseBellInput>()
  let guessed = 0
  for (const draft of [...read.marked.drafts, ...read.mentioned]) {
    const key = hqIntakeKey(draft)
    if (deps.now() - draft.at > HQ_INTAKE_WINDOW_MS || items.has(key)) {
      continue
    }
    const known = readHqIntake(raised.get(key) ?? null)
    let intake: HqIntake
    if (known) {
      intake = known
    } else {
      intake = { ...draft, ...(await deps.guess(draft)) }
      guessed += 1
    }
    items.set(key, hqIntakeBellItem(intake))
  }
  // Why: a mention has no mark to take away, so its card stays until the owner handles it; a mark
  // a partial read did not reach is not known to be gone.
  for (const [key, payload] of raised) {
    const intake = readHqIntake(payload)
    if (
      intake &&
      (intake.via === 'mention' || !read.marked.complete) &&
      !items.has(key) &&
      deps.now() - intake.at <= HQ_INTAKE_WINDOW_MS
    ) {
      items.set(key, hqIntakeBellItem(intake))
    }
  }
  deps.sync(HQ_INTAKE_KIND, [...items.values()])
  return guessed
}

export function startHqSlackIntake(deps: HqSlackIntakeDeps): () => void {
  const flight = createDebouncedSingleFlight(
    async () => {
      await pollHqSlackIntake(deps)
    },
    (error) => console.warn('[hq-slack-intake] poll failed:', error),
    FIRST_POLL_MS
  )
  const timer = setInterval(() => void flight.runNow(), POLL_MS)
  timer.unref?.()
  flight.schedule()
  return () => {
    clearInterval(timer)
    flight.dispose()
  }
}
