// Custom build (hq-plus-journal): the switch for HQ+'s journal; off, nothing new is written to it.
import React from 'react'
import { NotebookText } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { NotificationSettingToggle } from './NotificationSettingToggle'
import { SearchableSetting } from './SearchableSetting'
import { translate } from '@/i18n/i18n'

export function HqJournalSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element | null {
  if (!settings.hqPath) {
    return null
  }
  const enabled = settings.hqPlusJournalEnabled !== false
  const title = translate('auto.hq.journal.settingTitle', 'HQ+ journal')
  const description = translate(
    'auto.hq.journal.settingDescription',
    'Keeps one journal of what happened — waitings and answers, Approve, finished chats, Codex reviews — for agents to read with `orca hq events`. Off stops filling it; what is there stays.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['hq', 'journal', 'events', 'agents', 'hq+']}
    >
      <NotificationSettingToggle
        icon={<NotebookText className="size-4" />}
        label={title}
        description={description}
        checked={enabled}
        onToggle={() => updateSettings({ hqPlusJournalEnabled: !enabled })}
      />
    </SearchableSetting>
  )
}
