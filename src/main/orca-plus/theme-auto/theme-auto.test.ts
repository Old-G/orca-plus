import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '/tmp' },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  powerMonitor: { on: vi.fn(), off: vi.fn(), isOnBatteryPower: () => false }
}))

import {
  ThemeAuto,
  onBatteryReader,
  parseBuiltInBrightness,
  parsePmsetOnBattery,
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

describe('parsePmsetOnBattery', () => {
  it('reads the source pmset names', () => {
    expect(parsePmsetOnBattery("Now drawing from 'Battery Power'\n -InternalBattery-0")).toBe(true)
    expect(parsePmsetOnBattery("Now drawing from 'AC Power'\n")).toBe(false)
    expect(parsePmsetOnBattery('')).toBeNull()
  })
})

describe('themeOnBrightness', () => {
  it('Paper at 5 F1/F2 steps (0.3125) and below, dark from 6 steps (0.375), nothing in between', () => {
    // the owner, 07.11: 0.375 should already be dark, one F1 press down Paper
    expect(themeOnBrightness(0.3125)).toBe('light')
    expect(themeOnBrightness(0.32)).toBe('light')
    expect(themeOnBrightness(0.1)).toBe('light')
    expect(themeOnBrightness(0.35)).toBeNull()
    expect(themeOnBrightness(0.375)).toBe('dark')
    expect(themeOnBrightness(0.37)).toBe('dark')
    expect(themeOnBrightness(1)).toBe('dark')
    expect(themeOnBrightness(null)).toBeNull()
  })
})

function harness(
  mode: ThemeAutoMode,
  levels: (number | null)[],
  theme: 'dark' | 'light' = 'dark',
  sources: (boolean | null)[] = []
) {
  const settings = { theme: theme as 'system' | 'dark' | 'light' }
  const writes: string[] = []
  let tick: (() => void) | null = null
  // Electron 43 on a MacBook on battery: powerMonitor still says AC (07.11).
  const power = { on: vi.fn(), off: vi.fn(), isOnBatteryPower: () => false }
  let mode_ = mode
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
    readOnBattery: () => Promise.resolve(sources.length ? (sources.shift() ?? null) : null),
    readBrightness: () => Promise.resolve(levels.length ? (levels.shift() ?? null) : null),
    readMode: () => mode_,
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
  return {
    auto: new ThemeAuto(deps),
    settings,
    writes,
    power,
    deps,
    polling: () => tick !== null,
    setFileMode: (next: ThemeAutoMode) => {
      mode_ = next
    }
  }
}

describe('ThemeAuto', () => {
  it('at low brightness: one F1 from 0.375 → Paper, the band keeps it, one F2 back → dark', async () => {
    const h = harness('brightness', [0.375, 0.3125, 0.35, 0.375])
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

  it('on battery even while Electron says AC: pmset decides, so unplugging gives Paper', async () => {
    const h = harness('battery', [], 'dark', [true, true, false])
    h.auto.start()
    await vi.waitFor(() => expect(h.writes).toEqual(['light']))
    await h.auto.checkPower()
    await h.auto.checkPower()
    expect(h.writes).toEqual(['light', 'dark'])
  })

  it('a charger event reads pmset at once; an unreadable source keeps the theme', async () => {
    const h = harness('battery', [], 'dark', [null, true])
    h.auto.start()
    await Promise.resolve()
    expect(h.writes).toEqual([])
    const nudge = h.power.on.mock.calls.find(([event]) => event === 'on-battery')?.[1]
    nudge?.()
    await vi.waitFor(() => expect(h.writes).toEqual(['light']))
    h.auto.setMode('off')
    expect(h.power.off).toHaveBeenCalledTimes(2)
    expect(h.polling()).toBe(false)
  })

  it('follows the mode file when it changes outside the app', () => {
    const h = harness('off', [0.1])
    h.auto.start()
    expect(h.polling()).toBe(false)
    h.setFileMode('brightness')
    h.auto.reloadMode()
    expect(h.auto.getMode()).toBe('brightness')
    expect(h.polling()).toBe(true)
    expect(h.deps.notify).toHaveBeenCalledWith('brightness')
    expect(h.deps.writeMode).not.toHaveBeenCalled()
  })
})

describe('the battery reader per platform', () => {
  const pmset = vi.fn(async () => true)

  it('reads pmset on macOS, where powerMonitor lies', async () => {
    const read = onBatteryReader('darwin', { pmset, isOnBatteryPower: () => false })
    await expect(read()).resolves.toBe(true)
  })

  it('reads powerMonitor on Linux and Windows, where there is no pmset', async () => {
    for (const platform of ['linux', 'win32'] as const) {
      await expect(
        onBatteryReader(platform, { pmset, isOnBatteryPower: () => true })()
      ).resolves.toBe(true)
      await expect(
        onBatteryReader(platform, { pmset, isOnBatteryPower: () => false })()
      ).resolves.toBe(false)
    }
  })

  it('keeps the theme when powerMonitor throws', async () => {
    const read = onBatteryReader('linux', {
      pmset,
      isOnBatteryPower: () => {
        throw new Error('no power service')
      }
    })
    await expect(read()).resolves.toBeNull()
  })
})
