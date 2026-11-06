import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '/tmp' },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  powerMonitor: { on: vi.fn(), off: vi.fn(), isOnBatteryPower: () => false }
}))

import {
  ThemeAuto,
  parseBuiltInBrightness,
  themeOnBrightness,
  type ThemeAutoDeps,
  type ThemeAutoMode
} from './theme-auto'

// Trimmed from `corebrightnessdiag status-info` on a MacBook Pro: an external screen first, then the built-in one.
const STATUS = `<dict>
  <key>DisplayServicesBrightness</key>
  <real>0.9</real>
  <key>DisplayServicesIsBuiltInDisplay</key>
  <false/>
</dict>
<dict>
  <key>DisplayNitsKey</key>
  <real>140</real>
  <key>DisplayServicesBrightness</key>
  <real>0.25</real>
  <key>DisplayServicesBrightnessIncrement</key>
  <real>0.0</real>
  <key>DisplayServicesIsBuiltInDisplay</key>
  <true/>
</dict>`

describe('parseBuiltInBrightness', () => {
  it("reads the built-in screen's slider, not an external one's", () => {
    expect(parseBuiltInBrightness(STATUS)).toBe(0.25)
  })

  it('is null without a built-in display — an external monitor only, another Mac', () => {
    expect(parseBuiltInBrightness('')).toBeNull()
    expect(parseBuiltInBrightness(STATUS.split('<dict>\n  <key>DisplayNitsKey')[0])).toBeNull()
  })
})

describe('themeOnBrightness', () => {
  it('Paper at 30% and below, dark from 38%, nothing in between (no flicker)', () => {
    expect(themeOnBrightness(0.3)).toBe('light')
    expect(themeOnBrightness(0.1)).toBe('light')
    expect(themeOnBrightness(0.34)).toBeNull()
    expect(themeOnBrightness(0.38)).toBe('dark')
    expect(themeOnBrightness(1)).toBe('dark')
    expect(themeOnBrightness(null)).toBeNull()
  })
})

function harness(mode: ThemeAutoMode, levels: (number | null)[], theme: 'dark' | 'light' = 'dark') {
  const settings = { theme: theme as 'system' | 'dark' | 'light' }
  const writes: string[] = []
  let tick: (() => void) | null = null
  const power = { on: vi.fn(), off: vi.fn(), isOnBatteryPower: () => false }
  const deps: ThemeAutoDeps = {
    store: {
      getSettings: () => settings,
      updateSettings: (updates, options) => {
        settings.theme = updates.theme
        // only a write that reaches the windows counts
        writes.push(options.notifyListeners ? updates.theme : `silent:${updates.theme}`)
      }
    },
    power,
    readBrightness: () => Promise.resolve(levels.length ? (levels.shift() ?? null) : null),
    readMode: () => mode,
    writeMode: vi.fn(),
    notify: vi.fn(),
    setInterval: (callback) => {
      tick = callback
      return 1
    },
    clearInterval: () => {
      tick = null
    }
  }
  return { auto: new ThemeAuto(deps), settings, writes, power, deps, polling: () => tick !== null }
}

describe('ThemeAuto', () => {
  it('at low brightness: down past 30% → Paper, the band keeps it, up past 38% → dark', async () => {
    const h = harness('brightness', [0.5, 0.25, 0.34, 0.4])
    h.auto.start()
    await vi.waitFor(() => expect(h.polling()).toBe(true))
    for (let i = 0; i < 3; i++) {
      await h.auto.checkBrightness()
    }
    expect(h.writes).toEqual(['light', 'dark'])
  })

  it('leaves the theme alone when the brightness cannot be read', async () => {
    const h = harness('brightness', [null, null])
    h.auto.start()
    await h.auto.checkBrightness()
    expect(h.writes).toEqual([])
    expect(h.settings.theme).toBe('dark')
  })

  it('polls only while the brightness mode is picked', async () => {
    const h = harness('brightness', [0.5])
    h.auto.start()
    expect(h.polling()).toBe(true)
    h.auto.setMode('off')
    expect(h.polling()).toBe(false)
    expect(h.deps.writeMode).toHaveBeenCalledWith('off')
    expect(h.deps.notify).toHaveBeenCalledWith('off')
  })

  it('on battery: the charger picks, and switching the mode off lets go of it', () => {
    const h = harness('battery', [])
    h.auto.start()
    const onBattery = h.power.on.mock.calls.find(([event]) => event === 'on-battery')?.[1]
    onBattery?.()
    expect(h.writes).toEqual(['light'])
    h.auto.setMode('off')
    expect(h.power.off).toHaveBeenCalledTimes(2)
  })
})
