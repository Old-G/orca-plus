// Custom build (hq-palette): picks HQ+'s palette — the classic look or «Графит» / «Бумага». Classic is the
// default; the old look stays one click away.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { hqPlusPalette, type HqPlusPalette } from '../../../../shared/hq-plus-palette'
import { SettingsRow, SettingsSegmentedControl } from './form-controls/SettingsFormControls'
import { translate } from '@/i18n/i18n'

export function HqPlusPaletteSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const title = translate('auto.orcaPlus.palette.title', 'HQ+ palette')
  return (
    <SettingsRow
      label={title}
      description={translate(
        'auto.orcaPlus.palette.description',
        'Classic is the ice-blue look HQ+ always had. Graphite (dark) and Paper (light) is a quieter one: neutral greys with four colours that mean something. Dark or light stays in the HQ+ theme menu.'
      )}
      control={
        <SettingsSegmentedControl<HqPlusPalette>
          ariaLabel={title}
          value={hqPlusPalette(settings)}
          onChange={(next) => updateSettings({ hqPlusPalette: next })}
          options={[
            { value: 'classic', label: translate('auto.orcaPlus.palette.classic', 'Classic') },
            {
              value: 'graphite',
              label: translate('auto.orcaPlus.palette.graphite', 'Graphite & Paper')
            }
          ]}
        />
      }
    />
  )
}
