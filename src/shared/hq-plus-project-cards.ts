// Custom build (hq-project-cards): HQ+'s feed as one card per project (owner, 31.10: 1A, 2A) — what waits
// on the owner as one line per conversation (the line opens to the card itself), whom we wait for, what
// was done today (sent, deleted, pushed, merged, shipped) and the project's open chats. The desktop's
// feed, the Map's panel and the phone build their cards here, so all three show the same card.
import type { HqJournalEntry } from './hq-journal'
import { hqPlusIsFyi, hqPlusNeedsOwner } from './hq-plus-kinds'
import type { HqPlusLogItem } from './hq-plus-log'
import {
  hqPlusProjectLine,
  type HqPlusProjectChat,
  type HqPlusProjectChatInput,
  type HqPlusProjectChatLine,
  type HqPlusProjectLine
} from './hq-plus-project-lines'
import { hqPlusProjectToday, type HqPlusProjectToday } from './hq-plus-project-today'
import {
  HQ_PLUS_MAP_UNSORTED,
  hqPlusMapProjectOf,
  type HqPlusMapChatState,
  type HqPlusMapWait
} from './hq-plus-map'

export const HQ_PLUS_PROJECT_FILTERS = ['all', 'move', 'wait', 'fyi'] as const
export type HqPlusProjectFilter = (typeof HQ_PLUS_PROJECT_FILTERS)[number]

export function isHqPlusProjectFilter(value: unknown): value is HqPlusProjectFilter {
  return HQ_PLUS_PROJECT_FILTERS.some((filter) => filter === value)
}

export type HqPlusProjectPerson = {
  name: string
  /** Oldest first. */
  waits: HqPlusMapWait[]
  oldestAt: number
}

export type HqPlusProjectCard = {
  slug: string
  /** Conversations from outside nobody placed; each line has a project picker. */
  unsorted: boolean
  /** Longest waiting first. */
  you: HqPlusProjectLine[]
  /** Newest first. */
  fyi: HqPlusProjectLine[]
  /** Longest waiting first; a waiting that was answered is a green line under «Your move» instead. */
  persons: HqPlusProjectPerson[]
  waits: number
  oldestWaitAt: number | null
  /** Newest first. */
  today: HqPlusProjectToday[]
  /** Asks, working, done, quiet; newest first within each. */
  chats: HqPlusProjectChat[]
  lastAt: number
  /** Only we wait here: the card is one line. */
  compact: boolean
  /** The chats ⌘F found words in; their section opens. */
  chatHits: string[]
  /** The sections the filter shows. */
  shown: { you: boolean; fyi: boolean; wait: boolean; today: boolean; chats: boolean }
}

export type HqPlusProjectFeed = {
  cards: HqPlusProjectCard[]
  /** For the chips: lines on the owner, waits on people, FYI lines. */
  counts: { move: number; wait: number; fyi: number }
  /** «All» folds FYI into one row at the bottom: the projects and their newest line. */
  fyi: { slug: string; count: number; what: string }[]
}

export type HqPlusProjectInput = {
  /** The room's rows, as the feed shows them (chats folded, live chats added). */
  items: readonly HqPlusLogItem[]
  /** Waits on people in the room. */
  waits: readonly HqPlusMapWait[]
  chats: readonly HqPlusProjectChatInput[]
  /** The room's journal rows; today's sends, deletes, merges and releases come from them. */
  entries: readonly HqJournalEntry[]
  /** Where today starts. */
  since: number
}

/** Where HQ's own rows (reports, a chat's question with no project) stand. */
const HQ_OWN = 'HQ'
const CHAT_ORDER: readonly HqPlusMapChatState[] = ['asks', 'working', 'done', 'quiet']
function emptyCard(slug: string): HqPlusProjectCard {
  return {
    slug,
    unsorted: slug === HQ_PLUS_MAP_UNSORTED,
    you: [],
    fyi: [],
    persons: [],
    waits: 0,
    oldestWaitAt: null,
    today: [],
    chats: [],
    lastAt: 0,
    compact: false,
    chatHits: [],
    shown: { you: true, fyi: false, wait: true, today: true, chats: true }
  }
}

/**
 * Every project that has anything going on, unfiltered and unordered — the Map's panel picks one by
 * slug. A project's card holds its lines, waits, today's work and every open chat of it.
 */
