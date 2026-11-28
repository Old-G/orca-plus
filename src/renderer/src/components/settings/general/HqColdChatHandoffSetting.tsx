// Custom build (hq-cold-handoff, L3 28.11): a message to a quiet chat with a full context starts a new
// chat from its report instead of waking it. Off by default.
import React from 'react'
import { Snowflake } from 'lucide-react'
import type { GlobalSettings } from '../../../../../shared/settings/global-settings-types'
import { NotificationSettingToggle } from '../notifications/NotificationSettingToggle'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { translate } from '@/i18n/i18n'

export function HqColdChatHandoffSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element | null {
  if (!settings.hqPath) {
    return null
  }
  const enabled = settings.hqColdChatHandoff === true
  const title = translate(
    'auto.hq.coldChatHandoff.settingTitle',
    'New chat instead of waking a cold one'
  )
  const description = translate(
    'auto.hq.coldChatHandoff.settingDescription',
    'A message to a chat quiet over an hour with 100k+ tokens of context does not wake it: a new chat on the same thread starts from its last report and takes the message, which saves re-reading the whole context. Leads, chats in a turn and chats you are in get the message as before; so does every chat if the new one fails to start.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['hq', 'hq+', 'handoff', 'context', 'new chat', 'cold', 'limits']}
    >
      <NotificationSettingToggle
        icon={<Snowflake className="size-4" />}
        label={title}
        description={description}
        checked={enabled}
        onToggle={() => updateSettings({ hqColdChatHandoff: !enabled })}
      />
    </SearchableSetting>
  )
}
