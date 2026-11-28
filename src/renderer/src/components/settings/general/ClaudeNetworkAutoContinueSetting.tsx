// Custom build (network auto-continue, A10 28.11): the switch for continuing an agent whose turn a
// network error cut, by itself.
import React from 'react'
import { WifiOff } from 'lucide-react'
import type { GlobalSettings } from '../../../../../shared/settings/global-settings-types'
import { NotificationSettingToggle } from '../notifications/NotificationSettingToggle'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { translate } from '@/i18n/i18n'

export function claudeNetworkAutoContinueSettingText(): { title: string; description: string } {
  return {
    title: translate(
      'auto.claude.networkAutoContinue.settingTitle',
      'Continue after a network error'
    ),
    description: translate(
      'auto.claude.networkAutoContinue.settingDescription',
      'When a dropped connection, a sleeping Mac or an API outage cuts a Claude chat or terminal agent mid-turn, Orca+ continues it by itself 1, 3 and 10 minutes after the stop, at most 3 times in a row, with a message in the chat that says so. A chat that saved a handoff is not continued. Usage limits and your own Stop are not affected. Off: the agent waits for you.'
    )
  }
}

export function ClaudeNetworkAutoContinueSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const enabled = settings.claudeNetworkAutoContinue !== false
  const { title, description } = claudeNetworkAutoContinueSettingText()
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['claude', 'network', 'connection', 'offline', 'continue', 'retry', 'resume']}
    >
      <NotificationSettingToggle
        icon={<WifiOff className="size-4" />}
        label={title}
        description={description}
        checked={enabled}
        onToggle={() => updateSettings({ claudeNetworkAutoContinue: !enabled })}
      />
    </SearchableSetting>
  )
}