export function hqPlusProjectCards(input: HqPlusProjectInput): HqPlusProjectCard[] {
  const bySlug = new Map<string, HqPlusProjectCard>()
  const cardOf = (slug: string): HqPlusProjectCard => {
    let card = bySlug.get(slug)
    if (!card) {
      card = emptyCard(slug)
      bySlug.set(slug, card)
    }
    return card
  }
  const chatLines = new Map<string, HqPlusProjectChatLine>()
  for (const item of input.items) {
    if (item.kind === 'line' && item.tone === 'agent' && item.sessionId) {
      const known = chatLines.get(item.sessionId)
      if (!known || known.at <= item.at) {
        chatLines.set(item.sessionId, item)
      }
    }
    if (item.kind !== 'card') {
      continue
    }
    if (hqPlusNeedsOwner(item)) {
      cardOf(hqPlusMapProjectOf(item)).you.push(hqPlusProjectLine(item))
    } else if (hqPlusIsFyi(item)) {
      cardOf(hqPlusMapProjectOf(item)).fyi.push(hqPlusProjectLine(item))
    }
  }
  const people = new Map<HqPlusProjectCard, Map<string, HqPlusMapWait[]>>()
  for (const wait of input.waits) {
    // Why: an answered waiting is its answer's green line under «Your move», not a wait any more.
    if (wait.answerId) {
      continue
    }
    const card = cardOf(wait.project ?? HQ_OWN)
    const byName = people.get(card) ?? new Map<string, HqPlusMapWait[]>()
    const name = wait.personName ?? 'Someone'
    byName.set(name, [...(byName.get(name) ?? []), wait])
    people.set(card, byName)
  }
  for (const entry of input.entries) {
    const done = entry.at >= input.since ? hqPlusProjectToday(entry) : null
    if (done) {
      cardOf(entry.project ?? HQ_OWN).today.push(done)
    }
  }
  for (const chat of input.chats) {
    cardOf(chat.project ?? HQ_OWN).chats.push({
      ...chat,
      line: chat.sessionId ? (chatLines.get(chat.sessionId) ?? null) : null
    })
  }
  for (const card of bySlug.values()) {
    card.you.sort((a, b) => a.since - b.since)
    card.fyi.sort((a, b) => b.at - a.at)
    card.persons = [...(people.get(card) ?? new Map<string, HqPlusMapWait[]>()).entries()]
      .map(([name, waits]) => {
        const sorted = waits.toSorted((a, b) => a.at - b.at)
        return { name, waits: sorted, oldestAt: sorted[0]?.at ?? 0 }
      })
      .sort((a, b) => a.oldestAt - b.oldestAt)
    card.waits = card.persons.reduce((sum, person) => sum + person.waits.length, 0)
    card.oldestWaitAt = card.persons[0]?.oldestAt ?? null
    card.today.sort((a, b) => b.at - a.at)
    card.chats.sort(
      (a, b) => CHAT_ORDER.indexOf(a.state) - CHAT_ORDER.indexOf(b.state) || b.at - a.at
    )
    const busy = card.chats.filter((chat) => chat.state !== 'quiet')
    card.lastAt = Math.max(
      0,
      ...card.you.map((line) => line.at),
      ...card.today.map((row) => row.at),
      ...busy.map((chat) => Math.max(chat.at, chat.line?.at ?? 0))
    )
    card.compact =
      card.waits > 0 && card.you.length === 0 && card.today.length === 0 && busy.length === 0
  }
  return [...bySlug.values()]
}

/** What the card is in the feed for: a line on the owner, a wait, today's work or a busy chat. */
function inAll(card: HqPlusProjectCard): boolean {
  return (
    card.you.length > 0 ||
    card.waits > 0 ||
    card.today.length > 0 ||
    card.chats.some((chat) => chat.state !== 'quiet')
  )
}

function shownBy(filter: HqPlusProjectFilter): HqPlusProjectCard['shown'] {
  return {
    you: filter === 'all' || filter === 'move',
    fyi: filter === 'fyi',
    wait: filter === 'all' || filter === 'wait',
    today: filter === 'all',
    chats: filter === 'all'
  }
}

/** The order the owner reads in: his move, longest waiting first; then work and chats, newest first;
 *  then projects where we only wait, longest first; Unsorted last. */
function rank(card: HqPlusProjectCard): [number, number] {
  if (card.unsorted) {
    return [3, -card.lastAt]
  }
  if (card.you.length > 0) {
    return [0, Math.min(...card.you.map((line) => line.since))]
  }
  return card.compact ? [2, card.oldestWaitAt ?? 0] : [1, -card.lastAt]
}

