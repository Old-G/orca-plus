import { flattenThemeColor, parseThemeColor, validThemeColor } from './vscode-theme-colors'
import { isDarkVscodeThemeBase, type ResolvedVscodeTheme } from './vscode-theme-types'

// Custom build (vscode-theme-import): theme data for monaco.editor.defineTheme, kept free of the
// monaco import so main and tests can use it.

export type MonacoThemeRule = { token: string; foreground?: string; fontStyle?: string }

export type MonacoThemeData = {
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light'
  inherit: true
  rules: MonacoThemeRule[]
  colors: Record<string, string>
}

// TextMate scopes (what themes style) → the Monarch tokens Orca's tokenizers emit and the
// LSP semantic token types; Monaco matches rules by dotted prefix.
const SCOPE_ALIASES: readonly (readonly [string, string])[] = [
  ['constant.numeric', 'number'],
  ['storage', 'keyword'],
  ['string.regexp', 'regexp'],
  ['punctuation', 'delimiter'],
  ['entity.name.type', 'type'],
  ['support.type', 'type'],
  ['entity.name.class', 'class'],
  ['support.class', 'class'],
  ['entity.name.function', 'function'],
  ['support.function', 'function'],
  ['variable.parameter', 'parameter'],
  ['variable.other.property', 'property'],
  ['support.variable.property', 'property'],
  ['entity.name.namespace', 'namespace'],
  ['entity.name.tag', 'tag'],
  ['entity.other.attribute-name', 'attribute.name']
]

function scopesOf(scope: string | string[] | undefined): string[] {
  const list = Array.isArray(scope) ? scope : typeof scope === 'string' ? scope.split(',') : ['']
  return list.map((entry) => entry.trim())
}

function aliasesOf(scope: string): string[] {
  return SCOPE_ALIASES.filter(([prefix]) => scope === prefix || scope.startsWith(`${prefix}.`)).map(
    ([, token]) => token
  )
}

export function toMonacoThemeData(theme: ResolvedVscodeTheme): MonacoThemeData {
  const dark = isDarkVscodeThemeBase(theme.base)
  const backdrop = parseThemeColor(theme.colors['editor.background']) ?? {
    r: dark ? 30 : 255,
    g: dark ? 30 : 255,
    b: dark ? 30 : 255,
    a: 1
  }
  const rules: MonacoThemeRule[] = []
  for (const { scope, settings } of theme.tokenColors) {
    const foreground = flattenThemeColor(settings.foreground, backdrop)?.slice(1)
    const fontStyle = typeof settings.fontStyle === 'string' ? settings.fontStyle.trim() : undefined
    if (!foreground && fontStyle === undefined) {
      continue
    }
    for (const token of scopesOf(scope)) {
      // Why: a TextMate "descendant" selector ("meta.x string") has no Monaco equivalent.
      if (token.includes(' ')) {
        continue
      }
      for (const name of [...aliasesOf(token), token]) {
        rules.push({
          token: name,
          ...(foreground ? { foreground } : {}),
          ...(fontStyle !== undefined ? { fontStyle } : {})
        })
      }
    }
  }
  const colors: Record<string, string> = {}
  for (const [key, value] of Object.entries(theme.colors)) {
    const color = validThemeColor(value)
    if (color) {
      colors[key] = color
    }
  }
  return { base: theme.base, inherit: true, rules, colors }
}

/** Monaco's built-in name the call sites already pass, so none of them change. */
export function monacoThemeNameFor(theme: ResolvedVscodeTheme): 'vs' | 'vs-dark' {
  return isDarkVscodeThemeBase(theme.base) ? 'vs-dark' : 'vs'
}
