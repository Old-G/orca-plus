import { useEffect, useMemo } from 'react'
import { buildAppTokensCss } from '../../../shared/vscode-theme/vscode-theme-app-tokens'
import {
  customThemeMatchesMode,
  normalizeCustomAppearanceTheme
} from '../../../shared/vscode-theme/custom-appearance-theme'
import { useDocumentDarkTheme } from '@/components/editor/use-document-dark-theme'
import { createAdoptedSheetSlot } from '@/lib/custom-appearance/adopted-sheet-slot'
import { useAppStore } from '../store'

const applyThemeSheet = createAdoptedSheetSlot({ prepend: true })
// Why a flag: don't pull Monaco into a window that never had a theme to apply or undo.
let monacoThemeTouched = false

/** Custom build (custom-appearance-theme): repaints UI tokens and Monaco with the imported theme. */
export function useCustomAppearanceTheme(): void {
  const enabled = useAppStore((s) => s.settings?.customAppearanceEnabled === true)
  const raw = useAppStore((s) => s.settings?.customAppearanceTheme)
  const dark = useDocumentDarkTheme()
  const theme = useMemo(() => normalizeCustomAppearanceTheme(raw), [raw])
  const active = enabled && theme !== null && customThemeMatchesMode(theme, dark) ? theme : null

  useEffect(() => {
    applyThemeSheet(document, active ? buildAppTokensCss(active.appTokens) : null)
  }, [active])

  const activeId = active?.id ?? null
  useEffect(() => {
    if ((!activeId && !monacoThemeTouched) || !window.api.vscodeThemes) {
      return
    }
    monacoThemeTouched = true
    let cancelled = false
    void (async () => {
      const full = activeId ? await window.api.vscodeThemes.readImported(activeId) : null
      const { applyCustomMonacoTheme } =
        await import('@/lib/custom-appearance/custom-appearance-monaco')
      if (!cancelled) {
        applyCustomMonacoTheme(full)
      }
    })().catch((error: unknown) => console.warn('[custom-appearance] Monaco theme failed', error))
    return () => {
      cancelled = true
    }
  }, [activeId])
}
