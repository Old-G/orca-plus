// Custom build (paper-theme): what the HQ+ theme menu by Brain does. A fixed mode writes
// the stock `theme` and turns main's Auto off; an Auto mode hands the theme to main. Effects come in
// as deps so tests drive them without a window or a store.
import { applyDocumentTheme } from '@/app-shell/appearance/document-theme'
import { useAppStore } from '@/store'
import {
  autoForMode,
  setThemeAuto,
  themeForMode,
  type AppTheme,
  type OrcaPlusThemeMode,
  type ThemeAuto
} from './orca-plus-theme-mode'

export type ThemeDeps = {
  apply: (theme: AppTheme) => void
  setAuto: (auto: ThemeAuto) => void
}

export const themeDeps: ThemeDeps = {
  apply: (theme) => {
    // Why paint too: the store writes through IPC first, and the click should flip at once.
    applyDocumentTheme(theme)
    void useAppStore.getState().updateSettings({ theme })
  },
  setAuto: setThemeAuto
}

export function setOrcaPlusThemeMode(mode: OrcaPlusThemeMode, deps: ThemeDeps = themeDeps): void {
  deps.setAuto(autoForMode(mode))
  const theme = themeForMode(mode)
  if (theme) {
    deps.apply(theme)
  }
}
