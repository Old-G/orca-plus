// Custom build (pulse-hot-indexes): the waiting bells re-sync once per burst of pulse writes, after
// them, not inside every change event.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startHqWaitingBells, type HqWaitingBellsDeps } from './hq-waiting-bells'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function start(overrides: Partial<HqWaitingBellsDeps> = {}) {
  let changed: (() => void) | null = null
  const deps: HqWaitingBellsDeps = {
    listOpen: vi.fn(() => []),
    personName: () => null,
    sync: vi.fn(),
    onChanged: (listener) => {
      changed = listener
    },
    now: () => 0,
    ...overrides
  }
  startHqWaitingBells(deps)
  return {
    deps,
    change: () => {
      changed?.()
    }
  }
}

describe('startHqWaitingBells', () => {
  it('syncs once at start, then once per burst of changes after it', () => {
    const { deps, change } = start()
    expect(deps.listOpen).toHaveBeenCalledTimes(1)
    for (let write = 0; write < 5; write += 1) {
      change()
    }
    expect(deps.listOpen).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(deps.listOpen).toHaveBeenCalledTimes(2)
    // One pass syncs each of the three bell kinds once.
    expect(deps.sync).toHaveBeenCalledTimes(6)
    change()
    vi.advanceTimersByTime(1)
    expect(deps.listOpen).toHaveBeenCalledTimes(3)
  })

  it('keeps a failed pass inside the timer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let fail = false
    const { change } = start({
      listOpen: () => {
        if (fail) {
          throw new Error('database closed')
        }
        return []
      }
    })
    fail = true
    change()
    expect(() => vi.advanceTimersByTime(1)).not.toThrow()
    expect(warn).toHaveBeenCalledWith('[hq-waiting-bells] sync failed:', expect.any(Error))
  })
})
