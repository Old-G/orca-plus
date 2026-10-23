// Custom build (hq-plus-ui): whether HQ's events pop up on the right or land in HQ+'s feed.
import React from 'react'
import { PanelRightClose } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { NotificationSettingToggle } from './NotificationSettingToggle'
import { SearchableSetting } from './SearchableSetting'
import { translate } from '@/i18n/i18n'

export function HqFeedPopupsSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element | null {
  if (!settings.hqPath) {
    return null
  }
  const enabled = settings.hqPlusFeedInsteadOfPopups !== false
  const title = translate(
    'auto.hqPlus.popups.settingTitle',
    'Show HQ events in the HQ+ feed instead of popups'
  )
  const description = translate(
    'auto.hqPlus.popups.settingDescription',
    'Finished chats, Approve, Slack requests, people\'s answers, limits and handoffs become cards in HQ+ with an unread count on HQ+, instead of toasts on the right. Off brings the toasts back. Desktop and phone notifications are not changed.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['hq', 'hq+', 'toasts', 'popups', 'feed', 'notifications']}
    >
      <NotificationSettingToggle
        icon={<PanelRightClose className="size-4" />}
        label={title}
        description={description}
        checked={enabled}
        onToggle={() => updateSettings({ hqPlusFeedInsteadOfPopups: !enabled })}
      />
    </SearchableSetting>
  )
}
