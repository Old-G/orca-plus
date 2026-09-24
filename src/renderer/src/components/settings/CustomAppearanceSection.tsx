import type React from 'react'
import { useState } from 'react'
import { Palette } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useAppStore } from '../../store'
import { AppearanceSection } from './AppearanceSection'
import { CustomAppearanceBackgroundSetting } from './CustomAppearanceBackgroundSetting'
import { CustomCssSetting } from './CustomCssSetting'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'
import { getCustomCssEntries } from './appearance-search'
import { getCustomAppearanceEntries } from './custom-appearance-search'
import { matchesSettingsSearch, normalizeSettingsSearchQuery } from './settings-search'

type CustomAppearanceSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

/** Custom build (custom-appearance): one opt-in block; off means the stock Orca look. */
export function CustomAppearanceSection({
  settings,
  updateSettings
}: CustomAppearanceSectionProps): React.JSX.Element | null {
  const searchQuery = useAppStore((state) => state.settingsSearchQuery)
  // Why: collapsed while off, so the stock layout (three open sections) is what users see.
  const [open, setOpen] = useState(() => settings.customAppearanceEnabled === true)
  if (isWebClientLocation()) {
    return null
  }
  const isSearching = normalizeSettingsSearchQuery(searchQuery).length > 0
  const [entry] = getCustomAppearanceEntries()
  if (
    isSearching &&
    !matchesSettingsSearch(searchQuery, [...getCustomAppearanceEntries(), ...getCustomCssEntries()])
  ) {
    return null
  }
  const enabled = settings.customAppearanceEnabled === true
  const title = translate('settings.appearance.customAppearance.title', 'Custom appearance')

  return (
    <AppearanceSection
      id="custom-appearance"
      icon={<Palette aria-hidden="true" />}
      title={title}
      summary={
        enabled
          ? translate('settings.appearance.customAppearance.summaryOn', 'On')
          : translate('settings.appearance.customAppearance.summaryOff', 'Off — stock Orca look')
      }
      open={isSearching || open}
      onToggle={() => setOpen((current) => !current)}
      toggleDisabled={isSearching}
    >
      <div className="divide-y divide-border/40">
        <SearchableSetting
          title={title}
          description={entry?.description}
          keywords={entry?.keywords ?? ['custom', 'theme', 'appearance']}
        >
          <SettingsSwitchRow
            label={translate(
              'settings.appearance.customAppearance.switchLabel',
              'Use custom appearance'
            )}
            description={entry?.description}
            checked={enabled}
            onChange={() => updateSettings({ customAppearanceEnabled: !enabled })}
          />
        </SearchableSetting>
        {enabled ? (
          <>
            <CustomAppearanceBackgroundSetting
              settings={settings}
              updateSettings={updateSettings}
            />
            <CustomCssSetting settings={settings} updateSettings={updateSettings} />
          </>
        ) : null}
      </div>
    </AppearanceSection>
  )
}
