// Custom build (hq-ledger-feed): HQ+'s feed by conversations — every card and line of one Slack thread,
// ClickUp task or MR (the mention, the person's answer, «No answer» reminders, the waiting's own rows)
// folds into one card that shows the conversation and sits at its newest message. The folded cards
// keep their own buttons inside it.
import type { HqJournalEntry } from './hq-journal'
import { HQ_JOURNAL_KIND } from './hq-journal'
import { hqPlaceKey } from './hq-ledger'
import { HQ_ROUTING_KIND } from './hq-routing'
import { HQ_INTAKE_KIND, readHqIntake } from './hq-slack-intake'
import { HQ_SLACK_REQUEST_BELL_KIND } from './hq-slack-request-bell'
import { HQ_REMIND_KIND } from './hq-remind'
import {
  HQ_WAITING_REPLY_KIND,
  readHqWaitingReplyRef,
  type HqWaitingReplyRef
} from './hq-waiting-reply-bell'
import { hqPlusAnswerOf, hqPlusMessagesLeft } from './hq-plus-answer-split'
import { messagesOfParts, withAsked } from './hq-plus-conversation-messages'
import type { PulseInboxItem } from './pulse-types'
import {
  HQ_PLUS_ANY_ROOM,
  hqPlusLog,
  type HqPlusCard,
  type HqPlusDone,
  type HqPlusLogItem
} from './hq-plus-log'
import type { HqFeedResult } from './hq-plus-screen'
import { hqPlusLedgerOnlyCards } from './hq-plus-ledger-cards'
import {
  hqPlusTranscript,
  readHqFeedLedger,
  type HqFeedConversation,
  type HqFeedGuess,
  type HqFeedLedger,
  type HqFeedMessage
} from './hq-feed-ledger'

export type HqPlusConversation = {
  key: string
  title: string
  /** The small model picked the project; the owner has not confirmed it. */
  guessed: boolean
  messages: HqFeedMessage[]
  /** The open cards folded in, oldest first; each keeps its own buttons. */
  parts: HqPlusCard[]
  /** Where the conversation is: its newest message's link, else a folded card's. */
  link: string | null
  /** Custom build (hq-ledger-sources): set on a GitLab MR or a mail thread no card stands for — the
   *  ledger's own word on it, the owner's move or news; its card opens the place or says Done. */
  ledgerState?: 'you' | 'fyi'
  /** Custom build (hq-intake-decide): the chat the model proposed, not judged yet. */
  guess?: HqFeedGuess | null
  /** Custom build (hq-in-work): its ledger id, when the ledger knows it. */
  id?: string
  /** Custom build (hq-in-work): a chat already does it — the card says so instead of asking. */
  inWork?: boolean
  /** Custom build (hq-plus-one-request): bell items of the person's earlier messages here; the newest
   *  request stands for them all, and deciding it closes them too. */
  earlierRequests?: string[]
}

/** Journal rows that only tell what a conversation's cards already show. */
const FOLDED_LINES: ReadonlySet<string> = new Set([
  HQ_JOURNAL_KIND.waitingOpen,
  HQ_JOURNAL_KIND.waitingDone,
  HQ_JOURNAL_KIND.personReply,
  HQ_ROUTING_KIND.action
])

function refLink(refId: string | null): string | null {
  try {
    const parsed: unknown = refId ? JSON.parse(refId) : null
    const link: unknown =
      parsed && typeof parsed === 'object'
        ? (Reflect.get(parsed, 'link') ?? Reflect.get(parsed, 'permalink'))
        : null
    return typeof link === 'string' ? link : null
  } catch {
    return null
  }
}

type Places = {
  waiting: (id: string | null) => string | null
  conversation: (id: string) => string | null
}

function placeOfInbox(item: PulseInboxItem, places: Places): string | null {
  switch (item.kind) {
    case HQ_INTAKE_KIND: {
      const intake = readHqIntake(item.refId)
      if (!intake) {
        return null
      }
      const known = intake.conversationId ? places.conversation(intake.conversationId) : null
      return known ?? `slack:${intake.channel}:${intake.threadTs ?? intake.ts}`
    }
    case HQ_WAITING_REPLY_KIND:
      return places.waiting(readHqWaitingReplyRef(item.refId)?.waitingId ?? null)
    case HQ_REMIND_KIND:
      return places.waiting(item.refId)
    case HQ_SLACK_REQUEST_BELL_KIND:
      return hqPlaceKey(refLink(item.refId))
    default:
      return null
  }
}

function placeOfEntry(entry: HqJournalEntry, places: Places): string | null {
  const waitingRef = entry.refKind === 'waiting' || entry.refKind === 'waiting-reply'
  return waitingRef ? places.waiting(entry.refId) : null
}

