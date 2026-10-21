// Custom build (chat-cleanup): whether quiet chats are left alone, only reported in HQ, or closed.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  HQ_CHAT_CLEANUP_DEFAULT_MODE,
  type HqChatCleanupMode
} from '../orca-plus/hq/hq-chat-cleanup'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SearchableSetting } from './SearchableSetting'
import { translate } from '@/i18n/i18n'

const MODES: readonly HqChatCleanupMode[] = ['off', 'report', 'on']

function isMode(value: string): value is HqChatCleanupMode {
  return MODES.some((mode) => mode === value)
}

export function HqChatCleanupSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element | null {
  if (!settings.hqPath) {
    return null
  }
  const value = settings.hqChatCleanup ?? HQ_CHAT_CLEANUP_DEFAULT_MODE
  const title = translate('auto.hq.chatCleanup.settingTitle', 'Close quiet chats')
  const description = translate(
    'auto.hq.chatCleanup.settingDescription',
    'A chat read after it finished closes after 12 hours, any chat after a quiet day — like its ×, so History reopens it. Chats that work, wait for you or for an answer, pinned or marked ones stay. Report only lists them in HQ Reports.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['hq', 'chats', 'close', 'cleanup', 'tabs', 'sessions']}
      className="space-y-2"
    >
      <Label>{title}</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (isMode(next)) {
            updateSettings({ hqChatCleanup: next })
          }
        }}
      >
        <SelectTrigger size="sm" className="h-7 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">{translate('auto.hq.chatCleanup.off', 'Off')}</SelectItem>
          <SelectItem value="report">
            {translate('auto.hq.chatCleanup.report', 'Report only')}
          </SelectItem>
          <SelectItem value="on">{translate('auto.hq.chatCleanup.on', 'On')}</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{description}</p>
    </SearchableSetting>
  )
}
