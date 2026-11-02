// Custom build (hq-plus-inbox, owner 02.11: variant B): the project cards' rows as one queue — what holds
// an agent first (Approve), then the chats that ask the owner, then the people's conversations on him,
// each group oldest first, so the order reads as «this, then this». A section the chip above the feed
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
}

export function hqPlusInboxQueue(feed: HqPlusProjectFeed): HqPlusInboxQueue {
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
      .flatMap((card) => (card.shown.today ? card.today.map((row) => ({ ...place(card), row })) : []))
      .sort((a, b) => b.row.at - a.row.at),
    waits: cards.reduce((sum, card) => sum + (card.shown.wait ? card.waits : 0), 0)
  }
}
