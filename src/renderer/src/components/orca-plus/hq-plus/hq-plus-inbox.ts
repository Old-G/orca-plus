// Custom build (hq-plus-inbox, owner 02.11: variant B; 04.11: one stream): the project cards' rows as one
// stream, oldest first, so the newest is at the bottom. A section the chip above the feed
// hides on the cards stays out of the queue too, and the FYI chip lists its rows.
import type {
  HqPlusProjectFeed,
  HqPlusProjectPerson
} from '../../../../../shared/hq-plus-project-cards'
import type { HqPlusProjectToday } from '../../../../../shared/hq-plus-project-today'
import type {
  HqPlusProjectChat,
  HqPlusProjectLine
} from '../../../../../shared/hq-plus-project-lines'

type Placed<T> = { slug: string; unsorted: boolean } & T

export type HqPlusInboxQueue = {
  approve: Placed<{ line: HqPlusProjectLine }>[]
  asks: Placed<{ chat: HqPlusProjectChat }>[]
  moves: Placed<{ line: HqPlusProjectLine }>[]
  fyi: Placed<{ line: HqPlusProjectLine }>[]
  working: Placed<{ chat: HqPlusProjectChat }>[]
  persons: Placed<{ person: HqPlusProjectPerson }>[]
  today: Placed<{ row: HqPlusProjectToday }>[]
  waits: number
  /** Everything above as one stream, oldest first: the newest row is the last one (owner 04.11). */
  stream: HqPlusInboxRow[]
}

/** A row of the stream; `at` is when it came to the owner. What he already approved stays out: it is
 *  in «Done today», and in the feed it was a wall of sent messages he can read in Slack (owner 04.11). */
export type HqPlusInboxRow =
  | Placed<{ type: 'approve'; at: number; line: HqPlusProjectLine }>
  | Placed<{ type: 'ask'; at: number; chat: HqPlusProjectChat }>
  | Placed<{ type: 'move' | 'fyi'; at: number; line: HqPlusProjectLine }>

export function hqPlusInboxQueue(feed: HqPlusProjectFeed): HqPlusInboxQueue {
  const queue = hqPlusInboxSections(feed)
  const stream: HqPlusInboxRow[] = [
    ...queue.approve.map((e) => ({ ...e, type: 'approve' as const, at: e.line.since })),
    ...queue.asks.map((e) => ({
      ...e,
      type: 'ask' as const,
      at: e.chat.question?.since ?? e.chat.at
    })),
    ...queue.moves.map((e) => ({ ...e, type: 'move' as const, at: e.line.since })),
    ...queue.fyi.map((e) => ({ ...e, type: 'fyi' as const, at: e.line.at }))
  ]
  return { ...queue, stream: stream.sort((a, b) => a.at - b.at) }
}

function hqPlusInboxSections(feed: HqPlusProjectFeed): Omit<HqPlusInboxQueue, 'stream'> {
  const place = (card: HqPlusProjectFeed['cards'][number]) => ({
    slug: card.slug,
    unsorted: card.unsorted
  })
  const cards = feed.cards
  const asks = (chat: HqPlusProjectChat): boolean => chat.question !== null || chat.state === 'asks'
  // Why: a chat asks since its question came, or since it last spoke when it asks without one.
  const askedAt = (chat: HqPlusProjectChat): number => chat.question?.since ?? chat.at
  return {
    approve: cards
      .flatMap((card) =>
        card.shown.approve ? card.approve.map((line) => ({ ...place(card), line })) : []
      )
      .sort((a, b) => a.line.since - b.line.since),
    asks: cards
      .flatMap((card) =>
        card.shown.chats ? card.chats.filter(asks).map((chat) => ({ ...place(card), chat })) : []
      )
      .sort((a, b) => askedAt(a.chat) - askedAt(b.chat)),
    moves: cards
      .flatMap((card) => (card.shown.you ? card.you.map((line) => ({ ...place(card), line })) : []))
      .sort((a, b) => a.line.since - b.line.since),
    fyi: cards
      .flatMap((card) => (card.shown.fyi ? card.fyi.map((line) => ({ ...place(card), line })) : []))
      .sort((a, b) => a.line.at - b.line.at),
    working: cards.flatMap((card) =>
      card.shown.chats
        ? card.chats
            .filter((chat) => chat.state === 'working' && !asks(chat))
            .map((chat) => ({ ...place(card), chat }))
        : []
    ),
    persons: cards
      .flatMap((card) =>
        card.shown.wait ? card.persons.map((person) => ({ ...place(card), person })) : []
      )
      .sort((a, b) => (a.person.oldestAt ?? 0) - (b.person.oldestAt ?? 0)),
    today: cards
      .flatMap((card) =>
        card.shown.today ? card.today.map((row) => ({ ...place(card), row })) : []
      )
      .sort((a, b) => b.row.at - a.row.at),
    waits: cards.reduce((sum, card) => sum + (card.shown.wait ? card.waits : 0), 0)
  }
}
