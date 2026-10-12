import {
  setSyntaxHighlightThemeOverride,
  type SyntaxHighlightThemeOverride
} from '@/lib/syntax-highlighting/syntax-highlight-theme-override'
import {
  isDarkVscodeThemeBase,
  type ImportedVscodeTheme
} from '../../../../shared/vscode-theme/vscode-theme-types'

// Custom build (custom-appearance-theme): chat code is colored with the imported theme, the way
// Monaco is, in the theme's own mode; the other mode keeps Light+ / Dark+.

export function toSyntaxHighlightThemeOverride(
  theme: ImportedVscodeTheme
): SyntaxHighlightThemeOverride {
  const dark = isDarkVscodeThemeBase(theme.base)
  return {
    mode: dark ? 'dark' : 'light',
    theme: {
      name: `orca-custom-${theme.id}`,
      type: dark ? 'dark' : 'light',
      colors: theme.colors,
      settings: theme.tokenColors
    }
  }
}

export function applyCustomSyntaxTheme(theme: ImportedVscodeTheme | null): Promise<void> {
  return setSyntaxHighlightThemeOverride(theme ? toSyntaxHighlightThemeOverride(theme) : null)
}
