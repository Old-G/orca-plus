// Custom build (sidebar-close-stays): closing or removing a workspace re-ranks nothing else.
import { describe, expect, it } from 'vitest'
import {
  INITIAL_SORT_SETTLE_STATE,
  reduceSortSettle,
  SORT_SETTLE_MS,
  type SortSettleEvent
} from './sort-settle'

const write = (
  liveCount: number,
  epochBumped: boolean,
  sortBy: 'smart' | 'recent' | 'manual' = 'smart'
): SortSettleEvent => ({
  kind: 'write',
  change: { epochBumped, liveCount },
  settled: false,
  sortBy,
  previousSortBy: sortBy
})

describe('reduceSortSettle', () => {
  const settledAt10 = { liveCountAtLastBump: 10, liveCountAtLastWrite: 10, deadline: null }

  it('re-ranks at once when a workspace is added', () => {
    const step = reduceSortSettle(settledAt10, write(11, true), 1000)
    expect(step.settle).toBe(true)
  })

  it('does not re-rank or arm a timer when a workspace is removed', () => {
    const step = reduceSortSettle(settledAt10, write(9, true), 1000)
    expect(step.settle).toBe(false)
    expect(step.state.deadline).toBeNull()
    expect(step.state.liveCountAtLastBump).toBe(9)
  })

  it('keeps an already pending window when a removal arrives', () => {
    const pending = { liveCountAtLastBump: 10, liveCountAtLastWrite: 10, deadline: 1000 + SORT_SETTLE_MS }
    const step = reduceSortSettle(pending, write(9, true), 1500)
    expect(step.settle).toBe(false)
    expect(step.state.deadline).toBe(1000 + SORT_SETTLE_MS)
  })

  it('still arms the window for activity without a count change', () => {
    const step = reduceSortSettle(settledAt10, write(10, true), 1000)
    expect(step.settle).toBe(false)
    expect(step.state.deadline).toBe(1000 + SORT_SETTLE_MS)
  })

  it('an add after a removal re-ranks', () => {
    const afterRemoval = reduceSortSettle(settledAt10, write(9, true), 1000).state
    expect(reduceSortSettle(afterRemoval, write(10, true), 2000).settle).toBe(true)
  })

  it('a bumpless removal does not swallow the next activity bump', () => {
    const afterBumpless = reduceSortSettle(
      settledAt10,
      { ...write(9, false), change: { epochBumped: false, liveCount: 9 } },
      1000
    ).state
    const step = reduceSortSettle(afterBumpless, write(9, true), 2000)
    // the row set changed since the last bump: the old rule settles at once
    expect(step.settle).toBe(true)
  })

  it('manual and a sort switch still settle at once', () => {
    expect(reduceSortSettle(settledAt10, write(9, true, 'manual'), 1000).settle).toBe(true)
    expect(
      reduceSortSettle(
        INITIAL_SORT_SETTLE_STATE,
        { ...write(0, false), change: null, previousSortBy: 'recent' },
        1000
      ).settle
    ).toBe(true)
  })
})
