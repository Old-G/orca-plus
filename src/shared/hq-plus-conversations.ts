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
import { HQ_WAITING_REPLY_KIND, readHqWaitingReplyRef } from './hq-waiting-reply-bell'
import type { PulseInboxItem } from './pulse-types'
import {
  HQ_PLUS_ANY_ROOM,
  hqPlusLog,
  type HqPlusCard,
  type HqPlusDone,
  type HqPlusLogItem
} from './hq-plus-log'
import type { HqFeedResult } from './hq-plus-screen'
import {
  hqPlusTranscript,
  readHqFeedLedger,
  type HqFeedConversation,
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

/** The conversation told from its cards, when the ledger has no messages of it. */
function messagesOfParts(members: readonly HqPlusLogItem[]): HqFeedMessage[] {
  const said: HqFeedMessage[] = []
  for (const item of members) {
    if (item.kind !== 'card' || !item.inbox) {
      continue
    }
    const answer =
      item.inbox.kind === HQ_WAITING_REPLY_KIND ? readHqWaitingReplyRef(item.inbox.refId) : null
    if (answer) {
      said.push({
        direction: 'out',
        author: null,
        text: answer.asked || answer.question,
        link: null,
        at: answer.askedAt
      })
      said.push({
        direction: 'in',
        author: answer.author,
        text: answer.reply,
        link: answer.link,
        at: item.at
      })
    }
    const intake = item.inbox.kind === HQ_INTAKE_KIND ? readHqIntake(item.inbox.refId) : null
    if (intake) {
      said.push({
        direction: 'in',
        author: intake.author,
        text: intake.text,
        link: intake.permalink,
        at: intake.lastAt ?? intake.at
      })
    }
  }
  const seen = new Set<string>()
  return said
    .filter((message) => {
      const key = `${message.direction}:${message.text}`
      return seen.has(key) ? false : (seen.add(key), true)
    })
    .sort((a, b) => a.at - b.at)
}

/** Keeps the owner's question in view: the ledger saw the answer, not always what was asked. */
function withAsked(
  messages: readonly HqFeedMessage[],
  members: readonly HqPlusLogItem[]
): HqFeedMessage[] {
  if (messages.some((message) => message.direction === 'out')) {
    return [...messages]
  }
  const asked = messagesOfParts(members).find((message) => message.direction === 'out')
  return asked ? [asked, ...messages] : [...messages]
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
 * one card at its newest moment; a single row with no conversation stays as it was.
 */
export function hqPlusFoldConversations(
  items: readonly HqPlusLogItem[],
  entries: readonly HqJournalEntry[],
  ledger: HqFeedLedger
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
  for (const item of items) {
    const key = placeOf(item, entryById, places)
    if (key) {
      keyOfItem.set(item, key)
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
  }
  const folded = new Map<string, HqPlusCard>()
  for (const [key, members] of groups) {
    const conversation = byKey.get(key) ?? null
    if (!conversation && members.length < 2) {
      continue
    }
    folded.set(key, conversationCard(key, conversation, members))
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
  return out.sort((a, b) => a.at - b.at)
}

function conversationCard(
  key: string,
  conversation: HqFeedConversation | null,
  members: readonly HqPlusLogItem[]
): HqPlusCard {
  const cards = members.filter((item): item is HqPlusCard => item.kind === 'card')
  const parts = cards.filter((card) => card.open)
  const newest = Math.max(...members.map((item) => item.at))
  const messages = conversation?.messages.length
    ? withAsked(conversation.messages, members)
    : messagesOfParts(members)
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
      link
    }
  }
}

/** The day's log of one `hq.feed` result, folded by conversation when the host sent its ledger. */
export function hqPlusFeedLog(
  feed: HqFeedResult,
  since: number,
  options: Parameters<typeof hqPlusLog>[3] = {}
): HqPlusLogItem[] {
  const items = hqPlusLog(feed.entries, feed.inbox ?? [], since, options)
  const ledger = readHqFeedLedger(feed.ledger)
  return ledger ? hqPlusFoldConversations(items, feed.entries, ledger) : items
}
