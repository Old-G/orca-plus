import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readHqPlusFeedWindow,
  readHqPlusPanelWidth,
  saveHqPlusFeedWindow,
  saveHqPlusPanelWidth
} from './hq-plus-panel-widths'

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

describe('hq-plus feed window height', () => {
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

  it('opens at 55%, keeps what was pulled and clamps to 35–80%', () => {
    expect(readHqPlusFeedWindow()).toBe(55)
    saveHqPlusFeedWindow(62)
    expect(readHqPlusFeedWindow()).toBe(62)
    saveHqPlusFeedWindow(10)
    expect(readHqPlusFeedWindow()).toBe(35)
    saveHqPlusFeedWindow(99)
    expect(readHqPlusFeedWindow()).toBe(80)
  })
})
