// Custom build (chat-auto-effort): the switch for per-message effort and the OpenRouter key it needs.
import React, { useEffect, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ChatAutoEffortStatus } from '../../../../shared/chat-auto-effort-status'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { SettingsSwitchRow } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

type ChatAutoEffortSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function lastOutcomeLine(status: ChatAutoEffortStatus): string | null {
  const last = status.recent[0]
  if (!last) {
    return null
  }
  const when = new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return last.result === 'picked'
    ? translate('auto.chat.autoEffort.lastPicked', 'Last message ({{when}}): {{effort}}.', {
        when,
        effort: last.effort ?? ''
      })
    : last.result === 'no-effort-control'
      ? translate(
          'auto.chat.autoEffort.lastNoControl',
          'Last message ({{when}}): its model has no effort control, nothing was changed.',
          { when }
        )
      : translate(
          'auto.chat.autoEffort.lastMissed',
          'Last message ({{when}}): no answer from Jev, the chat kept its effort.',
          { when }
        )
}

export function ChatAutoEffortSetting({
  settings,
  updateSettings
}: ChatAutoEffortSettingProps): React.JSX.Element | null {
  const enabled = settings.nativeChatAutoEffort === true
  // Why: absent on the paired web client and in tests that stub only part of the bridge.
  const api = window.api?.hqProjects
  const [status, setStatus] = useState<ChatAutoEffortStatus | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    void api?.autoEffortKeyStatus?.().then(setStatus)
  }, [api, enabled])

  if (!api?.autoEffortKeyStatus) {
    return null
  }
  const save = async (): Promise<void> => {
    setStatus((await api.saveAutoEffortKey?.(draft.trim())) ?? null)
    setDraft('')
  }
  const clear = async (): Promise<void> => {
    setStatus((await api.clearAutoEffortKey?.()) ?? null)
  }
  const needsKey = status !== null && (!status.configured || !status.readable)
  const lastLine = status ? lastOutcomeLine(status) : null

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
      {enabled && needsKey ? (
        <div className="space-y-1">
          {status.configured ? (
            <p className="text-xs text-destructive">
              {translate(
                'auto.chat.autoEffort.keyUnreadable',
                'The saved key cannot be read on this Mac (it was saved by another build). Paste it again.'
              )}
            </p>
          ) : null}
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
        </div>
      ) : null}
      {enabled && status && !needsKey ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {lastLine ?? translate('auto.chat.autoEffort.keySaved', 'OpenRouter key saved.')}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void clear()}>
            {translate('auto.chat.autoEffort.removeKey', 'Remove')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
