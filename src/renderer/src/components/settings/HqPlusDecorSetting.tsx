// Custom build (hq-decor): HQ+ with or without its decoration. Full is the default; the old look stays one
// click away.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { hqPlusDecor, type HqPlusDecor } from '../../../../shared/hq-plus-decor'
import { SettingsRow, SettingsSegmentedControl } from './form-controls/SettingsFormControls'
import { translate } from '@/i18n/i18n'

export function HqPlusDecorSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const title = translate('auto.orcaPlus.decor.title', 'HQ+ decoration')
  return (
    <SettingsRow
      label={title}
      description={translate(
        'auto.orcaPlus.decor.description',
        'Full is the look HQ+ always had. Calm takes off the background glow, the shadows and glowing dots, the gradient edges, the capital letters on labels and the second Approve bar, and gives project cards one plain edge. Works with either palette.'
      )}
      control={
        <SettingsSegmentedControl<HqPlusDecor>
          ariaLabel={title}
          value={hqPlusDecor(settings)}
          onChange={(next) => updateSettings({ hqPlusDecor: next })}
          options={[
            { value: 'full', label: translate('auto.orcaPlus.decor.full', 'Full') },
            { value: 'calm', label: translate('auto.orcaPlus.decor.calm', 'Calm') }
          ]}
        />
      }
    />
  )
}
