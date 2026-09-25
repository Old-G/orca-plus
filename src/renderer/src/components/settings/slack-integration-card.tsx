import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, ExternalLink, LoaderCircle } from 'lucide-react'
import { SlackConnectDialog } from '@/components/slack-connect-dialog'
import { SlackIcon } from '@/components/icons/SlackIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import type { SlackConnectionStatus } from '../../../../shared/slack-types'
import { buildSlackCreateAppUrl } from '../../../../shared/slack-app-manifest'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import { useIntegrationSubordinateRowClass } from './integration-card-presentation'

export const SLACK_INTEGRATION_SECTION_ID = 'integrations-slack'

type ActionResult = { state: 'ok' } | { state: 'error'; error: string }

export function SlackIntegrationCard(): React.JSX.Element {
  const mountedRef = useMountedRef()
  const [status, setStatus] = useState<SlackConnectionStatus | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ActionResult | null>(null)
  const [targetKind, setTargetKind] = useState<'dm' | 'channel'>('dm')
  const [channelDraft, setChannelDraft] = useState('')
  const [savingTarget, setSavingTarget] = useState(false)
  const [targetResult, setTargetResult] = useState<ActionResult | null>(null)
  const rowClass = useIntegrationSubordinateRowClass('flex items-center gap-3')

  const refresh = useCallback(async (): Promise<void> => {
    const next = await window.api.slack.status()
    if (mountedRef.current) {
      setStatus(next)
      setTargetKind(next.target.kind)
    }
  }, [mountedRef])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const checking = status === null
  const connected = status?.connected === true

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    const result = await window.api.slack.sendTest()
    if (!mountedRef.current) {
      return
    }
    setTesting(false)
    setTestResult(result.ok ? { state: 'ok' } : { state: 'error', error: result.error })
    await refresh()
  }

  const handleDisconnect = async (): Promise<void> => {
    await window.api.slack.disconnect()
    setTestResult(null)
    setTargetResult(null)
    await refresh()
  }

  const saveTarget = async (
    input: { kind: 'dm' } | { kind: 'channel'; channel: string }
  ): Promise<void> => {
    setSavingTarget(true)
    setTargetResult(null)
    const result = await window.api.slack.setTarget(input)
    if (!mountedRef.current) {
      return
    }
    setSavingTarget(false)
    setTargetResult(result.ok ? { state: 'ok' } : { state: 'error', error: result.error })
    if (result.ok) {
      setChannelDraft('')
    }
    await refresh()
  }

  const handleTargetKindChange = (value: string): void => {
    const kind = value === 'channel' ? 'channel' : 'dm'
    setTargetKind(kind)
    setTargetResult(null)
    if (kind === 'dm' && status?.target.kind === 'channel') {
      void saveTarget({ kind: 'dm' })
    }
  }

  return (
    <IntegrationCardShell
      settingsSectionId={SLACK_INTEGRATION_SECTION_ID}
      icon={<SlackIcon className="size-5" />}
      name="Slack"
      description={
        connected && status?.teamName
          ? translate(
              'auto.components.settings.slack.integration.card.connectedTo',
              'Connected to {{team}}',
              { team: status.teamName }
            )
          : translate(
              'auto.components.settings.slack.integration.card.pitch',
              'Get agent updates in Slack and answer your agents from a thread.'
            )
      }
      checking={checking}
      statusTone={connected && !status?.credentialError ? 'connected' : 'attention'}
      statusLabel={
        connected
          ? translate('auto.components.settings.slack.integration.card.connected', 'Connected')
          : translate(
              'auto.components.settings.slack.integration.card.notConnected',
              'Not connected'
            )
      }
      actions={
        !checking ? (
          <>
            {!connected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.api.shell.openUrl(buildSlackCreateAppUrl())}
              >
                <ExternalLink />
                {translate(
                  'auto.components.settings.slack.integration.card.createApp',
                  'Create Slack app'
                )}
              </Button>
            ) : null}
            <Button
              variant={connected ? 'outline' : 'default'}
              size="sm"
              onClick={() => setDialogOpen(true)}
            >
              {connected
                ? translate(
                    'auto.components.settings.slack.integration.card.replaceTokens',
                    'Replace tokens'
                  )
                : translate(
                    'auto.components.settings.slack.integration.card.connect',
                    'Connect Slack'
                  )}
            </Button>
          </>
        ) : null
      }
    >
      <IntegrationCardDetails>
        {status?.credentialError ? (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="size-3.5 shrink-0" />
            {status.credentialError}
          </p>
        ) : null}
        {connected && status ? (
          <div className="space-y-2">
            <div className={rowClass}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{status.owner?.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {translate(
                    'auto.components.settings.slack.integration.card.ownerOnly',
                    'Orca+ acts only on messages from this person.'
                  )}
                </p>
              </div>
              {testResult?.state === 'ok' ? (
                <span className="flex shrink-0 items-center gap-1 text-xs text-status-success">
                  <CheckCircle2 className="size-3.5" />
                  {translate('auto.components.settings.slack.integration.card.sent', 'Sent')}
                </span>
              ) : null}
              {testResult?.state === 'error' ? (
                <span className="flex min-w-0 max-w-[220px] shrink items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="size-3.5 shrink-0" />
                  <span className="truncate">{testResult.error}</span>
                </span>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleTest()}
                disabled={testing}
              >
                {testing ? (
                  <>
                    <LoaderCircle className="size-3.5 animate-spin" />
                    {translate(
                      'auto.components.settings.slack.integration.card.sending',
                      'Sending...'
                    )}
                  </>
                ) : (
                  translate(
                    'auto.components.settings.slack.integration.card.sendTest',
                    'Send test message'
                  )
                )}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void handleDisconnect()}>
                {translate(
                  'auto.components.settings.slack.integration.card.disconnect',
                  'Disconnect'
                )}
              </Button>
            </div>
            <div className={rowClass}>
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                {status.target.kind === 'channel'
                  ? translate(
                      'auto.components.settings.slack.integration.card.targetChannel',
                      'Updates go to #{{channel}}',
                      { channel: status.target.channelName }
                    )
                  : translate(
                      'auto.components.settings.slack.integration.card.targetDm',
                      'Updates go to your direct messages with the bot'
                    )}
              </p>
              <Select value={targetKind} onValueChange={handleTargetKindChange}>
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dm">
                    {translate(
                      'auto.components.settings.slack.integration.card.targetDmOption',
                      'Direct message'
                    )}
                  </SelectItem>
                  <SelectItem value="channel">
                    {translate(
                      'auto.components.settings.slack.integration.card.targetChannelOption',
                      'Channel'
                    )}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {targetKind === 'channel' ? (
              <div className={rowClass}>
                <div className="min-w-0 flex-1">
                  <Input
                    value={channelDraft}
                    placeholder={translate(
                      'auto.components.settings.slack.integration.card.channelPlaceholder',
                      'Channel ID or link'
                    )}
                    onChange={(event) => {
                      setChannelDraft(event.target.value)
                      setTargetResult(null)
                    }}
                    disabled={savingTarget}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void saveTarget({ kind: 'channel', channel: channelDraft })}
                  disabled={savingTarget || channelDraft.trim() === ''}
                >
                  {translate(
                    'auto.components.settings.slack.integration.card.useChannel',
                    'Use channel'
                  )}
                </Button>
              </div>
            ) : null}
            {targetResult?.state === 'error' ? (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="size-3.5 shrink-0" />
                {targetResult.error}
              </p>
            ) : null}
          </div>
        ) : !checking ? (
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.slack.integration.card.setupCopy',
              'Create the Slack app from the Orca+ manifest, install it, then connect with its bot and app-level tokens.'
            )}
          </p>
        ) : null}
      </IntegrationCardDetails>

      <SlackConnectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConnected={() => {
          setTestResult(null)
          void refresh()
        }}
      />
    </IntegrationCardShell>
  )
}
