// Custom build (slack-reply-reader): the owner's own Slack token, which lets Orca+ hear answers to
// the chats' questions in DMs and threads the bot is not part of.
import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { SlackReaderStatus } from '../../../../shared/slack-types'
import { SLACK_READER_SCOPES } from '../../../../shared/slack-app-manifest'

export function SlackReaderRow({
  reader,
  rowClass,
  onChanged
}: {
  reader: SlackReaderStatus | undefined
  rowClass: string
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connected = reader?.connected === true

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    const result = await window.api.slack.connectReader(draft)
    setSaving(false)
    if (result.ok) {
      setDraft('')
    } else {
      setError(result.error)
    }
    await onChanged()
  }

  const remove = async (): Promise<void> => {
    await window.api.slack.disconnectReader()
    await onChanged()
  }

  const shownError = error ?? reader?.error ?? null
  return (
    <div className="space-y-2">
      <div className={rowClass}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {translate('auto.components.settings.slack.reader.title', 'Answers to your questions')}
          </p>
          <p className="text-xs text-muted-foreground">
            {connected
              ? translate(
                  'auto.components.settings.slack.reader.on',
                  'Orca+ reads the DMs and threads where a chat waits for an answer, as {{name}}.',
                  { name: reader?.user?.name ?? '' }
                )
              : translate(
                  'auto.components.settings.slack.reader.off',
                  'Add User Token Scopes {{scopes}} to the Slack app, reinstall it, and paste its User OAuth Token (xoxp-).',
                  { scopes: SLACK_READER_SCOPES.join(', ') }
                )}
          </p>
        </div>
        {connected ? (
          <Button variant="ghost" size="sm" onClick={() => void remove()}>
            {translate('auto.components.settings.slack.reader.remove', 'Remove')}
          </Button>
        ) : null}
      </div>
      {!connected ? (
        <div className={rowClass}>
          <div className="min-w-0 flex-1">
            <Input
              type="password"
              value={draft}
              placeholder="xoxp-…"
              onChange={(event) => {
                setDraft(event.target.value)
                setError(null)
              }}
              disabled={saving}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void save()}
            disabled={saving || draft.trim() === ''}
          >
            {translate('auto.components.settings.slack.reader.save', 'Save token')}
          </Button>
        </div>
      ) : null}
      {shownError ? (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          {shownError}
        </p>
      ) : null}
    </div>
  )
}
