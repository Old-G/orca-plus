import type { VscodeThemeBase, VscodeThemeOrigin } from './vscode-theme-types'

// Custom build (vscode-theme-import): what the renderer and main exchange.

export type ThemeSourceRequest =
  | { kind: 'installed'; editor: 'cursor' | 'vscode'; extensionId: string }
  | { kind: 'open-vsx'; namespace: string; name: string }
  | { kind: 'vsix-file' }

export type OpenedThemeSource = {
  /** Opaque handle for importTheme; main keeps the files, the renderer never sends paths. */
  token: string
  displayName: string
  version: string
  themes: { label: string; base: VscodeThemeBase }[]
}

export type ThemeImportError = 'not-found' | 'invalid-extension' | 'network' | 'no-themes'

export type OpenThemeSourceResult = OpenedThemeSource | { error: ThemeImportError } | null

export type ImportedThemeSummary = {
  id: string
  label: string
  base: VscodeThemeBase
  origin: VscodeThemeOrigin
}

export type InstalledThemeExtensionSummary = {
  editor: 'cursor' | 'vscode'
  extensionId: string
  displayName: string
  version: string
  themes: { label: string; base: VscodeThemeBase }[]
}

export type OpenVsxThemeSearchResult = {
  namespace: string
  name: string
  version: string
  displayName: string
  description: string
  iconUrl: string | null
}
