import type React from 'react'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/class-names'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import { useAppStore } from '../../../store'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { CustomAppearanceBackgroundSetting } from './CustomAppearanceBackgroundSetting'
import { CustomAppearanceThemeSetting } from '../CustomAppearanceThemeSetting'
import { CustomCssSetting } from './CustomCssSetting'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { SettingsSwitchRow } from '../form-controls/SettingsFormControls'
import { getCustomCssEntries } from './appearance-custom-css-search'
import { getCustomAppearanceEntries } from './custom-appearance-search'
import { matchesSettingsSearch, normalizeSettingsSearchQuery } from '../search/settings-search'

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
  // Why: collapsed while off, so the stock layout is what users see.
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

  const expanded = isSearching || open
  const contentId = 'appearance-section-custom-appearance'

  return (
    // Why: upstream's settings are cards (SettingsGroup); the chevron keeps the block folded while off.
    <SettingsGroup
      id="custom-appearance"
      title={title}
      description={
        enabled
          ? translate('settings.appearance.customAppearance.summaryOn', 'On')
          : translate('settings.appearance.customAppearance.summaryOff', 'Off — stock Orca look')
      }
      action={
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={title}
          onClick={() => setOpen((current) => !current)}
          disabled={isSearching}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default"
        >
          <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
        </button>
      }
    >
      {expanded ? (
        <div id={contentId}>
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
              <CustomAppearanceThemeSetting settings={settings} updateSettings={updateSettings} />
              <CustomAppearanceBackgroundSetting
                settings={settings}
                updateSettings={updateSettings}
              />
              <CustomCssSetting settings={settings} updateSettings={updateSettings} />
            </>
          ) : null}
        </div>
      ) : null}
    </SettingsGroup>
  )
}
