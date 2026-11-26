// Custom build (hq-slack-intake): Slack messages the owner marked with 👾, read with his own token every
// half minute and raised as «To work» in the bell. Removing the reaction closes one still open; one he
// already sent on or skipped never comes back. Custom build (hq-slack-mentions): messages that @mention
// him are raised the same way and stay until he handles them.
import type { HqRoute } from '../../shared/hq-router'
import {
  HQ_INTAKE_KIND,
  HQ_ROUTER_KEY_PREFIX,
  HQ_INTAKE_TEXT_MAX,
  hqIntakeBellItem,
  hqIntakeKey,
  readHqIntake,
  type HqIntake
} from '../../shared/hq-slack-intake'
import type { PulseBellInput } from '../../shared/pulse-bell'
import { createDebouncedSingleFlight } from '../orca-plus/debounced-single-flight'
import type { HqIntakeDraft, HqIntakeGuess } from './hq-slack-intake-suggest'
import { claudeBackgroundAllows } from '../claude-limit-guard/claude-background-gate'

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
  /** Custom build (hq-request-ledger): with the ledger on, its conversation cards — they take the
   *  place of the mention cards; null while it is off or in shadow. */
  ledgerCards?: () => HqIntake[] | null
  sync: (kind: string, items: readonly PulseBellInput[]) => void
  now: () => number
  /** Custom build (hq-router): where a new 👾 mark goes and why; absent while the router is off. */
  route?: (draft: HqIntakeDraft) => Promise<HqRoute | null>
  /** Custom build (hq-router): the marks already there when the trial started (recorded from `current`
   *  on its first run); they are not raised. */
  routerPreTrial?: (current: readonly string[]) => ReadonlySet<string> | null
  /** Custom build (hq-router): sends a card whose route is exact (a bound thread); true when it went. */
  autoSend?: (intake: HqIntake) => Promise<boolean>
  /** Custom build (hq-router): closes a card that was sent by itself, after it was raised. */
  settle?: (dedupeKey: string, intake: HqIntake) => void
  /** Custom build (hq-router T1c): one line for each 👾 mark a poll saw and what became of it. */
  noteMark?: (key: string, outcome: string) => void
}

/** Custom build (hq-router T1c, 26.11): a mention card still waiting with no route — the owner's 👾 on
 *  the same message (same key) is his ask to route it; before, the mark found the card and stopped. */
function routesMentionCard(
  deps: HqSlackIntakeDeps,
  card: HqIntake,
  key: string,
  handled: ReadonlySet<string>
): boolean {
  return (
    !!deps.route &&
    card.via === 'mention' &&
    !card.conversationId &&
    !card.route &&
    !handled.has(key)
  )
}

/** Custom build (hq-router): a mark in the same thread as a card still waiting joins it — root and
 *  reply marked together are one request. */
function sameThread(card: HqIntake, draft: HqIntakeDraft): boolean {
  if (card.via === 'mention' || draft.via === 'mention' || card.channel !== draft.channel) {
    return false
  }
  const cardRoot = card.threadTs ?? card.ts
  const draftRoot = draft.threadTs ?? draft.ts
  return cardRoot === draftRoot && !card.pasted
}

