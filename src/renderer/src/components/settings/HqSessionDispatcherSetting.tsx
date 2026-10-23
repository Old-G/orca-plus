// Custom build (hq-plus-sessions): whether HQ+'s session dispatcher stays off, only writes what it
// would do to the journal, or continues, opens and queues chats itself.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  HQ_SESSION_DISPATCH_DEFAULT_MODE,
  HQ_SESSION_DISPATCH_MODES,
  type HqSessionDispatchMode
} from '../../../../shared/hq-sessions'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SearchableSetting } from './SearchableSetting'
import { translate } from '@/i18n/i18n'

function isMode(value: string): value is HqSessionDispatchMode {
  return HQ_SESSION_DISPATCH_MODES.some((mode) => mode === value)
}

export function HqSessionDispatcherSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element | null {
  if (!settings.hqPath) {
    return null
  }
  const value = settings.hqSessionDispatcher ?? HQ_SESSION_DISPATCH_DEFAULT_MODE
  const title = translate('auto.hq.sessionDispatcher.settingTitle', 'Session dispatcher')
  const description = translate(
    'auto.hq.sessionDispatcher.settingDescription',
    'Work handed to a thread goes to its chat while it has room and was active in the last 12 hours, else to a new chat that starts from the last report; handoffs nobody took up start in the background. A chat you are in is left alone; a project gets at most two live chats. Report only writes what it would do to the HQ+ journal.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['hq', 'hq+', 'sessions', 'chats', 'dispatcher', 'handoff', 'queue']}
      className="space-y-2"
    >
      <Label>{title}</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (isMode(next)) {
            updateSettings({ hqSessionDispatcher: next })
          }
        }}
      >
        <SelectTrigger size="sm" className="h-7 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">{translate('auto.hq.sessionDispatcher.off', 'Off')}</SelectItem>
          <SelectItem value="report">
            {translate('auto.hq.sessionDispatcher.report', 'Report only')}
          </SelectItem>
          <SelectItem value="on">{translate('auto.hq.sessionDispatcher.on', 'On')}</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{description}</p>
    </SearchableSetting>
  )
}
