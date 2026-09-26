import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { isSlackPausedForThisInstance } from './slack-instance-gate'

describe('isSlackPausedForThisInstance', () => {
  it('keeps the installed app connected', () => {
    expect(isSlackPausedForThisInstance({}, true)).toBe(false)
  })

  it('pauses a dev build unless it opts in', () => {
    expect(isSlackPausedForThisInstance({}, false)).toBe(true)
    expect(isSlackPausedForThisInstance({ ORCA_DEV_SLACK: '1' }, false)).toBe(false)
    expect(isSlackPausedForThisInstance({ ORCA_DEV_SLACK: 'true' }, false)).toBe(true)
  })

  it('reads the real app flag by default', () => {
    expect(isSlackPausedForThisInstance({})).toBe(true)
  })
})