export async function pollHqSlackIntake(deps: HqSlackIntakeDeps): Promise<number> {
  const ledger = deps.ledgerCards?.() ?? null
  const read = await deps.read(async (api) => ({
    marked: await api.marked(),
    // Why: a token without search:read still serves the 👾 marks.
    mentioned: ledger
      ? []
      : await api.mentioned(deps.now() - HQ_MENTION_FRESH_MS).catch((error: unknown) => {
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
    // Custom build (hq-router): a pasted link's card has no mark either; it stays like a mention.
    if (
      intake?.pasted &&
      key.startsWith(HQ_ROUTER_KEY_PREFIX) &&
      deps.now() - intake.at <= HQ_INTAKE_WINDOW_MS
    ) {
      cards.set(key, intake)
      continue
    }
    if (
      intake?.via === 'mention' &&
      !ledger &&
      !intake.conversationId &&
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
  const autoSent: [string, HqIntake][] = []
  const preTrial = deps.route
    ? (deps.routerPreTrial?.(
        drafts.filter((draft) => draft.via !== 'mention').map((draft) => hqIntakeKey(draft))
      ) ?? null)
    : null
  for (const draft of drafts) {
    const key = hqIntakeKey(draft)
    const mark = draft.via !== 'mention'
    const note = (outcome: string) => {
      if (mark) {
        deps.noteMark?.(key, outcome)
      }
    }
    if (deps.now() - draft.at > HQ_INTAKE_WINDOW_MS) {
      note('older than a week')
      continue
    }
    const kept = cards.get(key) ?? null
    if (kept && !(mark && routesMentionCard(deps, kept, key, handled))) {
      note(kept.route ? 'card up, routed' : 'card up')
      continue
    }
    if (!kept && [...cards.values()].some((card) => card.more?.includes(draft.ts))) {
      note('joined a card')
      continue
    }
    // Why: a follow-up joins the card still waiting; once handled, it is news of its own.
    const burst = kept
      ? undefined
      : [...cards.entries()].find(
          ([cardKey, card]) =>
            !handled.has(cardKey) &&
            (sameBurst(card, draft) || (!!deps.route && sameThread(card, draft)))
        )
    if (burst) {
      cards.set(burst[0], folded(burst[1], draft))
      note('joined a card')
      continue
    }
    const known = kept ?? readHqIntake(raised.get(key) ?? null)
    const upgrade =
      !!known && mark && !preTrial?.has(key) && routesMentionCard(deps, known, key, handled)
    if (known && !upgrade) {
      cards.set(key, known)
      note(known.route ? 'card up, routed' : 'card up')
      continue
    }
    // Why (owner 26.11): the trial does not dig up marks made before it started.
    if (mark && preTrial?.has(key)) {
      note('made before the trial')
      continue
    }
    const route =
      deps.route && mark
        ? await deps.route(draft).catch((error: unknown) => {
            note(`route failed: ${error instanceof Error ? error.message : String(error)}`)
            return null
          })
        : null
    let card: HqIntake
    if (known && upgrade) {
      // Why: the mention card already has its guess; the mark adds the route and makes it a 👾 card.
      // With no route it stays the mention card, and the next poll tries again.
      const { via: _via, ...rest } = known
      card = route ? { ...rest, route } : known
    } else {
      const guess = await deps.guess(draft)
      card = { ...draft, ...guess, ...(route ? { route } : {}) }
      guessed += 1
    }
    cards.set(key, card)
    if (route) {
      note(`routed ${route.how} → ${route.target}${upgrade ? ' (was a mention card)' : ''}`)
    }
    if (route?.auto && deps.autoSend && (await deps.autoSend(card).catch(() => false))) {
      autoSent.push([key, card])
    }
  }
  // Why: a mark a partial read did not reach is not known to be gone.
  if (!read.marked.complete) {
    for (const [key, payload] of raised) {
      const intake = readHqIntake(payload)
      if (
        intake &&
        intake.via !== 'mention' &&
        !cards.has(key) &&
        deps.now() - intake.at <= HQ_INTAKE_WINDOW_MS
      ) {
        cards.set(key, intake)
      }
    }
  }
  deps.sync(
    HQ_INTAKE_KIND,
    [...cards.values(), ...(ledger ?? [])].map((intake) => hqIntakeBellItem(intake))
  )
  for (const [key, card] of autoSent) {
    deps.settle?.(key, card)
  }
  return guessed
}

export function startHqSlackIntake(
  deps: HqSlackIntakeDeps & { onError?: (message: string) => void }
): () => void {
  const flight = createDebouncedSingleFlight(
    async () => {
      if (claudeBackgroundAllows('Slack intake')) {
        await pollHqSlackIntake(deps)
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
  return () => {
    clearInterval(timer)
    flight.dispose()
  }
}