function placeOf(
  item: HqPlusLogItem,
  entryById: ReadonlyMap<string, HqJournalEntry>,
  places: Places
): string | null {
  if (item.kind === 'card') {
    if (item.inbox) {
      return placeOfInbox(item.inbox, places)
    }
    return item.type === 'wait' && item.entry ? placeOfEntry(item.entry, places) : null
  }
  if (item.kind !== 'line' || !item.journalKind || !FOLDED_LINES.has(item.journalKind)) {
    return null
  }
  const entry = entryById.get(item.id)
  return entry ? placeOfEntry(entry, places) : null
}

/** What a card is about, not who did what: «Ann replied» names the question it answers. */
function titleOfCard(card: HqPlusCard): string {
  const answer =
    card.inbox?.kind === HQ_WAITING_REPLY_KIND ? readHqWaitingReplyRef(card.inbox.refId) : null
  if (answer) {
    return answer.question
  }
  // Why: «No answer from Ann: …», «Ann waits on the owner: …» — the part after the colon.
  const said = /^[^:]{1,60}:\s+(.+)$/s.exec(card.title)
  return card.inbox?.kind === HQ_REMIND_KIND || card.type === 'wait'
    ? (said?.[1] ?? card.title)
    : card.title
}

/** Least to most wanted: a reminder, a request, a person's answer. */
const PART_ORDER: readonly string[] = [
  HQ_REMIND_KIND,
  HQ_SLACK_REQUEST_BELL_KIND,
  HQ_INTAKE_KIND,
  HQ_WAITING_REPLY_KIND
]

function doneOf(cards: readonly HqPlusCard[]): HqPlusDone {
  const decided = cards
    .flatMap((card) => (card.done ? [card.done] : []))
    .sort((a, b) => doneAt(b) - doneAt(a))
  return decided[0] ?? { by: 'status', status: 'closed' }
}

function doneAt(done: HqPlusDone): number {
  return done.by === 'status' ? 0 : (done.at ?? 0)
}

/**
 * Folds the log by conversation. A place with a ledger conversation, or with two or more rows, becomes
 * one card at its newest moment; a single row with no conversation stays as it was. Custom build
 * (hq-ledger-sources): an MR or a mail thread with no rows is a card of its own while it is the owner's
 * move (however old) or news since `since`.
 */
export function hqPlusFoldConversations(
  items: readonly HqPlusLogItem[],
  entries: readonly HqJournalEntry[],
  ledger: HqFeedLedger,
  since = 0
): HqPlusLogItem[] {
  const byKey = new Map(
    ledger.conversations.map((conversation) => [conversation.key, conversation])
  )
  const keyById = new Map(
    ledger.conversations.map((conversation) => [conversation.id, conversation.key])
  )
  const places: Places = {
    waiting: (id) => (id ? (ledger.waitingPlaces[id] ?? null) : null),
    conversation: (id) => keyById.get(id) ?? null
  }
  const entryById = new Map(entries.map((entry) => [entry.id, entry]))
  const groups = new Map<string, HqPlusLogItem[]>()
  const keyOfItem = new Map<HqPlusLogItem, string>()
  const answersOf = new Map<string, HqWaitingReplyRef[]>()
  for (const item of items) {
    const key = placeOf(item, entryById, places)
    if (key) {
      groups.set(key, [...(groups.get(key) ?? []), item])
      // Custom build (hq-plus-answer-cards): an answer stays its own card, beside its conversation.
      const answer = hqPlusAnswerOf(item)
      if (answer) {
        answersOf.set(key, [...(answersOf.get(key) ?? []), answer])
      } else {
        keyOfItem.set(item, key)
      }
    }
  }
  const folded = new Map<string, HqPlusCard>()
  for (const [key, all] of groups) {
    const conversation = byKey.get(key) ?? null
    const members = all.filter((item) => keyOfItem.has(item))
    if (members.length === 0 || (!conversation && members.length < 2)) {
      continue
    }
    const card = conversationCard(key, conversation, members, answersOf.get(key) ?? [])
    if (card) {
      folded.set(key, card)
    }
  }
  const out: HqPlusLogItem[] = []
  const placed = new Set<string>()
  for (const item of items) {
    const key = keyOfItem.get(item)
    const card = key ? folded.get(key) : undefined
    if (!key || !card) {
      out.push(item)
    } else if (!placed.has(key)) {
      placed.add(key)
      out.push(card)
    }
  }
  out.push(...hqPlusLedgerOnlyCards(ledger, groups, since))
  return out.sort((a, b) => a.at - b.at)
}

