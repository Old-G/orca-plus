// Custom build (hq-open-loops): whether the open-loop detector stays off or reports, in the
// HQ+ journal, who waits on whom in Slack and ClickUp — without adding or closing any waiting.
import React from 'react'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import {
  HQ_OPEN_LOOPS_MODES,
  hqOpenLoopsMode,
  type HqOpenLoopsMode
} from '../../../../../shared/hq-open-loops-mode'
import { Label } from '../../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { translate } from '@/i18n/i18n'

function isMode(value: string): value is HqOpenLoopsMode {
  return HQ_OPEN_LOOPS_MODES.some((mode) => mode === value)
}

export function hqOpenLoopsSettingText(): { title: string; description: string } {
  return {
    title: translate('auto.hq.openLoops.settingTitle', 'Open loops'),
    description: translate(
      'auto.hq.openLoops.settingDescription',
      'Finds, without a model, Slack and ClickUp threads where someone has waited on you for a day or you have waited on someone for three, and the message that answers it. Report only lists them in the HQ+ journal at most once an hour; no waiting is added or closed.'
    )
  }
}

export function HqOpenLoopsSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element | null {
  if (!settings.hqPath) {
    return null
  }
  const { title, description } = hqOpenLoopsSettingText()
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['hq', 'hq+', 'waitings', 'open loops', 'slack', 'clickup', 'notes']}
      className="space-y-2"
    >
      <Label>{title}</Label>
      <Select
        value={hqOpenLoopsMode(settings)}
        onValueChange={(next) => {
          if (isMode(next)) {
            updateSettings({ hqOpenLoops: next })
          }
        }}
      >
        <SelectTrigger size="sm" className="h-7 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">{translate('auto.hq.openLoops.off', 'Off')}</SelectItem>
          <SelectItem value="report">
            {translate('auto.hq.openLoops.report', 'Report only')}
          </SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{description}</p>
    </SearchableSetting>
  )
}
