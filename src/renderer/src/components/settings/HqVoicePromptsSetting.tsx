// Custom build (hq-voice-prompts): the switch for the preview that turns a dictation into a brief, a
// message, a ClickUp task or an idea before it is inserted.
import { Sparkles } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { NotificationSettingToggle } from './NotificationSettingToggle'

export function HqVoicePromptsSetting(): React.JSX.Element {
  const enabled = useAppStore((s) => s.settings?.hqVoicePromptsEnabled === true)
  const updateSettings = useAppStore((s) => s.updateSettings)
  return (
    <NotificationSettingToggle
      icon={<Sparkles className="size-4" />}
      label={translate('auto.hq.voice.settingTitle', 'Voice Prompts')}
      description={translate(
        'auto.hq.voice.settingDescription',
        'After dictation, pick what it becomes before it is inserted: as said, a brief for an agent, a message in your tone, a ClickUp task or an idea for HQ. Start with «для агента», «человеку», «в кликап» or «идея» to pick it by voice.'
      )}
      checked={enabled}
      onToggle={() => void updateSettings({ hqVoicePromptsEnabled: !enabled })}
    />
  )
}
