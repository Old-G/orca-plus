// Custom build (chat-auto-effort): the switch for per-message effort and what it did last.
import React, { useEffect, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import type { ChatAutoEffortStatus } from '../../../../shared/chat-auto-effort-status'
import { SettingsSwitchRow } from './form-controls/SettingsFormControls'
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
    : last.result === 'role'
      ? translate(
          'auto.chat.autoEffort.lastRole',
          "Last message ({{when}}): {{effort}}, fixed by the chat's role; the classifier was not asked.",
          { when, effort: last.effort ?? '' }
        )
      : last.result === 'relayed'
        ? translate(
            'auto.chat.autoEffort.lastRelayed',
            'Last message ({{when}}): sent by another chat, the chat kept its effort.',
            { when }
          )
        : last.result === 'no-effort-control'
          ? translate(
              'auto.chat.autoEffort.lastNoControl',
              'Last message ({{when}}): its model has no effort control, nothing was changed.',
              { when }
            )
          : translate(
              'auto.chat.autoEffort.lastMissed',
              'Last message ({{when}}): no answer from the classifier, the chat kept its effort.',
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

  useEffect(() => {
    void api?.autoEffortKeyStatus?.().then(setStatus)
  }, [api, enabled])

  if (!api?.autoEffortKeyStatus) {
    return null
  }
  const lastLine = status ? lastOutcomeLine(status) : null

  return (
    <div className="space-y-2 py-3">
      <SettingsSwitchRow
        label={translate('auto.chat.autoEffort.title', 'Effort per Message')}
        description={translate(
          'auto.chat.autoEffort.description',
          'Each message to a Claude chat sets its effort: low for a trivial reply, medium for a quick step, high for ordinary work, extra high for hard or risky work. Picked by Claude Haiku on your Claude subscription in about two seconds; Max picked by hand stays.'
        )}
        checked={enabled}
        onChange={() => updateSettings({ nativeChatAutoEffort: !enabled })}
      />
      {enabled && lastLine ? <p className="text-xs text-muted-foreground">{lastLine}</p> : null}
    </div>
  )
}
