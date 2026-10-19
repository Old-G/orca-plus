// Custom build (chat-auto-effort): the switch for per-message effort and the OpenRouter key it needs.
import React, { useEffect, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { SettingsSwitchRow } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

type ChatAutoEffortSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ChatAutoEffortSetting({
  settings,
  updateSettings
}: ChatAutoEffortSettingProps): React.JSX.Element | null {
  const enabled = settings.nativeChatAutoEffort === true
  // Why: absent on the paired web client and in tests that stub only part of the bridge.
  const api = window.api?.hqProjects
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    void api?.autoEffortKeyStatus?.().then((status) => setConfigured(status.configured))
  }, [api])

  if (!api?.autoEffortKeyStatus) {
    return null
  }
  const save = async (): Promise<void> => {
    const status = await api.saveAutoEffortKey?.(draft.trim())
    setConfigured(status?.configured ?? false)
    setDraft('')
  }
  const clear = async (): Promise<void> => {
    const status = await api.clearAutoEffortKey?.()
    setConfigured(status?.configured ?? false)
  }

  return (
    <div className="space-y-2 py-3">
      <SettingsSwitchRow
        label={translate('auto.chat.autoEffort.title', 'Effort per Message')}
        description={translate(
          'auto.chat.autoEffort.description',
          'Each message to a Claude chat sets its effort: medium for a quick step, high for ordinary work, extra high for hard or risky work. Picked by Jev on OpenRouter in about a second; Low and Max picked by hand stay.'
        )}
        checked={enabled}
        onChange={() => updateSettings({ nativeChatAutoEffort: !enabled })}
      />
      {enabled && configured === false ? (
        <div className="flex gap-2">
          <Input
            type="password"
            value={draft}
            placeholder={translate('auto.chat.autoEffort.keyPlaceholder', 'OpenRouter API key')}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button size="sm" disabled={!draft.trim()} onClick={() => void save()}>
            {translate('auto.chat.autoEffort.saveKey', 'Save')}
          </Button>
        </div>
      ) : null}
      {enabled && configured ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{translate('auto.chat.autoEffort.keySaved', 'OpenRouter key saved.')}</span>
          <Button size="sm" variant="ghost" onClick={() => void clear()}>
            {translate('auto.chat.autoEffort.removeKey', 'Remove')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
