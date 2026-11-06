// Custom build (paper-theme): what the sun/moon button, the HQ+ theme menu and the charger do to the
// stock `theme` setting. Effects come in as deps so tests drive them without a window or a store.
import { applyDocumentTheme } from '@/lib/document-theme'
import { useAppStore } from '@/store'
import {
  setThemeFollowsBattery,
  themeFollowsBattery,
  themeForMode,
  themeOnPower,
  toggledTheme,
  type AppTheme,
  type OrcaPlusThemeMode
} from './orca-plus-theme-mode'

export type ThemeDeps = {
  apply: (theme: AppTheme) => void
  setFollowsBattery: (next: boolean) => void
  followsBattery: () => boolean
  isOnBattery: () => Promise<boolean>
  onPowerChanged: (callback: (change: { onBattery: boolean }) => void) => () => void
  darkNow: () => boolean
}

export const themeDeps: ThemeDeps = {
  apply: (theme) => {
    // Why paint too: the store writes through IPC first, and the click should flip at once.
    applyDocumentTheme(theme)
    void useAppStore.getState().updateSettings({ theme })
  },
  setFollowsBattery: setThemeFollowsBattery,
  followsBattery: themeFollowsBattery,
  isOnBattery: () => window.api.orcaPlusPower?.isOnBattery() ?? Promise.resolve(false),
  onPowerChanged: (callback) => window.api.orcaPlusPower?.onChanged(callback) ?? (() => {}),
  darkNow: () => document.documentElement.classList.contains('dark')
}

export async function setOrcaPlusThemeMode(
  mode: OrcaPlusThemeMode,
  deps: ThemeDeps = themeDeps
): Promise<void> {
  deps.setFollowsBattery(mode === 'auto-battery')
  const onBattery = mode === 'auto-battery' ? await deps.isOnBattery().catch(() => false) : false
  deps.apply(themeForMode(mode, onBattery))
}

export function toggleOrcaPlusTheme(deps: ThemeDeps = themeDeps): void {
  deps.setFollowsBattery(false)
  deps.apply(toggledTheme(deps.darkNow()))
}

/** While «Auto: Paper on battery» is on, the charger decides; checks once at start too, since the
 *  Mac may have changed source while Orca+ was closed. Returns the unsubscribe. */
export function startPowerTheme(deps: ThemeDeps = themeDeps): () => void {
  let stopped = false
  const stop = deps.onPowerChanged(({ onBattery }) => {
    if (deps.followsBattery()) {
      deps.apply(themeOnPower(onBattery))
    }
  })
  if (deps.followsBattery()) {
    void deps
      .isOnBattery()
      .then((onBattery) => {
        if (!stopped && deps.followsBattery()) {
          deps.apply(themeOnPower(onBattery))
        }
      })
      .catch(() => {})
  }
  return () => {
    stopped = true
    stop()
  }
}
