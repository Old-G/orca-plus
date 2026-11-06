// Custom build (paper-theme): Orca+'s theme modes on top of the stock `theme` setting — Dark (dark),
// Paper (light), Auto: follow macOS (system), and two of ours that main runs (theme-auto.ts): Auto:
// Paper on battery and Auto: Paper at low brightness. Main keeps which Auto is on; this mirrors it.
import { useSyncExternalStore } from 'react'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import type { OrcaPlusThemeAutoMode } from '../../../../../preload/api/orca-plus-theme-api'

export type AppTheme = GlobalSettings['theme']
export type ThemeAuto = OrcaPlusThemeAutoMode
export type OrcaPlusThemeMode =
  | 'dark'
  | 'paper'
  | 'auto-battery'
  | 'auto-brightness'
  | 'auto-system'

export const ORCA_PLUS_THEME_MODES: readonly OrcaPlusThemeMode[] = [
  'dark',
  'paper',
  'auto-brightness',
  'auto-battery',
  'auto-system'
]

/** What the menu shows as picked, from the stock setting and main's Auto. */
export function themeModeOf(theme: AppTheme, auto: ThemeAuto): OrcaPlusThemeMode {
  if (auto === 'battery') {
    return 'auto-battery'
  }
  if (auto === 'brightness') {
    return 'auto-brightness'
  }
  return theme === 'system' ? 'auto-system' : theme === 'light' ? 'paper' : 'dark'
}

/** The Auto main should run for a mode. */
export function autoForMode(mode: OrcaPlusThemeMode): ThemeAuto {
  return mode === 'auto-battery' ? 'battery' : mode === 'auto-brightness' ? 'brightness' : 'off'
}

/** The stock setting a fixed mode writes; the main-run Auto modes write it themselves. */
export function themeForMode(mode: OrcaPlusThemeMode): AppTheme | null {
  switch (mode) {
    case 'dark':
      return 'dark'
    case 'paper':
      return 'light'
    case 'auto-system':
      return 'system'
    default:
      return null
  }
}

const listeners = new Set<() => void>()
let current: ThemeAuto = 'off'
let loaded = false

function emit(next: ThemeAuto): void {
  current = next
  listeners.forEach((listener) => listener())
}

function load(): void {
  if (loaded || typeof window === 'undefined' || !window.api?.orcaPlusTheme) {
    return
  }
  loaded = true
  void window.api.orcaPlusTheme
    .getAuto()
    .then(emit)
    .catch(() => {})
  window.api.orcaPlusTheme.onAutoChanged(emit)
}

export function themeAuto(): ThemeAuto {
  return current
}

/** Mirrors the pick at once; main confirms through onAutoChanged. */
export function setThemeAuto(next: ThemeAuto): void {
  emit(next)
  void window.api?.orcaPlusTheme?.setAuto(next).catch(() => {})
}

function subscribe(listener: () => void): () => void {
  load()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useThemeAuto(): ThemeAuto {
  return useSyncExternalStore(subscribe, themeAuto, themeAuto)
}
