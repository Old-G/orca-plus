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

const line = (id: string, since: number) => ({ id, since, at: since }) as Card['you'][number]
const chat = (key: string, state: string, question: unknown = null, at = 0) =>
  ({ key, state, question, at }) as unknown as Card['chats'][number]

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

  // Codex 02.11 (unsorted-inbox-asks): the project cards come in by their latest activity and a card's
  // chats newest first, so the asking chats need their own oldest-first order.
  it('orders the asking chats oldest first across projects', () => {
    const feed = {
      cards: [
        card('acme-api', {
          chats: [chat('api-new', 'asks', null, 40), chat('api-old', 'asks', null, 10)]
        }),
        card('acme-web', { chats: [chat('web-mid', 'done', line('q-web', 20), 50)] })
      ],
      counts: { approve: 0, asks: 3, move: 0, wait: 0, fyi: 0 },
      fyi: []
    } as unknown as HqPlusProjectFeed

    expect(hqPlusInboxQueue(feed).asks.map((entry) => entry.chat.key)).toEqual([
      'api-old',
      'web-mid',
      'api-new'
    ])
  })

  // Codex 02.11 (ignored-feed-filter): the chip above the feed narrows Inbox as it narrows the cards.
  it('shows only what the chip shows: FYI rows on FYI, nothing the card hides', () => {
    const fyiOnly = {
      approve: false,
      you: false,
      fyi: true,
      wait: false,
      today: false,
      chats: false
    }
    const feed = {
      cards: [
        card('acme-api', {
          shown: fyiOnly,
          approve: [line('ap-1', 5)],
          you: [line('you-1', 10)],
          fyi: [line('fyi-2', 30), line('fyi-1', 20)],
          chats: [chat('c-ask', 'asks'), chat('c-work', 'working')],
          persons: [{ name: 'Ann', waits: [], oldestAt: 1 }],
          waits: 1,
          today: [{ id: 't-1', at: 3 }] as unknown as Card['today']
        })
      ],
      counts: { approve: 1, asks: 1, move: 1, wait: 1, fyi: 2 },
      fyi: []
    } as unknown as HqPlusProjectFeed

    const queue = hqPlusInboxQueue(feed)

    expect(queue.fyi.map((entry) => entry.line.id)).toEqual(['fyi-1', 'fyi-2'])
    expect(queue.approve).toEqual([])
    expect(queue.moves).toEqual([])
    expect(queue.asks).toEqual([])
    expect(queue.working).toEqual([])
    expect(queue.persons).toEqual([])
    expect(queue.today).toEqual([])
    expect(queue.waits).toBe(0)
  })

  it('reads as one stream, oldest first, newest at the bottom; what he already approved stays out (owner 04.11)', () => {
    const today = (id: string, at: number, kind: string) => ({
      id,
      at,
      kind,
      to: null,
      text: '',
      sessionId: null
    })
    const feed = {
      cards: [
        card('acme-api', {
          approve: [line('ap-new', 50)],
          you: [line('you-old', 10)],
          chats: [chat('c-ask', 'asks', { since: 30 })],
          today: [
            today('sent-1', 60, 'sent'),
            today('merged-1', 40, 'merged')
          ] as unknown as Card['today']
        }),
        card('acme-web', { fyi: [line('fyi-mid', 20)] })
      ],
      counts: { approve: 1, asks: 1, move: 1, wait: 0, fyi: 1 },
      fyi: []
    } as unknown as HqPlusProjectFeed

    const stream = hqPlusInboxQueue(feed).stream

    expect(stream.map((row) => [row.type, row.slug])).toEqual([
      ['move', 'acme-api'],
      ['fyi', 'acme-web'],
      ['ask', 'acme-api'],
      ['approve', 'acme-api']
    ])
  })
})
