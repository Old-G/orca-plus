// Custom build (paper-theme): mounts «Auto: Paper on battery» once settings are in — before that a
// theme write would race the startup hydration.
import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { startPowerTheme } from './orca-plus-theme-actions'

export function useOrcaPlusPowerTheme(): void {
  const settingsLoaded = useAppStore((s) => s.settings !== null)
  useEffect(() => (settingsLoaded ? startPowerTheme() : undefined), [settingsLoaded])
}
