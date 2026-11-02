// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HqPlusProjectFeed as Feed } from '../../../../../shared/hq-plus-project-cards'
import type { HqPlusProjectCardContext } from './HqPlusProjectParts'

const observe = vi.hoisted(() => vi.fn((_element: HTMLElement) => () => {}))
vi.mock('./use-hq-plus-new-marks', () => ({ observeHqPlusNewRows: observe }))

import { HqPlusInbox } from './HqPlusInbox'
import { HqPlusProjectFeed } from './HqPlusProjectFeed'

type Card = Feed['cards'][number]
const SHOWN = { approve: true, you: true, fyi: false, wait: true, today: true, chats: true }

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
    shown: SHOWN,
    ...over
  }
}

const ctx = {
  now: 100,
  flashId: null,
  chatItem: () => null,
  closerOf: () => null,
  showChat: () => {},
  waitsOf: () => [],
  log: {
    newKeys: 'k',
    markSeen: () => {},
    projectColor: () => null,
    isOpenChat: () => false,
    selectedId: null
  }
} as unknown as HqPlusProjectCardContext

afterEach(() => {
  cleanup()
  observe.mockClear()
  localStorage.clear()
})

describe('HQ+ Inbox (Codex 02.11)', () => {
  // missing-project-label: rows from every project stand in one list, so each names its project.
  it('names the project on a working chat and on a person we wait for', () => {
    const working = {
      key: 'c-1',
      title: 'Fix login',
      state: 'working',
      at: 1,
      line: null,
      question: null
    }
    const feed = {
      cards: [
        card('acme-api', { chats: [working] as unknown as Card['chats'] }),
        card('acme-web', {
          persons: [{ name: 'Ann', waits: [{ id: 'w', title: 'Merge !12', at: 1 }], oldestAt: 1 }],
          waits: 1
        } as unknown as Partial<Card>)
      ],
      counts: { approve: 0, asks: 0, move: 0, wait: 1, fyi: 0 },
      fyi: []
    } as unknown as Feed
    render(<HqPlusInbox feed={feed} filter="all" emptyText="" ctx={ctx} />)

    fireEvent.click(screen.getByRole('button', { name: /Working/ }))
    expect(screen.getByText('Fix login').closest('li')?.textContent).toContain('acme-api')
    fireEvent.click(screen.getByRole('button', { name: /We wait/ }))
    expect(screen.getByText('Ann').closest('li')?.textContent).toContain('acme-web')
  })

  // unseen-rows-never-cleared: the default tab's rows lose «NEW» once seen, as the cards' rows do.
  it('watches the Inbox for rows coming into view, and the cards after a switch to Projects', () => {
    const feed = { cards: [], counts: { approve: 0, asks: 0, move: 0, wait: 0, fyi: 0 }, fyi: [] }
    const { container } = render(
      <HqPlusProjectFeed feed={feed} filter="all" onFilter={() => {}} ctx={ctx} />
    )
    expect(observe).toHaveBeenLastCalledWith(container.querySelector('.hqpi'), expect.any(Function))

    fireEvent.click(screen.getByRole('tab', { name: /Projects/ }))
    expect(observe).toHaveBeenLastCalledWith(
      container.querySelector('.hqpc-feed'),
      expect.any(Function)
    )
  })
})
