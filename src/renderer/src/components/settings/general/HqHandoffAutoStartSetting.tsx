// Custom build (hq-handoff-auto): the switch for starting the new chat after a handoff by itself,
// apart from the session dispatcher's mode.
import React from 'react'
import { MessageSquarePlus } from 'lucide-react'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { NotificationSettingToggle } from '../notifications/NotificationSettingToggle'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { translate } from '@/i18n/i18n'

export function HqHandoffAutoStartSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element | null {
  if (!settings.hqPath) {
    return null
  }
  const enabled = settings.hqHandoffAutoStart !== false
  const title = translate('auto.hq.handoffAutoStart.settingTitle', 'New chat after a handoff')
  const description = translate(
    'auto.hq.handoffAutoStart.settingDescription',
    'When a chat runs out of context and saves a handoff, a new chat in the same project starts from it in the background about 20 seconds later and the old one closes to History. A chat on your screen is left for your own click; a chat stopped on a limit waits until it lifts. Works whatever the session dispatcher is set to.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['hq', 'hq+', 'handoff', 'context', 'new chat', 'continue', 'sessions']}
    >
      <NotificationSettingToggle
        icon={<MessageSquarePlus className="size-4" />}
        label={title}
        description={description}
        checked={enabled}
        onToggle={() => updateSettings({ hqHandoffAutoStart: !enabled })}
      />
    </SearchableSetting>
  )
}
