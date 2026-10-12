import type { ThemeRegistrationRaw } from 'shiki/core'
import { loadSyntaxTheme, THEMES } from './syntax-highlighter'

// Custom build (custom-appearance-theme): the imported VS Code theme colors chat code in its own
// mode (light or dark) instead of Light+ / Dark+; null restores both defaults.

const DEFAULT_THEMES = { light: 'light-plus', dark: 'dark-plus' } as const

export type SyntaxHighlightThemeOverride = {
  mode: 'light' | 'dark'
  theme: ThemeRegistrationRaw & { name: string }
}

let themeRevision = 0
const themeListeners = new Set<() => void>()

/** Bumped whenever the themes change, so colored blocks re-tokenize. */
export function syntaxHighlightThemeRevision(): number {
  return themeRevision
}

export function subscribeSyntaxHighlightTheme(listener: () => void): () => void {
  themeListeners.add(listener)
  return () => themeListeners.delete(listener)
}

export async function setSyntaxHighlightThemeOverride(
  override: SyntaxHighlightThemeOverride | null
): Promise<void> {
  const next: { light: string; dark: string } = { ...DEFAULT_THEMES }
  if (override) {
    await loadSyntaxTheme(override.theme)
    next[override.mode] = override.theme.name
  }
  if (next.light === THEMES.light && next.dark === THEMES.dark) {
    return
  }
  THEMES.light = next.light
  THEMES.dark = next.dark
  themeRevision += 1
  for (const listener of themeListeners) {
    listener()
  }
}
