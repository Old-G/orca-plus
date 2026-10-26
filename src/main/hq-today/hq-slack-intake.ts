// Custom build (hq-slack-intake): Slack messages the owner marked with 👾, read with his own token every
// half minute and raised as «To work» in the bell. Removing the reaction closes one still open; one he
// already sent on or skipped never comes back. Custom build (hq-slack-mentions): messages that @mention
// him are raised the same way and stay until he handles them.
import {
  HQ_INTAKE_KIND,
  HQ_INTAKE_TEXT_MAX,
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

// Custom build (hq-intake-one-card): a person's messages this close together in one thread are one
// request, and a message that answered a waiting already has its card (26.10: three cards for one).
export const HQ_INTAKE_BURST_MS = 10 * 60_000
const ANSWER_SPAN_MS = 15 * 60_000

/** A Slack answer to a waiting: its card is the answer's, not a second «To work». */
export type HqIntakeAnswer = { channel: string; authorSlackId: string | null; at: number }

function answersWaiting(draft: HqIntakeDraft, answers: readonly HqIntakeAnswer[]): boolean {
  return answers.some(
    (answer) =>
      answer.channel === draft.channel &&
      (answer.authorSlackId === null || answer.authorSlackId === draft.authorSlackId) &&
      draft.at >= answer.at - ANSWER_SPAN_MS &&
      draft.at <= answer.at + 2 * 60_000
  )
}

function sameBurst(card: HqIntake, draft: HqIntakeDraft): boolean {
  return (
    card.via === 'mention' &&
    draft.via === 'mention' &&
    card.channel === draft.channel &&
    card.threadTs === draft.threadTs &&
    card.authorSlackId !== null &&
    card.authorSlackId === draft.authorSlackId &&
    draft.at >= card.at &&
    draft.at - (card.lastAt ?? card.at) <= HQ_INTAKE_BURST_MS
  )
}

function folded(card: HqIntake, draft: HqIntakeDraft): HqIntake {
  return {
    ...card,
    text: `${card.text}\n${draft.text}`.slice(0, HQ_INTAKE_TEXT_MAX),
    links: [...new Set([...card.links, ...draft.links])],
    files: [...new Set([...card.files, ...draft.files])],
    more: [...(card.more ?? []), draft.ts],
    lastAt: Math.max(card.lastAt ?? card.at, draft.at)
  }
}

export type HqSlackIntakeDeps = {
  /** Null when no reader token is saved. */
  read: <T>(run: (api: HqIntakeReadApi) => Promise<T>) => Promise<T | null>
  /** Bell items of this kind already raised (open or handled), by dedupe key. */
  raised: () => Map<string, string | null>
  /** Custom build (hq-intake-one-card): keys of raised items the owner already handled. */
  handled?: () => ReadonlySet<string>
  /** Slack answers to waitings, recent. */
  answers?: () => readonly HqIntakeAnswer[]
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
  const handled = deps.handled?.() ?? new Set<string>()
  const answers = deps.answers?.() ?? []
  const cards = new Map<string, HqIntake>()
  // Why: a mention has no mark to take away, so its card stays until the owner handles it — unless
  // it turned out to be the answer to a waiting, which has its own card.
  for (const [key, payload] of raised) {
    const intake = readHqIntake(payload)
    if (
      intake?.via === 'mention' &&
      deps.now() - intake.at <= HQ_INTAKE_WINDOW_MS &&
      !answersWaiting(intake, answers)
    ) {
      cards.set(key, intake)
    }
  }
  const drafts = [
    ...read.marked.drafts,
    ...read.mentioned.filter((draft) => !answersWaiting(draft, answers))
  ].sort((a, b) => a.at - b.at)
  let guessed = 0
  for (const draft of drafts) {
    const key = hqIntakeKey(draft)
    if (
      deps.now() - draft.at > HQ_INTAKE_WINDOW_MS ||
      cards.has(key) ||
      [...cards.values()].some((card) => card.more?.includes(draft.ts))
    ) {
      continue
    }
    // Why: a follow-up joins the card still waiting; once handled, it is news of its own.
    const burst = [...cards.entries()].find(
      ([cardKey, card]) => !handled.has(cardKey) && sameBurst(card, draft)
    )
    if (burst) {
      cards.set(burst[0], folded(burst[1], draft))
      continue
    }
    const known = readHqIntake(raised.get(key) ?? null)
    if (known) {
      cards.set(key, known)
    } else {
      cards.set(key, { ...draft, ...(await deps.guess(draft)) })
      guessed += 1
    }
  }
  // Why: a mark a partial read did not reach is not known to be gone.
  if (!read.marked.complete) {
    for (const [key, payload] of raised) {
      const intake = readHqIntake(payload)
      if (intake && !cards.has(key) && deps.now() - intake.at <= HQ_INTAKE_WINDOW_MS) {
        cards.set(key, intake)
      }
    }
  }
  deps.sync(
    HQ_INTAKE_KIND,
    [...cards.values()].map((intake) => hqIntakeBellItem(intake))
  )
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
