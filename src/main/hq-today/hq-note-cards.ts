// Custom build (hq-router T7b, owner 26.11): a Notes line that asks for work becomes one «To work» card
// with the router's «→ chat». One model call per line (the answer is kept by `note:<id>`), one card per
// line (its key is `router:note:<id>`, seen open or done for a week), and nothing is sent: the owner's
// «Send» does that.
import {
  HQ_INTAKE_TEXT_MAX,
  HQ_NOTE_CARD_KEY_PREFIX,
  HQ_NOTE_CHANNEL,
  hqIntakeBellItem,
  hqIntakeKey,
  type HqIntake
} from '../../shared/hq-slack-intake'
import type { HqFeedLedger } from '../../shared/hq-feed-ledger'
import type { PulseWaiting } from '../../shared/pulse-types'
import { INBOX_GONE_ACTION } from '../orca-plus/pulse/pulse-inbox'
import { createDebouncedSingleFlight } from '../orca-plus/debounced-single-flight'
import { claudeBackgroundAllows } from '../claude-limit-guard/claude-background-gate'
import { HQ_CARD_ROUTES_PER_POLL, routeCardOnce, type HqCardRouteDeps } from './hq-card-route'
import { hqIntakeFallbackSummary } from './hq-slack-intake-suggest'

const POLL_MS = 60_000
const FIRST_POLL_MS = 45_000

/** Notes lines from the owner or from a message — not an agent's own reminder to check something, which
 *  its chat already holds. */
export const HQ_NOTE_CARD_SOURCES: ReadonlySet<string> = new Set([
  'manual',
  'note',
  'slack-promise',
  'slack',
  'clickup'
])
/** A line older than this gets no card: a card is looked for among the bell items of the last 8 days,
 *  and a card is never older than its line, so one line never gets a second card. */
export const HQ_NOTE_CARD_WINDOW_MS = 7 * 24 * 60 * 60_000
/** How a card ends when its line was closed elsewhere. Not `gone`: the poll's sync would raise a `gone`
 *  card again, since it keeps a `router:` card for a week. */
export const HQ_NOTE_CARD_CLOSED_ACTION = 'note-closed'

/** The key the router keeps a line's answer under. */
export function hqNoteRouteKey(noteId: string): string {
  return `note:${noteId}`
}

/** Ids of the Notes lines that live in a ledger conversation which exists — that card is theirs, with
 *  its own route. A Slack link, ClickUp task or MR in a line's ref is not enough: with no conversation
 *  made from it, nothing else would carry the line. */
export function hqNotesInConversations(
  ledger: Pick<HqFeedLedger, 'waitingPlaces'> & { conversations: readonly { key: string }[] }
): Set<string> {
  const keys = new Set(ledger.conversations.map((conversation) => conversation.key))
  return new Set(
    Object.entries(ledger.waitingPlaces).flatMap(([id, key]) => (keys.has(key) ? [id] : []))
  )
}

/** An open line on the owner that nothing else carries yet: not an agent's reminder, not one a chat
 *  already holds (every `orca pulse wait add` from a chat names its chat) and not one a ledger
 *  conversation carries. `carried` is read only for a line that passed the rest. */
export function hqNoteIsOrphan(note: PulseWaiting, carried: () => ReadonlySet<string>): boolean {
  return (
    note.status === 'open' &&
    note.direction === 'on-me' &&
    HQ_NOTE_CARD_SOURCES.has(note.source) &&
    !note.agentSessionId &&
    !carried().has(note.id)
  )
}

/** An orphan line young enough to be taken up. */
export function hqNoteWantsCard(
  note: PulseWaiting,
  now: number,
  carried: () => ReadonlySet<string>
): boolean {
  return now - note.createdAt <= HQ_NOTE_CARD_WINDOW_MS && hqNoteIsOrphan(note, carried)
}

