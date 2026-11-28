// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HqPlusProjectFeed as Feed } from '../../../../../shared/hq-plus-project-cards'
import type { HqPlusProjectCardContext } from './HqPlusProjectParts'

vi.mock('./use-hq-plus-new-marks', () => ({ observeHqPlusNewRows: () => () => {} }))
vi.mock('./HqPlusLog', async (original) => ({
  ...(await original()),
  HqPlusLogCards: () => <span>approve-card</span>
}))

import { HqPlusBoardDock, HqPlusBoardSplit } from './HqPlusBoardDock'
import { HqPlusProjectFeed } from './HqPlusProjectFeed'

type Card = Feed['cards'][number]
const SHOWN = { approve: true, you: true, fyi: false, wait: true, today: true, chats: true }
const card = (over: Partial<Card>): Card =>
  ({
    slug: 'acme-api',
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
  }) as Card
const feedOf = (cards: Card[]): Feed =>
  ({
    cards,
    counts: { approve: 0, asks: 0, move: 0, wait: 0, fyi: 0 },
    fyi: []
  }) as unknown as Feed
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
const withApprove = feedOf([
  card({
    approve: [{ id: 'a1', since: 1, at: 1, what: 'Send reply' }] as unknown as Card['approve']
  })
])

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('Board feed window and «Waiting for you» (U3)', () => {
  it('puts an Approve in the dock, not in the feed window, and counts it', () => {
    render(<HqPlusBoardDock feed={withApprove} ctx={ctx} />)
    expect(screen.getByText('approve-card')).toBeTruthy()
    expect(screen.getByLabelText('Waiting for you').textContent).toContain('1')
    cleanup()
    render(
      <HqPlusProjectFeed feed={withApprove} filter="all" onFilter={() => {}} ctx={ctx} board />
    )
    expect(screen.queryByText('approve-card')).toBeNull()
  })

  it('shrinks to one line when nothing waits', () => {
    render(<HqPlusBoardDock feed={feedOf([card({})])} ctx={ctx} />)
    expect(screen.getByText('Nothing waits ✓')).toBeTruthy()
    expect(screen.getByLabelText('Waiting for you').getAttribute('data-empty')).toBe('true')
  })

  it('opens at 55%, moves by keys within 35–80% and remembers it', () => {
    const { container } = render(<HqPlusBoardSplit window={<i />} dock={<i />} />)
    const split = container.querySelector('.hqb-split') as HTMLElement
    const grip = screen.getByRole('separator')
    expect(split.style.getPropertyValue('--hqb-win')).toBe('55')
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    expect(split.style.getPropertyValue('--hqb-win')).toBe('60')
    expect(localStorage.getItem('orca-plus.hq-plus-feed-window-pct')).toBe('60')
    for (let i = 0; i < 10; i++) {
      fireEvent.keyDown(grip, { key: 'ArrowUp' })
    }
    expect(split.style.getPropertyValue('--hqb-win')).toBe('35')
    cleanup()
    const again = render(<HqPlusBoardSplit window={<i />} dock={<i />} />)
    expect(
      (again.container.querySelector('.hqb-split') as HTMLElement).style.getPropertyValue(
        '--hqb-win'
      )
    ).toBe('35')
  })
})
