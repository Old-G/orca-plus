// Custom build (hq-router T7, owner 26.11): the route of a To work card that has none — read back from
// the router's own record, else asked once.
import type { HqRoute } from '../../shared/hq-router'
import { hqIntakeBellItem, type HqIntake } from '../../shared/hq-slack-intake'
import type { HqIntakeDraft } from './hq-slack-intake-suggest'

export type HqCardRouteDeps = {
  noteMark?: (key: string, outcome: string) => void
  route?: (draft: HqIntakeDraft) => Promise<HqRoute | null>
  cardRoute?: (key: string) => { route: HqRoute | null; at: number; tries: number } | null
  saveCardRoute?: (key: string, route: HqRoute | null, at: number) => void
  now: () => number
}

/** A card the router found nothing for is tried again this many times, this far apart. */
export const HQ_CARD_ROUTE_TRIES = 3
export const HQ_CARD_ROUTE_RETRY_MS = 30 * 60_000
/** Routes made in one poll; the rest wait for the next (a poll is every half minute). */
export const HQ_CARD_ROUTES_PER_POLL = 3

/** The message a card stands for, as the router reads it. */
function draftOfCard(card: HqIntake): HqIntakeDraft {
  return {
    channel: card.channel,
    ts: card.lastTs ?? card.ts,
    threadTs: card.threadTs,
    author: card.author,
    authorSlackId: card.authorSlackId,
    venue: card.venue,
    text: card.text,
    links: card.links,
    files: card.files,
    permalink: card.permalink,
    at: card.lastAt ?? card.at
  }
}

/** Custom build (hq-router T7, owner 26.11): the route of a To work card that has none — read back
 *  from the router's own record, else asked once (one model call per card, never a second). A route
 *  here is only a proposal, so it never goes by itself. */
export async function routeCardOnce(
  deps: HqCardRouteDeps,
  key: string,
  card: HqIntake,
  budget: { left: number }
): Promise<HqRoute | null> {
  const known = deps.cardRoute?.(key) ?? null
  if (known?.route) {
    return { ...known.route, auto: false }
  }
  if (
    !deps.route ||
    budget.left <= 0 ||
    (known &&
      (known.tries >= HQ_CARD_ROUTE_TRIES || deps.now() - known.at < HQ_CARD_ROUTE_RETRY_MS))
  ) {
    return null
  }
  budget.left -= 1
  const route = await deps.route(draftOfCard(card)).catch(() => null)
  deps.saveCardRoute?.(key, route, deps.now())
  return route ? { ...route, auto: false } : null
}

/** The poll's To work cards that have no route: mention cards (`cards`, changed in place; their keys go
 *  into `upgraded` so the sync rewrites them) and the ledger's conversation cards (returned). */
export async function routeToWorkCards(
  deps: HqCardRouteDeps,
  cards: Map<string, HqIntake>,
  ledger: readonly HqIntake[],
  handled: ReadonlySet<string>,
  upgraded: Set<string>
): Promise<HqIntake[]> {
  const budget = { left: HQ_CARD_ROUTES_PER_POLL }
  for (const [key, card] of cards) {
    if (card.via === 'mention' && !card.route && !card.conversationId && !handled.has(key)) {
      const route = await routeCardOnce(deps, key, card, budget)
      if (route) {
        cards.set(key, { ...card, route })
        upgraded.add(key)
        deps.noteMark?.(key, `routed ${route.how} → ${route.target} (mention card)`)
      }
    }
  }
  const out: HqIntake[] = []
  for (const card of ledger) {
    const key = hqIntakeBellItem(card).dedupeKey ?? ''
    const route = card.route || !key ? null : await routeCardOnce(deps, key, card, budget)
    out.push(route ? { ...card, route } : card)
  }
  return out
}