function conversationCard(
  key: string,
  conversation: HqFeedConversation | null,
  members: readonly HqPlusLogItem[],
  answers: readonly HqWaitingReplyRef[]
): HqPlusCard | null {
  const cards = members.filter((item): item is HqPlusCard => item.kind === 'card')
  const { parts, earlier } = oneRequest(cards)
  const newest = Math.max(...members.map((item) => item.at))
  const messages = hqPlusMessagesLeft(
    conversation?.messages.length
      ? withAsked(conversation.messages, members)
      : messagesOfParts(members),
    answers
  )
  // Why: once its answer cards show what she said, a conversation with nothing else open is no card.
  if (answers.length > 0 && parts.length === 0 && !messages.some((m) => m.direction === 'in')) {
    return null
  }
  const lastSaid = messages.at(-1)?.at ?? 0
  const placedIn = members.find((item) => item.room !== HQ_PLUS_ANY_ROOM)
  const titled = cards
    .toReversed()
    .map(titleOfCard)
    .find((title) => title)
  const link =
    messages.toReversed().find((message) => message.link)?.link ??
    cards.map((card) => refLink(card.inbox?.refId ?? null)).find(Boolean) ??
    null
  const open = parts.length > 0
  // Why: the phone and ⌘F read a card's body and bell item; here they are the conversation itself and
  // the card that most wants the owner (an answer, a request, then the rest).
  const primary =
    PART_ORDER.flatMap((kind) => parts.filter((part) => part.inbox?.kind === kind)).at(-1) ??
    parts.at(-1) ??
    null
  return {
    kind: 'card',
    id: `conv:${key}`,
    // Why: the conversation stands where its newest message is (owner, 30.10: newest at the bottom).
    at: Math.max(newest, lastSaid),
    room: placedIn?.room ?? HQ_PLUS_ANY_ROOM,
    project: conversation?.project ?? members.find((item) => item.project)?.project ?? null,
    address: null,
    sessionId: conversation?.sessionId ?? cards.find((card) => card.sessionId)?.sessionId ?? null,
    type: 'conversation',
    title: conversation?.title ?? titled ?? key,
    body: hqPlusTranscript(messages),
    report: null,
    open,
    done: open ? null : doneOf(cards),
    entry: primary?.entry ?? null,
    inbox: primary?.inbox ?? null,
    conversation: {
      key,
      title: conversation?.title ?? titled ?? key,
      guessed: conversation?.projectHow === 'model',
      messages,
      parts,
      link,
      guess: conversation?.guess ?? null,
      id: conversation?.id,
      inWork: conversation?.stateWhy === 'in-work',
      ...(earlier.length > 0 ? { earlierRequests: earlier } : {})
    }
  }
}

/**
 * Custom build (hq-plus-one-request): three comments in one task are three requests, and each drew its
 * own Reply / To work / Done (owner 06.11). One talk asks once: the newest request keeps the buttons,
 * the earlier ones are only messages above it.
 */
function oneRequest(cards: readonly HqPlusCard[]): { parts: HqPlusCard[]; earlier: string[] } {
  const requests = cards.filter((card) => card.inbox?.kind === HQ_SLACK_REQUEST_BELL_KIND)
  const newest = requests.reduce<HqPlusCard | null>(
    (kept, card) => (!kept || card.at >= kept.at ? card : kept),
    null
  )
  // Why: decided or not, the newest request speaks for the talk; earlier open ones wait on it.
  const earlier = requests.filter((card) => card !== newest && card.open)
  return {
    parts: cards.filter((card) => card.open && !earlier.includes(card)),
    earlier: earlier.flatMap((card) => (card.inbox ? [card.inbox.id] : []))
  }
}

/** The day's rows of one `hq.feed` result, before they fold by conversation. */
export function hqPlusFeedRows(
  feed: HqFeedResult,
  since: number,
  options: Parameters<typeof hqPlusLog>[3] = {}
): HqPlusLogItem[] {
  return hqPlusLog(feed.entries, feed.inbox ?? [], since, options)
}

/** The day's rows folded by conversation, when the host sent its ledger. */
export function hqPlusFoldFeed(
  feed: HqFeedResult,
  rows: readonly HqPlusLogItem[],
  since: number
): HqPlusLogItem[] {
  const ledger = readHqFeedLedger(feed.ledger)
  return ledger ? hqPlusFoldConversations(rows, feed.entries, ledger, since) : [...rows]
}

/** The day's log of one `hq.feed` result, folded by conversation when the host sent its ledger. */
export function hqPlusFeedLog(
  feed: HqFeedResult,
  since: number,
  options: Parameters<typeof hqPlusLog>[3] = {}
): HqPlusLogItem[] {
  return hqPlusFoldFeed(feed, hqPlusFeedRows(feed, since, options), since)
}
