// Custom build (hq-router send first, router v2 T5, owner 28.11): a 👾 in the middle zone goes to the
// router's pick at once; the chat checks it first and answers «не моё» when it is not its work. Orca+
// reads that answer from the chat's finished turn and passes the message to the runner-up; after two
// such answers (or with no chat left) the card asks the owner as before. Every step rewrites the auto
// row's outcome in router_log. Messages go only to agent chats — anything to people still goes through
// Approve in the chat that takes it.
import {
  HQ_ROUTER_NOT_MINE_MAX,
  HQ_ROUTER_NOT_MINE_WINDOW_MS,
  hqRouterNextChat,
  hqRouterNotMine
} from '../../shared/hq-router-send-first'
import type { HqIntake } from '../../shared/hq-slack-intake'
import { hqRouterLogKey as logKey } from './hq-intake-close-route'

/** A chat's finished turn: who, when, and its last message. */
export type HqRouterFinishedTurn = { chat: string; at: number; text: string | null }

export type HqRouterSendFirstDeps = {
  /** Sends the card to the chat with the «check first» instruction; true when the chat took it. */
  deliver: (chat: string, card: HqIntake) => Promise<boolean>
  /** Chats' finished turns since a moment, any order. */
  finishedTurns: (since: number) => readonly HqRouterFinishedTurn[]
  /** The auto row's outcome: it went to `chosen` (send first or the runner-up). */
  rewriteOutcome: (key: string, input: { chosen: string; at: number; reason: string }) => void
  /** The card is back with the owner; the row is open again. */
  reopenOutcome: (key: string, reason: string) => void
  /** The send did not go; the row is not auto. */
  unmarkAuto: (key: string) => void
  now: () => number
}

/** A new middle-zone card sent to the router's pick; unchanged (and no longer send-first) when it did not go. */
export async function sendFirstCard(
  card: HqIntake,
  deps: HqRouterSendFirstDeps,
  note?: (outcome: string) => void
): Promise<HqIntake> {
  const route = card.route
  if (!route?.sendFirst || route.auto || route.target === 'new' || card.sent) {
    return card
  }
  const at = deps.now()
  const went = await deps.deliver(route.target, card).catch(() => false)
  if (!went) {
    deps.unmarkAuto(logKey(card))
    return { ...card, route: { ...route, sendFirst: false } }
  }
  deps.rewriteOutcome(logKey(card), { chosen: route.target, at, reason: 'send-first' })
  note?.(`sent first → ${route.target}`)
  return { ...card, sent: { chat: route.target, title: route.targetTitle, at } }
}

/** The «не моё» the sent chat answered since the send, or null while it has not (or took it). */
export function notMineAnswer(
  sent: NonNullable<HqIntake['sent']>,
  turns: readonly HqRouterFinishedTurn[]
): string | null {
  const answers = turns
    .filter(
      (turn) =>
        turn.chat === sent.chat &&
        turn.at > sent.at &&
        turn.at - sent.at <= HQ_ROUTER_NOT_MINE_WINDOW_MS
    )
    .sort((a, b) => a.at - b.at)
  for (const turn of answers) {
    const reason = hqRouterNotMine(turn.text)
    if (reason !== null) {
      return reason
    }
  }
  return null
}

/**
 * The open send-first cards after the chats' answers: a «не моё» passes the card to the runner-up, the
 * second one (or none left) gives it back to the owner. Returns the cards that changed, by key.
 */
export async function followNotMine(
  cards: ReadonlyMap<string, HqIntake>,
  deps: HqRouterSendFirstDeps
): Promise<Map<string, HqIntake>> {
  const changed = new Map<string, HqIntake>()
  const watched = [...cards.entries()].filter(([, card]) => card.sent && card.route)
  if (watched.length === 0) {
    return changed
  }
  const since = Math.min(...watched.map(([, card]) => card.sent?.at ?? 0))
  const turns = deps.finishedTurns(since)
  for (const [key, card] of watched) {
    const sent = card.sent
    const route = card.route
    if (!sent || !route) {
      continue
    }
    const reason = notMineAnswer(sent, turns)
    if (reason === null) {
      continue
    }
    const refused = [...(card.notMine ?? []), { chat: sent.chat, title: sent.title, reason }]
    const { sent: _sent, ...rest } = card
    const back: HqIntake = { ...rest, notMine: refused }
    const next =
      refused.length < HQ_ROUTER_NOT_MINE_MAX
        ? hqRouterNextChat(route.alternatives, refused, sent.chat)
        : null
    const at = deps.now()
    if (next && (await deps.deliver(next.sessionId, card).catch(() => false))) {
      deps.rewriteOutcome(logKey(card), { chosen: next.sessionId, at, reason: 'not-mine' })
      changed.set(key, { ...back, sent: { chat: next.sessionId, title: next.title, at } })
      continue
    }
    deps.reopenOutcome(
      logKey(card),
      refused.length >= HQ_ROUTER_NOT_MINE_MAX ? 'not-mine-twice' : 'not-mine-no-next'
    )
    changed.set(key, back)
  }
  return changed
}

/**
 * The poll's part: a middle-zone card not sent yet (routed this poll) goes to its pick, then the sent ones
 * follow their chats' «не моё». A changed card goes back in place (a raised one rewrites itself).
 */
export async function applySendFirst(
  cards: Map<string, HqIntake>,
  raised: ReadonlyMap<string, unknown>,
  upgraded: Set<string>,
  deps: HqRouterSendFirstDeps | undefined,
  noteMark?: (key: string, outcome: string) => void
): Promise<void> {
  if (!deps) {
    return
  }
  const put = (key: string, card: HqIntake): void => {
    cards.set(key, card)
    if (raised.has(key)) {
      upgraded.add(key)
    }
  }
  for (const [key, card] of cards) {
    // Why by state: a failed send clears sendFirst and a card back with the owner has its «не моё».
    if (card.route?.sendFirst && !card.sent && !card.notMine?.length) {
      put(key, await sendFirstCard(card, deps, (outcome) => noteMark?.(key, outcome)))
    }
  }
  for (const [key, card] of await followNotMine(cards, deps)) {
    put(key, card)
    noteMark?.(key, card.sent ? `not mine → ${card.sent.chat}` : 'not mine → back to the card')
  }
}
