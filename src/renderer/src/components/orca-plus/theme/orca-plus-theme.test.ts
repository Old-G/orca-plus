import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setOrcaPlusThemeMode, type ThemeDeps } from './orca-plus-theme-actions'
import { autoForMode, themeForMode, themeModeOf } from './orca-plus-theme-mode'
import { hqPlusRootClass } from '../hq-plus/hq-plus-theme'

function fakeDeps(state: { dark: boolean; auto: string }) {
  const applied: string[] = []
  const deps: ThemeDeps = {
    apply: (theme) => {
      applied.push(theme)
      state.dark = theme === 'dark'
    },
    setAuto: (auto) => {
      state.auto = auto
    }
  }
  return { deps, applied }
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
  it("maps the stock setting and main's Auto to the picked mode", () => {
    expect(themeModeOf('dark', 'off')).toBe('dark')
    expect(themeModeOf('light', 'off')).toBe('paper')
    expect(themeModeOf('system', 'off')).toBe('auto-system')
    expect(themeModeOf('light', 'battery')).toBe('auto-battery')
    expect(themeModeOf('dark', 'brightness')).toBe('auto-brightness')
    expect(autoForMode('auto-brightness')).toBe('brightness')
    expect(themeForMode('auto-brightness')).toBeNull()
  })

  it('an Auto mode hands the theme to main; a fixed one writes it and turns Auto off', () => {
    const state = { dark: true, auto: 'off' }
    const { deps, applied } = fakeDeps(state)
    setOrcaPlusThemeMode('auto-brightness', deps)
    expect(state.auto).toBe('brightness')
    expect(applied).toEqual([])
    setOrcaPlusThemeMode('paper', deps)
    expect(state.auto).toBe('off')
    expect(applied).toEqual(['light'])
  })
})
