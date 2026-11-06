// Custom build (paper-theme): Orca+'s theme modes on top of the stock `theme` setting — Dark (dark),
// Paper (light), Auto: follow macOS (system) and Auto: Paper on battery, which is ours: it writes
// light or dark into `theme` as the Mac leaves or returns to the charger. Whether it is on is a
// per-device choice, remembered in this browser profile like HQ's flavor.
import { useSyncExternalStore } from 'react'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'

export type AppTheme = GlobalSettings['theme']
export type OrcaPlusThemeMode = 'dark' | 'paper' | 'auto-battery' | 'auto-system'

export const ORCA_PLUS_THEME_MODES: readonly OrcaPlusThemeMode[] = [
  'dark',
  'paper',
  'auto-battery',
  'auto-system'
]

/** What the menu shows as picked, from the stock setting and our own flag. */
export function themeModeOf(theme: AppTheme, followsBattery: boolean): OrcaPlusThemeMode {
  if (followsBattery) {
    return 'auto-battery'
  }
  return theme === 'system' ? 'auto-system' : theme === 'light' ? 'paper' : 'dark'
}

/** On battery the screen goes dim, and Paper reads better dim; on the charger, dark. */
export function themeOnPower(onBattery: boolean): AppTheme {
  return onBattery ? 'light' : 'dark'
}

/** The stock setting a mode writes; the battery mode needs the current power source. */
export function themeForMode(mode: OrcaPlusThemeMode, onBattery: boolean): AppTheme {
  switch (mode) {
    case 'dark':
      return 'dark'
    case 'paper':
      return 'light'
    case 'auto-system':
      return 'system'
    case 'auto-battery':
      return themeOnPower(onBattery)
  }
}

/** One click on the sun/moon: the other of what is on screen now, and no more auto. */
export function toggledTheme(darkNow: boolean): AppTheme {
  return darkNow ? 'light' : 'dark'
}

const KEY = 'orca-plus.theme-auto'
const listeners = new Set<() => void>()
let current: boolean | null = null

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'battery'
  } catch {
    return false
  }
}

export function themeFollowsBattery(): boolean {
  current ??= read()
  return current
}

export function setThemeFollowsBattery(next: boolean): void {
  current = next
  try {
    if (next) {
      window.localStorage.setItem(KEY, 'battery')
    } else {
      window.localStorage.removeItem(KEY)
    }
  } catch {
    // Why: a profile without storage still follows the charger for this session.
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useThemeFollowsBattery(): boolean {
  return useSyncExternalStore(subscribe, themeFollowsBattery, themeFollowsBattery)
}
