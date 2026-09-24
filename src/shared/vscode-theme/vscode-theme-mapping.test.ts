import { describe, expect, it } from 'vitest'
import { buildAppTokensCss, toAppTokens } from './vscode-theme-app-tokens'
import { flattenThemeColor, parseThemeColor } from './vscode-theme-colors'
import { monacoThemeNameFor, toMonacoThemeData } from './vscode-theme-monaco'
import { toTerminalOverrides } from './vscode-theme-terminal'
import type { ResolvedVscodeTheme } from './vscode-theme-types'

// Trimmed from rainglow's "Hub Contrast" (the theme this build used to hardcode).
const HUB: ResolvedVscodeTheme = {
  label: 'Hub Contrast (rainglow)',
  base: 'vs-dark',
  colors: {
    foreground: '#ffffff',
    'editor.background': '#191d21',
    'editor.foreground': '#ffffff',
    'editor.selectionBackground': '#077cf955',
    'sideBar.background': '#191d21',
    focusBorder: '#e85362',
    'terminal.background': '#191d21',
    'terminal.ansiRed': '#e85362',
    'terminal.selectionBackground': '#ffffff40',
    'statusBar.background': '#2e1a1f',
    'not.a.color': 'bogus'
  },
  tokenColors: [
    { settings: { foreground: '#ffffff', background: '#191d21' } },
    { scope: 'comment', settings: { foreground: '#718493', fontStyle: 'italic' } },
    { scope: 'constant.numeric, string', settings: { foreground: '#9fbde0' } },
    { scope: ['entity.name.function'], settings: { foreground: '#5392db' } },
    { scope: 'meta.tag string', settings: { foreground: '#ff0000' } }
  ]
}

describe('VS Code theme colors', () => {
  it('parses every VS Code hex form', () => {
    expect(parseThemeColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 })
    expect(parseThemeColor('#ffffff80')?.a).toBeCloseTo(0.5, 2)
    expect(parseThemeColor('red')).toBeNull()
  })

  it('composites translucent colors over the backdrop', () => {
    expect(flattenThemeColor('#ffffff80', { r: 0, g: 0, b: 0, a: 1 })).toBe('#808080')
  })
})

describe('app tokens', () => {
  it('maps workbench colors to Orca tokens and skips invalid values', () => {
    const tokens = toAppTokens(HUB)
    expect(tokens['--background']).toBe('#191d21')
    expect(tokens['--editor-surface']).toBe('#191d21')
    expect(tokens['--ring']).toBe('#e85362')
    expect(tokens['--bg-titlebar']).toBe('#2e1a1f')
    expect(Object.values(tokens)).not.toContain('bogus')
    expect(tokens['--popover']).toBeUndefined()
  })

  it('writes one rule for both schemes at main.css specificity', () => {
    expect(buildAppTokensCss({ '--background': '#191d21' })).toBe(
      ':root, .dark, .light {\n  --background: #191d21;\n}'
    )
  })
})

describe('Monaco theme', () => {
  it('keeps TextMate scopes, adds Monarch/semantic aliases, drops descendant selectors', () => {
    const data = toMonacoThemeData(HUB)
    expect(data.base).toBe('vs-dark')
    const tokens = data.rules.map((rule) => rule.token)
    expect(tokens).toEqual(
      expect.arrayContaining(['', 'comment', 'constant.numeric', 'number', 'string', 'function'])
    )
    expect(tokens.some((token) => token.includes(' '))).toBe(false)
    expect(data.rules.find((rule) => rule.token === 'comment')).toEqual({
      token: 'comment',
      foreground: '718493',
      fontStyle: 'italic'
    })
    expect(data.colors['editor.selectionBackground']).toBe('#077cf955')
    expect(data.colors['not.a.color']).toBeUndefined()
    expect(monacoThemeNameFor(HUB)).toBe('vs-dark')
    expect(monacoThemeNameFor({ ...HUB, base: 'hc-light' })).toBe('vs')
  })
})

describe('terminal colors', () => {
  it('only overrides what the theme defines, without alpha', () => {
    expect(toTerminalOverrides(HUB)).toEqual({
      background: '#191d21',
      foreground: '#ffffff',
      selectionBackground: '#535659',
      red: '#e85362'
    })
  })
})
