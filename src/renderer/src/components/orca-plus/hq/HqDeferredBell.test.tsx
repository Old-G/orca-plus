// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ count: 2, now: 0, syncKind: vi.fn(async () => {}) }))

vi.mock('@/hooks/use-now', () => ({ useNow: () => mocks.now }))
vi.mock('../../dashboard/useLiveDashboardSnapshot', () => ({
  useLiveDashboardSnapshot: () => ({ cards: [] })
}))
vi.mock('./use-hq-deferred-sessions', () => ({
  useHqDeferredSessions: () => ({ sessions: Array.from({ length: mocks.count }), close: () => {} })
}))

import { HqDeferredBell } from './HqDeferredBell'

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(window, { api: { pulseBell: { syncKind: mocks.syncKind } } })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('HqDeferredBell', () => {
  it('raises one line a morning after 10:00 with the count, then stops counting', async () => {
    mocks.now = new Date(2026, 9, 3, 9, 59).getTime()
    mocks.count = 2
    const view = render(<HqDeferredBell />)
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(mocks.syncKind).not.toHaveBeenCalled()

    mocks.now = new Date(2026, 9, 3, 10, 5).getTime()
    view.rerender(<HqDeferredBell />)
    await act(async () => vi.advanceTimersByTime(30_000))
    expect(mocks.syncKind).toHaveBeenCalledTimes(1)
    expect(mocks.syncKind).toHaveBeenCalledWith('hq-deferred', [
      expect.objectContaining({ title: '2 deferred sessions', dedupeKey: 'hq-deferred:2026-10-03' })
    ])

    view.rerender(<HqDeferredBell />)
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(mocks.syncKind).toHaveBeenCalledTimes(1)
  })

  it('does not sync when nothing is deferred', async () => {
    mocks.now = new Date(2026, 9, 3, 11, 0).getTime()
    mocks.count = 0
    render(<HqDeferredBell />)
    await act(async () => vi.advanceTimersByTime(30_000))
    expect(mocks.syncKind).not.toHaveBeenCalled()
  })
})
