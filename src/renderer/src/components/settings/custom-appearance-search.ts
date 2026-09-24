import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { isWebClientLocation } from '@/lib/web-client-location'
import type { SettingsSearchEntry } from './settings-search'

const CUSTOM_APPEARANCE_KEYWORDS = ['custom', 'theme', 'appearance', 'background', 'wallpaper']

const getCustomAppearanceEntryCatalog = createLocalizedCatalog((): SettingsSearchEntry[] => [
  {
    title: translate('settings.appearance.customAppearance.title', 'Custom appearance'),
    description: translate(
      'settings.appearance.customAppearance.description',
      'Your own theme, background image and CSS on top of Orca. Turn it off to get the stock look back.'
    ),
    keywords: [...CUSTOM_APPEARANCE_KEYWORDS]
  }
])

/** Custom build (custom-appearance): desktop-only, like custom.css. */
export function getCustomAppearanceEntries(): SettingsSearchEntry[] {
  return isWebClientLocation() ? [] : getCustomAppearanceEntryCatalog()
}
