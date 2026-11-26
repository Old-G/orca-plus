// Custom build (hq-router T7, owner 26.11): the router's «→ chat» for the To work cards the 👾 and
// conversation readers do not make — the scout's Slack and ClickUp requests. One call per card: the
// answer is kept by the card's key, so a pass, a restart or a rebuilt card never asks again. The line is
// a proposal added to the card's words; nothing is sent.
import type { HqRoute } from '../../shared/hq-router'
import { hqIntakeRouteLine } from '../../shared/hq-slack-intake'
import { createDebouncedSingleFlight } from '../orca-plus/debounced-single-flight'
import { claudeBackgroundAllows } from '../claude-limit-guard/claude-background-gate'
import {
  HQ_CARD_ROUTES_PER_POLL,
  HQ_CARD_ROUTE_RETRY_MS,
  HQ_CARD_ROUTE_TRIES
} from './hq-card-route'
import type { HqIntakeDraft } from './hq-slack-intake-suggest'

const POLL_MS = 60_000
const FIRST_POLL_MS = 40_000

/** An open To work card of another reader's, as the sweep sees it. */
export type HqSweepCard = {
  id: string
  dedupeKey: string | null
  title: string
  body: string | null
  refId: string | null
  createdAt: number
}

export type HqRouterSweepDeps = {
  /** Open cards of the kinds that have no route of their own. */
  cards: () => HqSweepCard[]
  /** What the router reads of a card; null when the card names nothing to route. */
  draftOf: (card: HqSweepCard) => HqIntakeDraft | null
  route: (draft: HqIntakeDraft) => Promise<HqRoute | null>
  cardRoute: (key: string) => { route: HqRoute | null; at: number; tries: number } | null
  saveCardRoute: (key: string, route: HqRoute | null, at: number) => void
  setBody: (id: string, body: string) => void
  now: () => number
  noteCard?: (key: string, outcome: string) => void
}

const SLACK_CHANNEL = /^[CDG][A-Z0-9]{6,}$/

function parsed(refId: string | null): Record<string, unknown> | null {
  try {
    const value: unknown = refId ? JSON.parse(refId) : null
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** A scout request as the router reads it: a Slack thread (`channel:thread`) or a ClickUp task
 *  (`clickup:<id>`), with the card's own words as the text. Null when its id names neither. */
export function hqSweepDraftOf(card: HqSweepCard): HqIntakeDraft | null {
  const ref = parsed(card.refId)
  const id = typeof ref?.id === 'string' ? ref.id : ''
  const [first, second] = id.split(':')
  const link = typeof ref?.link === 'string' ? ref.link : null
  const slack = SLACK_CHANNEL.test(first ?? '') && !!second
  if (!slack && !(first === 'clickup' && second)) {
    return null
  }
  const author = /^([^:]{1,60}):\s/.exec(card.title)?.[1] ?? 'Someone'
  return {
    channel: slack ? first : 'clickup',
    ts: second,
    threadTs: null,
    author,
    authorSlackId: null,
    venue: slack
      ? first.startsWith('D')
        ? 'dm'
        : first.startsWith('G')
          ? 'group'
          : 'channel'
      : 'channel',
    text: [card.title, card.body ?? ''].join('\n').slice(0, 3_500),
    links: link ? [link] : [],
    files: [],
    permalink: link,
    at: card.createdAt
  }
}

/** One pass: adds the route line to the cards without one; returns how many cards were routed by a call. */
export async function sweepHqCardRoutes(deps: HqRouterSweepDeps): Promise<number> {
  let calls = 0
  for (const card of deps.cards()) {
    const key = `card:${card.dedupeKey ?? card.id}`
    const known = deps.cardRoute(key)
    let route = known?.route ?? null
    if (!route) {
      if (
        calls >= HQ_CARD_ROUTES_PER_POLL ||
        (known &&
          (known.tries >= HQ_CARD_ROUTE_TRIES || deps.now() - known.at < HQ_CARD_ROUTE_RETRY_MS))
      ) {
        continue
      }
      const draft = deps.draftOf(card)
      if (!draft) {
        continue
      }
      calls += 1
      const asked = await deps.route(draft).catch(() => undefined)
      if (asked === undefined) {
        continue
      }
      route = asked
      deps.saveCardRoute(key, route, deps.now())
      deps.noteCard?.(key, route ? `routed ${route.how} → ${route.target}` : 'no route')
    }
    if (route) {
      const line = hqIntakeRouteLine({ ...route, auto: false })
      const body = card.body ?? ''
      if (!body.includes(line)) {
        deps.setBody(card.id, body ? `${body}\n${line}` : line)
      }
    }
  }
  return calls
}

export function startHqRouterSweep(deps: HqRouterSweepDeps): () => void {
  const flight = createDebouncedSingleFlight(
    async () => {
      if (claudeBackgroundAllows('Router sweep')) {
        await sweepHqCardRoutes(deps)
      }
    },
    (error) => console.warn('[hq-router-sweep] pass failed:', error),
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
