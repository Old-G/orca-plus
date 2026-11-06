import { describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  setOrcaPlusThemeMode,
  startPowerTheme,
  toggleOrcaPlusTheme,
  type ThemeDeps
} from './orca-plus-theme-actions'
import { themeForMode, themeModeOf } from './orca-plus-theme-mode'
import { hqPlusRootClass } from '../hq-plus/hq-plus-theme'

function fakeDeps(state: { dark: boolean; follows: boolean; onBattery: boolean }) {
  let power: ((change: { onBattery: boolean }) => void) | null = null
  const applied: string[] = []
  const deps: ThemeDeps = {
    apply: (theme) => {
      applied.push(theme)
      state.dark = theme === 'dark'
    },
    setFollowsBattery: (next) => {
      state.follows = next
    },
    followsBattery: () => state.follows,
    isOnBattery: () => Promise.resolve(state.onBattery),
    onPowerChanged: (callback) => {
      power = callback
      return () => {
        power = null
      }
    },
    darkNow: () => state.dark
  }
  return { deps, applied, emit: (onBattery: boolean) => power?.({ onBattery }) }
}

describe('HQ+ root class', () => {
  it('is dark only while Orca is dark, so Paper paints in light', () => {
    expect(hqPlusRootClass(true)).toBe('hq-plus dark')
    expect(hqPlusRootClass(false)).toBe('hq-plus')
    expect(hqPlusRootClass(false, 'hqm')).toBe('hq-plus hqm')
    expect(hqPlusRootClass(true, 'hqm')).toBe('hq-plus dark hqm')
  })

  it('no HQ+ screen hardcodes the dark class any more', () => {
    const dir = join(__dirname, '../hq-plus')
    const forced = readdirSync(dir)
      .filter((name) => name.endsWith('.tsx'))
      .filter((name) => /className="hq-plus dark/.test(readFileSync(join(dir, name), 'utf8')))
    expect(forced).toEqual([])
  })
})

describe('theme modes', () => {
  it('maps the stock setting and the battery flag to the picked mode', () => {
    expect(themeModeOf('dark', false)).toBe('dark')
    expect(themeModeOf('light', false)).toBe('paper')
    expect(themeModeOf('system', false)).toBe('auto-system')
    expect(themeModeOf('light', true)).toBe('auto-battery')
    expect(themeForMode('auto-system', true)).toBe('system')
  })

  it('the sun/moon flips dark ↔ Paper and turns auto off', () => {
    const state = { dark: true, follows: true, onBattery: true }
    const { deps, applied } = fakeDeps(state)
    toggleOrcaPlusTheme(deps)
    expect(applied).toEqual(['light'])
    expect(state.follows).toBe(false)
    toggleOrcaPlusTheme(deps)
    expect(applied).toEqual(['light', 'dark'])
  })

  it('picking «Auto: Paper on battery» applies the current source at once', async () => {
    const state = { dark: true, follows: false, onBattery: true }
    const { deps, applied } = fakeDeps(state)
    await setOrcaPlusThemeMode('auto-battery', deps)
    expect(state.follows).toBe(true)
    expect(applied).toEqual(['light'])
    await setOrcaPlusThemeMode('auto-system', deps)
    expect(state.follows).toBe(false)
    expect(applied).toEqual(['light', 'system'])
  })
})

describe('startPowerTheme', () => {
  it('in battery mode the charger picks: battery → Paper, charger → dark', async () => {
    const state = { dark: true, follows: true, onBattery: false }
    const { deps, applied, emit } = fakeDeps(state)
    const stop = startPowerTheme(deps)
    await vi.waitFor(() => expect(applied).toEqual(['dark']))
    emit(true)
    emit(false)
    expect(applied).toEqual(['dark', 'light', 'dark'])
    stop()
    emit(true)
    expect(applied).toEqual(['dark', 'light', 'dark'])
  })

  it('leaves the theme alone when the battery mode is off', async () => {
    const state = { dark: true, follows: false, onBattery: true }
    const { deps, applied, emit } = fakeDeps(state)
    startPowerTheme(deps)
    emit(true)
    await Promise.resolve()
    expect(applied).toEqual([])
  })
})
