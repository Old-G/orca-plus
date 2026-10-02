// Custom build (hq-screen): how long an unfinished session stays quiet before HQ lists it as deferred.
import React, { useEffect, useId, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { HQ_DEFERRED_DEFAULT_MINUTES } from '../orca-plus/hq/hq-deferred-sessions'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { translate } from '@/i18n/i18n'

const MIN_MINUTES = 5
const MAX_MINUTES = 24 * 60

export function HqDeferredSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element | null {
  const inputId = useId()
  const value = settings.hqDeferredAfterMinutes ?? HQ_DEFERRED_DEFAULT_MINUTES
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  if (!settings.hqPath) {
    return null
  }
  const commit = (): void => {
    const parsed = Math.round(Number(draft))
    const next = Number.isFinite(parsed)
      ? Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, parsed))
      : value
    setDraft(String(next))
    if (next !== value) {
      updateSettings({ hqDeferredAfterMinutes: next })
    }
  }
  const title = translate('auto.hq.deferred.settingTitle', 'Deferred sessions after')
  const description = translate(
    'auto.hq.deferred.settingDescription',
    'Minutes a session stays quiet with its work unfinished before HQ lists it under Deferred.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['hq', 'deferred', 'quiet', 'session', 'agents']}
      className="space-y-2"
    >
      <Label htmlFor={inputId}>{title}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          type="number"
          min={MIN_MINUTES}
          max={MAX_MINUTES}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
            }
          }}
          className="w-24"
        />
        <span className="text-xs text-muted-foreground">
          {translate('auto.hq.deferred.minutes', 'minutes')}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </SearchableSetting>
  )
}
