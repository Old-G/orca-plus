import { describe, expect, it, vi } from 'vitest'
import { loadNodeOniguruma } from './oniguruma-test-harness'
import {
  loadedSyntaxHighlighter,
  loadSyntaxLanguage,
  type SyntaxHighlightResult
} from './syntax-highlighter'
import {
  setSyntaxHighlightThemeOverride,
  subscribeSyntaxHighlightTheme,
  syntaxHighlightThemeRevision
} from './syntax-highlight-theme-override'
import { toSyntaxHighlightThemeOverride } from '../custom-appearance/custom-appearance-syntax'
import type { ImportedVscodeTheme } from '../../../../shared/vscode-theme/vscode-theme-types'

vi.mock('./oniguruma', () => ({ loadOniguruma: () => loadNodeOniguruma() }))

const hubContrast: ImportedVscodeTheme = {
  id: 'hub-contrast',
  label: 'Hub Contrast',
  base: 'vs-dark',
  colors: { 'editor.foreground': '#ffffff', 'editor.background': '#191d21' },
  tokenColors: [
    { settings: { foreground: '#ffffff' } },
    { scope: ['keyword', 'storage.type'], settings: { foreground: '#ff2c6d' } }
  ],
  origin: { kind: 'vsix-file', fileName: 'hub.vsix' },
  importedAt: 1
}

async function highlight(code: string): Promise<SyntaxHighlightResult> {
  await expect(loadSyntaxLanguage('ts')).resolves.toBe('ready')
  const highlighter = loadedSyntaxHighlighter('ts')
  if (!highlighter) {
    throw new Error('ts did not load')
  }
  return highlighter(code)
}

function keyword(result: SyntaxHighlightResult) {
  return result.lines.flat().find((token) => token.content === 'const')
}

describe('imported theme in chat code', () => {
  it('colors its own mode with the imported theme and restores Dark+ when cleared', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSyntaxHighlightTheme(listener)
    const before = syntaxHighlightThemeRevision()

    await setSyntaxHighlightThemeOverride(toSyntaxHighlightThemeOverride(hubContrast))

    expect(keyword(await highlight('const a = 1'))).toMatchObject({
      light: '#0000FF',
      dark: '#FF2C6D'
    })
    expect(syntaxHighlightThemeRevision()).toBe(before + 1)
    expect(listener).toHaveBeenCalledOnce()

    await setSyntaxHighlightThemeOverride(toSyntaxHighlightThemeOverride(hubContrast))
    expect(listener).toHaveBeenCalledOnce()

    await setSyntaxHighlightThemeOverride(null)
    expect(keyword(await highlight('const a = 1'))).toMatchObject({
      light: '#0000FF',
      dark: '#569CD6'
    })
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('puts a light theme in the light slot', () => {
    expect(toSyntaxHighlightThemeOverride({ ...hubContrast, base: 'vs' }).mode).toBe('light')
    expect(toSyntaxHighlightThemeOverride({ ...hubContrast, base: 'hc-black' }).mode).toBe('dark')
  })
})
