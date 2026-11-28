// Custom build (hq-dispatcher-cleanup, A5 28.11): whether the dispatcher's sweep closes finished chats
// nobody needs open by itself, only writes what it would close, or leaves them.
import React from 'react'
import type { GlobalSettings } from '../../../../../shared/settings/global-settings-types'
import {
  HQ_DISPATCHER_CLEANUP_DEFAULT_MODE,
  HQ_DISPATCHER_CLEANUP_MODES,
  type HqDispatcherCleanupMode
} from '../../../../../shared/hq-sessions'
import { Label } from '../../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { translate } from '@/i18n/i18n'

function isMode(value: string): value is HqDispatcherCleanupMode {
  return HQ_DISPATCHER_CLEANUP_MODES.some((mode) => mode === value)
}

export function HqDispatcherCleanupSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element | null {
  if (!settings.hqPath) {
    return null
  }
  const value = settings.hqDispatcherCleanup ?? HQ_DISPATCHER_CLEANUP_DEFAULT_MODE
  const title = translate('auto.hq.dispatcherCleanup.settingTitle', 'Close finished agent chats')
  const description = translate(
    'auto.hq.dispatcherCleanup.settingDescription',
    'Every two minutes chats nobody needs open close to History: one that handed off to a new chat, one another chat launched that is quiet 2 hours with its report in, and a launch never used for 30 minutes. Chats you opened, Leads, chats on a plan row, working or waiting ones and the one in front of you stay. Report only writes what it would close.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['hq', 'hq+', 'chats', 'close', 'cleanup', 'dispatcher', 'history']}
      className="space-y-2"
    >
      <Label>{title}</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (isMode(next)) {
            updateSettings({ hqDispatcherCleanup: next })
          }
        }}
      >
        <SelectTrigger size="sm" className="h-7 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">{translate('auto.hq.dispatcherCleanup.off', 'Off')}</SelectItem>
          <SelectItem value="report">
            {translate('auto.hq.dispatcherCleanup.report', 'Report only')}
          </SelectItem>
          <SelectItem value="on">{translate('auto.hq.dispatcherCleanup.on', 'On')}</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{description}</p>
    </SearchableSetting>
  )
}
