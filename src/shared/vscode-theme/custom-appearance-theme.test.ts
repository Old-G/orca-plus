import { describe, expect, it } from 'vitest'
import {
  buildCustomAppearanceTheme,
  customThemeMatchesMode,
  normalizeCustomAppearanceTheme
} from './custom-appearance-theme'

const IMPORTED = {
  id: 'hub-contrast-rainglow-36af1fd2',
  label: 'Hub Contrast (rainglow)',
  base: 'vs-dark' as const,
  colors: { 'editor.background': '#191d21', 'terminal.ansiRed': '#e85362' },
  tokenColors: [],
  origin: { kind: 'vsix-file' as const, fileName: 'x.vsix' },
  importedAt: 0
}

describe('custom appearance theme selection', () => {
  it('keeps just what the first paint and the terminal need', () => {
    const selection = buildCustomAppearanceTheme(IMPORTED)
    expect(selection).toEqual({
      id: IMPORTED.id,
      label: IMPORTED.label,
      base: 'vs-dark',
      appTokens: { '--background': '#191d21', '--editor-surface': '#191d21', '--card': '#191d21' },
      terminal: { background: '#191d21', red: '#e85362' }
    })
    expect(normalizeCustomAppearanceTheme(selection)).toEqual(selection)
  })

  it('drops malformed ids, token names and colors from stored settings', () => {
    expect(normalizeCustomAppearanceTheme({ id: '../x', label: 'x' })).toBeNull()
    expect(
      normalizeCustomAppearanceTheme({
        id: 'ok',
        label: 'Ok',
        base: 'weird',
        appTokens: { '--background': '#000', 'color}body{': '#fff', '--ring': 'red' },
        terminal: { red: '#ff000080', blue: '#0000ff' }
      })
    ).toEqual({
      id: 'ok',
      label: 'Ok',
      base: 'vs-dark',
      appTokens: { '--background': '#000' },
      terminal: { blue: '#0000ff' }
    })
  })

  it('matches a dark theme to dark mode only', () => {
    const selection = buildCustomAppearanceTheme(IMPORTED)
    expect(customThemeMatchesMode(selection, true)).toBe(true)
    expect(customThemeMatchesMode(selection, false)).toBe(false)
    expect(customThemeMatchesMode({ ...selection, base: 'hc-light' }, false)).toBe(true)
  })
})
