import { useCallback, useEffect, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { buildCustomAppearanceTheme } from '../../../../shared/vscode-theme/custom-appearance-theme'
import type {
  ImportedThemeSummary,
  InstalledThemeExtensionSummary,
  OpenedThemeSource,
  OpenVsxThemeSearchResult,
  ThemeImportError,
  ThemeSourceRequest
} from '../../../../shared/vscode-theme/vscode-theme-ipc'
import { isDarkVscodeThemeBase } from '../../../../shared/vscode-theme/vscode-theme-types'

// Custom build (custom-appearance-theme-ui): state and IPC for the theme picker dialog.

export type PickerError = ThemeImportError | 'import-failed' | 'search-failed'

/** Puts an imported theme in use and switches the app to the theme's own mode. */
export async function applyImportedTheme(
  id: string,
  updateSettings: (updates: Partial<GlobalSettings>) => void
): Promise<boolean> {
  const theme = await window.api.vscodeThemes.readImported(id)
  if (!theme) {
    return false
  }
  updateSettings({
    customAppearanceTheme: buildCustomAppearanceTheme(theme),
    theme: isDarkVscodeThemeBase(theme.base) ? 'dark' : 'light'
  })
  return true
}

export type VscodeThemePicker = {
  imported: ImportedThemeSummary[]
  installed: InstalledThemeExtensionSummary[] | null
  searchResults: OpenVsxThemeSearchResult[] | null
  opened: OpenedThemeSource | null
  busy: boolean
  error: PickerError | null
  search: (query: string) => Promise<void>
  open: (request: ThemeSourceRequest) => Promise<void>
  closeSource: () => void
  pick: (label: string) => Promise<void>
  choose: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export function useVscodeThemePicker(
  active: boolean,
  updateSettings: (updates: Partial<GlobalSettings>) => void,
  onDone: () => void
): VscodeThemePicker {
  const [imported, setImported] = useState<ImportedThemeSummary[]>([])
  const [installed, setInstalled] = useState<InstalledThemeExtensionSummary[] | null>(null)
  const [searchResults, setSearchResults] = useState<OpenVsxThemeSearchResult[] | null>(null)
  const [opened, setOpened] = useState<OpenedThemeSource | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<PickerError | null>(null)

  const refreshImported = useCallback(async () => {
    setImported(await window.api.vscodeThemes.listImported())
  }, [])

  useEffect(() => {
    if (!active) {
      return
    }
    setOpened(null)
    setError(null)
    void refreshImported()
    void window.api.vscodeThemes.listInstalled().then(setInstalled)
  }, [active, refreshImported])

  const run = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await task()
    } finally {
      setBusy(false)
    }
  }

  const choose = async (id: string): Promise<void> =>
    run(async () => {
      if (await applyImportedTheme(id, updateSettings)) {
        onDone()
      } else {
        setError('import-failed')
      }
    })

  return {
    imported,
    installed,
    searchResults,
    opened,
    busy,
    error,
    search: (query) =>
      run(async () => {
        const results = await window.api.vscodeThemes.searchOpenVsx(query)
        setSearchResults(results ?? [])
        if (!results) {
          setError('search-failed')
        }
      }),
    open: (request) =>
      run(async () => {
        const result = await window.api.vscodeThemes.openSource(request)
        if (result && 'error' in result) {
          setError(result.error)
        } else if (result) {
          setOpened(result)
        }
      }),
    closeSource: () => setOpened(null),
    pick: (label) =>
      run(async () => {
        const summary = opened
          ? await window.api.vscodeThemes.importTheme(opened.token, label)
          : null
        if (!summary || !(await applyImportedTheme(summary.id, updateSettings))) {
          setError('import-failed')
          return
        }
        await refreshImported()
        onDone()
      }),
    choose,
    remove: (id) =>
      run(async () => {
        await window.api.vscodeThemes.removeImported(id)
        await refreshImported()
      })
  }
}
