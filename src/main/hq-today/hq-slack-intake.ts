// Custom build (hq-slack-intake): Slack messages the owner marked with 👾, read with his own token once
// a minute and raised as «To work» in the bell. Removing the reaction closes one still open; one he
// already sent on or skipped never comes back.
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
const POLL_MS = 60_000
const FIRST_POLL_MS = 25_000

export type HqIntakeReadApi = {
  /** The owner's 👾-marked messages, newest first. */
  marked: () => Promise<HqIntakeDraft[]>
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
  const drafts = await deps.read((api) => api.marked())
  // Why: no token or a failed read says nothing about which marks are gone.
  if (drafts === null) {
    return 0
  }
  const raised = deps.raised()
  const items: PulseBellInput[] = []
  let guessed = 0
  for (const draft of drafts) {
    if (deps.now() - draft.at > HQ_INTAKE_WINDOW_MS) {
      continue
    }
    const known = readHqIntake(raised.get(hqIntakeKey(draft)) ?? null)
    let intake: HqIntake
    if (known) {
      intake = known
    } else {
      intake = { ...draft, ...(await deps.guess(draft)) }
      guessed += 1
    }
    items.push(hqIntakeBellItem(intake))
  }
  deps.sync(HQ_INTAKE_KIND, items)
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
