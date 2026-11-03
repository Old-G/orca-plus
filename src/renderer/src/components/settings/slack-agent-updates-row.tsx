// Custom build (slack-notifications, owner 03.11): agent updates in Slack are opt-in — the bot stays
// connected for replies and HQ, and posts «agent finished / needs you» threads only when this is on.
import React from 'react'
import { Switch } from '../ui/switch'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'

export function SlackAgentUpdatesRow({ rowClass }: { rowClass: string }): React.JSX.Element {
  const enabled = useAppStore((s) => s.settings?.slackAgentUpdates === true)
  const updateSettings = useAppStore((s) => s.updateSettings)
  return (
    <div className={rowClass}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {translate('auto.components.settings.slack.agentUpdates.title', 'Agent updates in Slack')}
        </p>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.slack.agentUpdates.description',
            'Post a thread per workspace when an agent finishes or needs you. Off: the bot stays connected but sends nothing.'
          )}
        </p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={(checked) => void updateSettings({ slackAgentUpdates: checked })}
        aria-label={translate(
          'auto.components.settings.slack.agentUpdates.title',
          'Agent updates in Slack'
        )}
      />
    </div>
  )
}
