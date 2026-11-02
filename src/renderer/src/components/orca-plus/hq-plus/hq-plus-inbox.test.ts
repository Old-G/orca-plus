import { describe, expect, it } from 'vitest'
import type { HqPlusProjectFeed } from '../../../../../shared/hq-plus-project-cards'
import { hqPlusInboxQueue } from './hq-plus-inbox'

type Card = HqPlusProjectFeed['cards'][number]

function card(slug: string, over: Partial<Card>): Card {
  return {
    slug,
    unsorted: false,
    approve: [],
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
    shown: { approve: true, you: true, fyi: true, wait: true, today: true, chats: true },
    ...over
  } as Card
}

const line = (id: string, since: number) => ({ id, since }) as Card['you'][number]
const chat = (key: string, state: string, question: unknown = null) =>
  ({ key, state, question }) as unknown as Card['chats'][number]

describe('Inbox, one queue over the project cards (owner 02.11, variant B)', () => {
  it('puts Approve first, then chats that ask, then people, each oldest first across projects', () => {
    const feed = {
      cards: [
        card('acme-api', {
          approve: [line('ap-2', 20)],
          you: [line('you-3', 30), line('you-1', 10)],
          chats: [chat('c-ask', 'asks'), chat('c-work', 'working'), chat('c-done', 'done')],
          waits: 3
        }),
        card('acme-web', {
          unsorted: true,
          approve: [line('ap-1', 5)],
          you: [line('you-2', 15)],
          waits: 2
        })
      ],
      counts: { approve: 2, asks: 1, move: 3, wait: 5, fyi: 0 },
      fyi: []
    } as unknown as HqPlusProjectFeed

    const queue = hqPlusInboxQueue(feed)

    expect(queue.approve.map((entry) => entry.line.id)).toEqual(['ap-1', 'ap-2'])
    expect(queue.asks.map((entry) => entry.chat.key)).toEqual(['c-ask'])
    expect(queue.moves.map((entry) => [entry.line.id, entry.slug, entry.unsorted])).toEqual([
      ['you-1', 'acme-api', false],
      ['you-2', 'acme-web', true],
      ['you-3', 'acme-api', false]
    ])
    expect(queue.working.map((entry) => entry.chat.key)).toEqual(['c-work'])
    expect(queue.waits).toBe(5)
  })
})