/**
 * The feed: the room's project cards for one chip, in reading order. A filter hides the sections it
 * does not show, and a card left with nothing to show leaves the feed. `matches` narrows the lines to
 * the ones ⌘F found; a card whose name matches keeps them all.
 */
export function hqPlusProjectFeed(
  input: HqPlusProjectInput & {
    filter: HqPlusProjectFilter
    search?: { query: string; matches: (item: HqPlusLogItem) => boolean } | null
  }
): HqPlusProjectFeed {
  const all = hqPlusProjectCards(input)
  const counts = {
    move: all.reduce((sum, card) => sum + card.you.length, 0),
    wait: all.reduce((sum, card) => sum + card.waits, 0),
    fyi: all.reduce((sum, card) => sum + card.fyi.length, 0)
  }
  const fyi = all
    .filter((card) => card.fyi.length > 0)
    .sort((a, b) => b.fyi[0].at - a.fyi[0].at)
    .map((card) => ({ slug: card.slug, count: card.fyi.length, what: card.fyi[0].what }))
  const query = input.search?.query.trim().toLocaleLowerCase() ?? ''
  const cards = all
    .flatMap((card): HqPlusProjectCard[] => {
      const shown = shownBy(input.filter)
      const found =
        query && !card.slug.toLocaleLowerCase().includes(query)
          ? (lines: HqPlusProjectLine[]) =>
              lines.filter((line) => input.search?.matches(line.card) ?? true)
          : null
      const next: HqPlusProjectCard = {
        ...card,
        you: found ? found(card.you) : card.you,
        fyi: found ? found(card.fyi) : card.fyi,
        // Why: on «We wait» and FYI every card opens to what the chip shows.
        compact: card.compact && input.filter === 'all',
        shown
      }
      // Why: a chat whose reply has the words keeps its project, as the old feed kept the chat's row,
      // and its chats open so the reply is in view.
      next.chatHits = query
        ? card.chats.flatMap((chat) =>
            chat.line && input.search?.matches(chat.line) ? [chat.key] : []
          )
        : []
      if (found && next.you.length + next.fyi.length === 0 && next.chatHits.length === 0) {
        return []
      }
      const keep =
        input.filter === 'all'
          ? inAll(next)
          : input.filter === 'move'
            ? next.you.length > 0
            : input.filter === 'wait'
              ? next.waits > 0
              : next.fyi.length > 0
      return keep ? [next] : []
    })
    .sort((a, b) => {
      // Why: FYI is news; the newest goes first.
      if (input.filter === 'fyi') {
        return (b.fyi[0]?.at ?? 0) - (a.fyi[0]?.at ?? 0)
      }
      const [groupA, keyA] = rank(a)
      const [groupB, keyB] = rank(b)
      return groupA - groupB || keyA - keyB || a.slug.localeCompare(b.slug)
    })
  return { cards, counts, fyi }
}

/** The card the Map's panel shows for a project, with every section, never folded to a line. */
export function hqPlusProjectCardOf(input: HqPlusProjectInput, slug: string): HqPlusProjectCard {
  const card = hqPlusProjectCards(input).find((candidate) => candidate.slug === slug)
  return {
    ...(card ?? emptyCard(slug)),
    compact: false,
    shown: { you: true, fyi: true, wait: true, today: true, chats: true }
  }
}

/** «2 asks you · 1 working» — the chats' states, for the folded Chats line. */
export function hqPlusProjectChatSummary(chats: readonly HqPlusProjectChatInput[]): string {
  const label: Record<HqPlusMapChatState, string> = {
    asks: 'asks you',
    working: 'working',
    done: 'done',
    quiet: 'quiet'
  }
  return CHAT_ORDER.flatMap((state) => {
    const count = chats.filter((chat) => chat.state === state).length
    return count > 0 ? [`${count} ${label[state]}`] : []
  }).join(' · ')
}

/** «Ann 2 · Bob 1 — oldest 4 d»: whom we wait for, folded. */
export function hqPlusProjectWaitSummary(card: HqPlusProjectCard, now: number): string {
  const names = card.persons.map((person) => `${person.name} ${person.waits.length}`).join(' · ')
  return card.oldestWaitAt === null
    ? names
    : `${names} — oldest ${hqPlusProjectAge(card.oldestWaitAt, now)}`
}

/** «today», «3 h», «4 d» — how long something waits. */
export function hqPlusProjectAge(at: number, now: number): string {
  const hours = Math.max(0, Math.floor((now - at) / 3_600_000))
  if (hours < 1) {
    return `${Math.max(1, Math.floor((now - at) / 60_000))} min`
  }
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`
}
