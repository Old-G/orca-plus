import { monaco } from '@/lib/monaco-setup'
import {
  monacoThemeNameFor,
  toMonacoThemeData
} from '../../../../shared/vscode-theme/vscode-theme-monaco'
import type { ImportedVscodeTheme } from '../../../../shared/vscode-theme/vscode-theme-types'

// Custom build (custom-appearance-theme): redefines the built-in theme name the editors already
// pass (vs-dark / vs), so no call site changes; redefining the active theme repaints at once.

let overridden: 'vs' | 'vs-dark' | null = null

export function applyCustomMonacoTheme(theme: ImportedVscodeTheme | null): void {
  if (overridden) {
    monaco.editor.defineTheme(overridden, {
      base: overridden,
      inherit: true,
      rules: [],
      colors: {}
    })
    overridden = null
  }
  if (theme) {
    const name = monacoThemeNameFor(theme)
    monaco.editor.defineTheme(name, toMonacoThemeData(theme))
    overridden = name
  }
}
