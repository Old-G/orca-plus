import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readHqPlusPanelWidth, saveHqPlusPanelWidth } from './hq-plus-panel-widths'

describe('hq-plus panel widths', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value)
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the Board feed width apart from the current left panel', () => {
    saveHqPlusPanelWidth('boardLeft', 460)
    expect(readHqPlusPanelWidth('boardLeft')).toBe(460)
    expect(readHqPlusPanelWidth('left')).toBe(260)
  })
})
