import type { TerminalColorOverrides } from '../terminal-color-overrides'
import { toAppTokens } from './vscode-theme-app-tokens'
import { parseThemeColor } from './vscode-theme-colors'
import { toTerminalOverrides } from './vscode-theme-terminal'
import {
  isDarkVscodeThemeBase,
  toVscodeThemeBase,
  type ImportedVscodeTheme,
  type VscodeThemeBase
} from './vscode-theme-types'

// Custom build (custom-appearance-theme): the chosen theme as stored in settings. The small derived
// parts (UI tokens, terminal colors) live here so the first paint and the terminal need no file
// read; Monaco's rule set stays in <userData>/themes/<id>.json and loads lazily.

export type CustomAppearanceTheme = {
  id: string
  label: string
  base: VscodeThemeBase
  appTokens: Record<string, string>
  terminal: TerminalColorOverrides
}

const TOKEN_NAME_RE = /^--[a-z0-9-]+$/
const TERMINAL_COLOR_RE = /^#[0-9a-f]{6}$/

export function buildCustomAppearanceTheme(theme: ImportedVscodeTheme): CustomAppearanceTheme {
  return {
    id: theme.id,
    label: theme.label,
    base: theme.base,
    appTokens: toAppTokens(theme),
    terminal: toTerminalOverrides(theme)
  }
}

function colorRecord(
  value: unknown,
  keyOk: (key: string) => boolean,
  colorOk: (color: string) => boolean
): Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        keyOk(entry[0]) && typeof entry[1] === 'string' && colorOk(entry[1])
    )
  )
}

/** Settings arrive from disk and other clients; keep only well-formed names and colors. */
export function normalizeCustomAppearanceTheme(value: unknown): CustomAppearanceTheme | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record: {
    id?: unknown
    label?: unknown
    base?: unknown
    appTokens?: unknown
    terminal?: unknown
  } = value
  if (
    typeof record.id !== 'string' ||
    !/^[a-z0-9-]{1,80}$/.test(record.id) ||
    typeof record.label !== 'string'
  ) {
    return null
  }
  return {
    id: record.id,
    label: record.label,
    base: toVscodeThemeBase(record.base),
    appTokens: colorRecord(
      record.appTokens,
      (key) => TOKEN_NAME_RE.test(key),
      (color) => parseThemeColor(color) !== null
    ),
    terminal: colorRecord(
      record.terminal,
      () => true,
      (color) => TERMINAL_COLOR_RE.test(color)
    )
  }
}

/** A dark theme only shows while the app is dark (and a light one while it is light). */
export function customThemeMatchesMode(theme: CustomAppearanceTheme, dark: boolean): boolean {
  return isDarkVscodeThemeBase(theme.base) === dark
}
