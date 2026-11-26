import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('hq-plus layout', () => {
  beforeEach(() => {
    vi.resetModules()
    const store = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value)
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts on the current layout', async () => {
    const { hqPlusLayout } = await import('./hq-plus-layout')
    expect(hqPlusLayout()).toBe('current')
  })

  it('keeps Board across a restart', async () => {
    const first = await import('./hq-plus-layout')
    first.setHqPlusLayout('board')
    vi.resetModules()
    const second = await import('./hq-plus-layout')
    expect(second.hqPlusLayout()).toBe('board')
  })

  it('falls back to current for an unknown saved value', async () => {
    window.localStorage.setItem('orca-plus.hq-plus-layout', 'grid')
    const { hqPlusLayout } = await import('./hq-plus-layout')
    expect(hqPlusLayout()).toBe('current')
  })
})
