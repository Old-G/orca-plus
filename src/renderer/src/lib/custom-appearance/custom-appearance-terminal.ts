import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  customThemeMatchesMode,
  normalizeCustomAppearanceTheme
} from '../../../../shared/vscode-theme/custom-appearance-theme'

type CustomAppearanceSettings = Partial<
  Pick<GlobalSettings, 'customAppearanceEnabled' | 'customAppearanceTheme'>
>

/** Custom build (custom-appearance-theme): layers the imported theme's colors over the terminal theme. */
export function withCustomAppearanceTerminalColors<T extends object>(
  theme: T | null,
  settings: CustomAppearanceSettings,
  dark: boolean
): T | null {
  if (!theme) {
    return theme
  }
  const custom = settings.customAppearanceEnabled
    ? normalizeCustomAppearanceTheme(settings.customAppearanceTheme)
    : null
  return custom && customThemeMatchesMode(custom, dark) ? { ...theme, ...custom.terminal } : theme
}
