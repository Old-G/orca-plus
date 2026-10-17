// Custom build (quiet-hours): the switch and span for hours when Orca+ leaves the phone and Slack alone.
import React, { useEffect, useId, useState } from 'react'
import { Moon } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  DEFAULT_ORCA_PLUS_QUIET_HOURS,
  orcaPlusQuietHours,
  type OrcaPlusQuietHours
} from '../../../../shared/orca-plus-quiet-hours'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { NotificationSettingToggle } from './NotificationSettingToggle'
import { translate } from '@/i18n/i18n'

function HourInput({
  label,
  value,
  onCommit
}: {
  label: string
  value: number
  onCommit: (hour: number) => void
}): React.JSX.Element {
  const inputId = useId()
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const parsed = Math.round(Number(draft))
    const next = draft.trim() !== '' && Number.isFinite(parsed) ? ((parsed % 24) + 24) % 24 : value
    setDraft(String(next))
    if (next !== value) {
      onCommit(next)
    }
  }
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        type="number"
        min={0}
        max={23}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
          }
        }}
        className="w-16"
      />
    </div>
  )
}

export function OrcaPlusQuietHoursSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}): React.JSX.Element {
  const hours = orcaPlusQuietHours(settings)
  const save = (next: OrcaPlusQuietHours | null): void => {
    void updateSettings({ orcaPlusQuietHours: next })
  }
  return (
    <div className="pb-2">
      <NotificationSettingToggle
        icon={<Moon className="size-4" />}
        label={translate('auto.orcaPlus.quietHours.title', 'Quiet Hours')}
        description={translate(
          'auto.orcaPlus.quietHours.description',
          'No phone pushes or Slack messages in these hours, except urgent bell items such as an Approve. Desktop notifications still show; the rest waits in the bell and HQ.'
        )}
        checked={hours !== null}
        onToggle={() => save(hours ? null : DEFAULT_ORCA_PLUS_QUIET_HOURS)}
      />
      {hours ? (
        <div className="flex flex-wrap items-center gap-4 pl-6">
          <HourInput
            label={translate('auto.orcaPlus.quietHours.from', 'From')}
            value={hours.start}
            onCommit={(start) => save({ ...hours, start })}
          />
          <HourInput
            label={translate('auto.orcaPlus.quietHours.to', 'To')}
            value={hours.end}
            onCommit={(end) => save({ ...hours, end })}
          />
          <span className="text-xs text-muted-foreground">
            {translate('auto.orcaPlus.quietHours.hint', 'hour of the day, 0–23, local time')}
          </span>
        </div>
      ) : null}
    </div>
  )
}
