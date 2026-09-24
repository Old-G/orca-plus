import { useState } from 'react'
import type React from 'react'
import { Palette, X } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  customThemeMatchesMode,
  normalizeCustomAppearanceTheme
} from '../../../../shared/vscode-theme/custom-appearance-theme'
import { isDarkVscodeThemeBase } from '../../../../shared/vscode-theme/vscode-theme-types'
import { useDocumentDarkTheme } from '@/components/editor/use-document-dark-theme'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow } from './SettingsFormControls'
import { VscodeThemePickerDialog } from './VscodeThemePickerDialog'

type CustomAppearanceThemeSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

/** Custom build (custom-appearance-theme-ui): the imported VS Code theme in use. */
export function CustomAppearanceThemeSetting({
  settings,
  updateSettings
}: CustomAppearanceThemeSettingProps): React.JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false)
  const dark = useDocumentDarkTheme()
  const theme = normalizeCustomAppearanceTheme(settings.customAppearanceTheme)
  const themeIsDark = theme ? isDarkVscodeThemeBase(theme.base) : false
  const title = translate('settings.appearance.customAppearance.theme.title', 'Theme')
  const description = theme
    ? theme.label
    : translate(
        'settings.appearance.customAppearance.theme.none',
        "None — Orca's own colors. Import a VS Code or Cursor theme."
      )

  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['theme', 'color theme', 'vscode', 'cursor', 'open vsx', 'vsix']}
    >
      <SettingsRow
        label={title}
        description={description}
        control={
          <div className="flex gap-2">
            <Button variant="outline" size="xs" onClick={() => setPickerOpen(true)}>
              <Palette className="size-3.5" />
              {theme
                ? translate('settings.appearance.customAppearance.theme.change', 'Change…')
                : translate('settings.appearance.customAppearance.theme.choose', 'Choose…')}
            </Button>
            {theme ? (
              <Button
                variant="outline"
                size="xs"
                onClick={() => updateSettings({ customAppearanceTheme: null })}
              >
                <X className="size-3.5" />
                {translate('settings.appearance.customAppearance.theme.remove', 'Remove')}
              </Button>
            ) : null}
          </div>
        }
      />
      {theme && !customThemeMatchesMode(theme, dark) ? (
        <div className="flex items-center justify-between gap-3 pb-3 text-xs text-muted-foreground">
          <span>
            {themeIsDark
              ? translate(
                  'settings.appearance.customAppearance.theme.pausedDark',
                  'This is a dark theme; it shows while Orca is dark.'
                )
              : translate(
                  'settings.appearance.customAppearance.theme.pausedLight',
                  'This is a light theme; it shows while Orca is light.'
                )}
          </span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => updateSettings({ theme: themeIsDark ? 'dark' : 'light' })}
          >
            {themeIsDark
              ? translate('settings.appearance.customAppearance.theme.switchDark', 'Switch to Dark')
              : translate(
                  'settings.appearance.customAppearance.theme.switchLight',
                  'Switch to Light'
                )}
          </Button>
        </div>
      ) : null}
      <VscodeThemePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        updateSettings={updateSettings}
      />
    </SearchableSetting>
  )
}
