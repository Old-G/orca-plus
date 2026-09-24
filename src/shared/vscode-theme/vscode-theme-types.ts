// Custom build (vscode-theme-import): a VS Code / Cursor color theme after include chains resolve.

export type VscodeThemeBase = 'vs' | 'vs-dark' | 'hc-black' | 'hc-light'

export type VscodeTokenColorRule = {
  scope?: string | string[]
  settings: { foreground?: string; background?: string; fontStyle?: string }
}

export type ResolvedVscodeTheme = {
  label: string
  base: VscodeThemeBase
  colors: Record<string, string>
  tokenColors: VscodeTokenColorRule[]
}

/** Where an imported theme came from; shown in settings and used to re-import. */
export type VscodeThemeOrigin =
  | { kind: 'installed'; editor: 'cursor' | 'vscode'; extensionId: string; version: string }
  | { kind: 'open-vsx'; extensionId: string; version: string }
  | { kind: 'vsix-file'; fileName: string }

export type ImportedVscodeTheme = ResolvedVscodeTheme & {
  id: string
  origin: VscodeThemeOrigin
  importedAt: number
}

export function isDarkVscodeThemeBase(base: VscodeThemeBase): boolean {
  return base === 'vs-dark' || base === 'hc-black'
}

export function toVscodeThemeBase(uiTheme: unknown): VscodeThemeBase {
  return uiTheme === 'vs' || uiTheme === 'hc-black' || uiTheme === 'hc-light' ? uiTheme : 'vs-dark'
}