/** The card for a line, before it has a route. `ts` is the line's id. */
export function hqNoteIntake(
  note: Pick<PulseWaiting, 'id' | 'title' | 'detail' | 'sourceRef' | 'project'>,
  author: string | null,
  now: number
): HqIntake {
  const text = [note.title, note.detail ?? ''].join('\n').trim().slice(0, HQ_INTAKE_TEXT_MAX)
  return {
    channel: HQ_NOTE_CHANNEL,
    ts: note.id,
    threadTs: null,
    author: author ?? 'Note',
    authorSlackId: null,
    venue: 'channel',
    text,
    links: [...new Set(text.match(/https?:\/\/[^\s<>"')]+/g) ?? [])],
    files: [],
    permalink: note.sourceRef && /^https?:\/\//.test(note.sourceRef) ? note.sourceRef : null,
    // Why now: the card lives a week from when it was raised, like a pasted one.
    at: now,
    // Why: the poll keeps a `router:` card with no mark behind it, as it keeps a pasted one.
    pasted: true,
    repoId: null,
    project: note.project,
    summary: hqIntakeFallbackSummary(note.title)
  }
}

/** Keys of the cards raised and kept: open, or handled by the owner. A card the poll closed by itself
 *  (`gone`, a race with its sync) is not kept — it is raised again, from the route already known. */
export function hqNoteRaisedKeys(
  items: readonly { dedupeKey: string | null; doneAt: number | null; doneAction: string | null }[]
): Set<string> {
  return new Set(
    items.flatMap((item) =>
      item.dedupeKey && !(item.doneAt !== null && item.doneAction === INBOX_GONE_ACTION)
        ? [item.dedupeKey]
        : []
    )
  )
}

export type HqNoteCardDeps = HqCardRouteDeps & {
  /** Open Notes lines on the owner. */
  notes: () => PulseWaiting[]
  /** Ids of the lines a ledger conversation carries; read once a pass, and only when a line needs it. */
  carried: () => ReadonlySet<string>
  personName: (personId: string) => string | null
  /** Dedupe keys of the «To work» cards raised in the last 8 days, open or handled. */
  raised: () => ReadonlySet<string>
  /** Open «To work» cards that stand for a line: item id and dedupe key. */
  openCards: () => { id: string; dedupeKey: string }[]
  addCard: (intake: HqIntake) => void
  closeCard: (id: string, action: string) => void
}

/** One pass: a card for each line that wants one and has a route, and the end of a card whose line is
 *  no longer open or is carried elsewhere. Returns how many lines the router was asked about. */
export async function raiseHqNoteCards(deps: HqNoteCardDeps): Promise<number> {
  const notes = deps.notes()
  let carriedIds: ReadonlySet<string> | null = null
  const carried = () => (carriedIds ??= deps.carried())
  // Why: a card ends with its line — and when its line gained a chat or a conversation, which carry it now.
  const openIds = new Set(
    notes
      .filter((note) => hqNoteIsOrphan(note, carried))
      .map((note) => `${HQ_NOTE_CARD_KEY_PREFIX}${note.id}`)
  )
  for (const card of deps.openCards()) {
    if (card.dedupeKey.startsWith(HQ_NOTE_CARD_KEY_PREFIX) && !openIds.has(card.dedupeKey)) {
      deps.closeCard(card.id, HQ_NOTE_CARD_CLOSED_ACTION)
    }
  }
  const raised = new Set(deps.raised())
  const budget = { left: HQ_CARD_ROUTES_PER_POLL }
  const start = budget.left
  const now = deps.now()
  for (const note of [...notes].sort((a, b) => a.createdAt - b.createdAt)) {
    if (!hqNoteWantsCard(note, now, carried)) {
      continue
    }
    const card = hqNoteIntake(note, note.personId ? deps.personName(note.personId) : null, now)
    const cardKey = hqIntakeBellItem(card).dedupeKey
    if (!cardKey || raised.has(cardKey)) {
      continue
    }
    const route = await routeCardOnce(deps, hqNoteRouteKey(note.id), card, budget)
    if (!route) {
      continue
    }
    deps.addCard({
      ...card,
      route,
      repoId: route.repoId ?? null,
      project: card.project ?? route.project ?? null
    })
    raised.add(cardKey)
    deps.noteMark?.(hqIntakeKey(card), `routed ${route.how} → ${route.target} (note)`)
  }
  return start - budget.left
}

export function startHqNoteCards(deps: HqNoteCardDeps): () => void {
  const flight = createDebouncedSingleFlight(
    async () => {
      if (claudeBackgroundAllows('Router notes')) {
        await raiseHqNoteCards(deps)
      }
    },
    (error) => console.warn('[hq-note-cards] pass failed:', error),
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
