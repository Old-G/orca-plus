import {
  DICTATION_LANGUAGES,
  type DictationLanguage,
  type VoiceSettings
} from '../../../../shared/speech-types'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { translate } from '@/i18n/i18n'

function languageLabel(language: DictationLanguage): string {
  switch (language) {
    case 'auto':
      return translate('auto.components.settings.VoiceDictationLanguage.auto', 'Auto-detect')
    case 'ru':
      return translate('auto.components.settings.VoiceDictationLanguage.ru', 'Russian')
    case 'en':
      return translate('auto.components.settings.VoiceDictationLanguage.en', 'English')
  }
}

function isDictationLanguage(value: string): value is DictationLanguage {
  return DICTATION_LANGUAGES.some((language) => language === value)
}

type VoiceDictationLanguageSettingProps = {
  voiceSettings: VoiceSettings
  onUpdateVoiceSettings: (updates: Partial<VoiceSettings>) => void
}

/** Custom build (dictation-language): the language cloud transcription is told to expect. */
export function VoiceDictationLanguageSetting({
  voiceSettings,
  onUpdateVoiceSettings
}: VoiceDictationLanguageSettingProps): React.JSX.Element {
  const value = voiceSettings.dictationLanguage ?? 'auto'
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="space-y-0.5">
        <Label>
          {translate('auto.components.settings.VoiceDictationLanguage.title', 'Dictation Language')}
        </Label>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.VoiceDictationLanguage.description',
            'Tells cloud models which language you speak. Auto-detect guesses from the audio.'
          )}
        </p>
      </div>
      <Select
        value={value}
        disabled={!voiceSettings.enabled}
        onValueChange={(next) => {
          if (isDictationLanguage(next)) {
            onUpdateVoiceSettings({ dictationLanguage: next })
          }
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={translate(
            'auto.components.settings.VoiceDictationLanguage.title',
            'Dictation Language'
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DICTATION_LANGUAGES.map((language) => (
            <SelectItem key={language} value={language}>
              {languageLabel(language)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
