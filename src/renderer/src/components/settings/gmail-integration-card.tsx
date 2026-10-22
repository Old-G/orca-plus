// Custom build (hq-mail-intake): Gmail, read-only, so GitLab and ClickUp notification emails reach HQ —
// a merged MR closes what Notes waited for, a ClickUp mention becomes a request card.
import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, FileJson, LoaderCircle, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import type { GmailStatus } from '../../../../shared/gmail-types'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'

export function GmailIntegrationCard(): React.JSX.Element {
  const mountedRef = useMountedRef()
  const [status, setStatus] = useState<GmailStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const next = await window.api.gmail.status()
    if (mountedRef.current) {
      setStatus(next)
    }
  }, [mountedRef])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (action: () => Promise<{ ok: true } | { ok: false; error: string } | null>) => {
    setBusy(true)
    setError(null)
    const result = await action()
    if (!mountedRef.current) {
      return
    }
    setBusy(false)
    if (result && !result.ok) {
      setError(result.error)
    }
    await refresh()
  }

  const checking = status === null
  const connected = status?.connected === true
  const shownError = error ?? status?.error ?? null
  return (
    <IntegrationCardShell
      icon={<Mail className="size-5" />}
      name="Gmail"
      description={translate(
        'auto.components.settings.gmail.description',
        'HQ reads GitLab and ClickUp emails: a merged MR closes its waiting, a mention becomes a request.'
      )}
      checking={checking}
      statusTone={connected ? 'connected' : status?.clientSet ? 'attention' : 'neutral'}
      statusLabel={
        connected
          ? (status?.email ?? '')
          : translate('auto.components.settings.gmail.notConnected', 'Not connected')
      }
      actions={
        !checking ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => window.api.gmail.importClient())}
            >
              <FileJson />
              {status?.clientSet
                ? translate('auto.components.settings.gmail.replaceClient', 'Replace client file')
                : translate('auto.components.settings.gmail.chooseClient', 'Choose client file')}
            </Button>
            {connected ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await window.api.gmail.disconnect()
                    return null
                  })
                }
              >
                {translate('auto.components.settings.gmail.disconnect', 'Disconnect')}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy || !status?.clientSet}
                onClick={() => void run(() => window.api.gmail.connect())}
              >
                {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {translate('auto.components.settings.gmail.connect', 'Connect Gmail')}
              </Button>
            )}
          </>
        ) : null
      }
    >
      {(!connected && !checking) || shownError ? (
        <IntegrationCardDetails>
          {!connected && !checking ? (
            <p className="text-xs text-muted-foreground">
              {status?.clientSet
                ? translate(
                    'auto.components.settings.gmail.signIn',
                    'Connect opens Google in the browser; Orca+ asks only to read mail.'
                  )
                : translate(
                    'auto.components.settings.gmail.setup',
                    'Google Cloud Console: enable the Gmail API, set an Internal consent screen, create an OAuth client of type Desktop app and choose its JSON here.'
                  )}
            </p>
          ) : null}
          {shownError ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              {shownError}
            </p>
          ) : null}
        </IntegrationCardDetails>
      ) : null}
    </IntegrationCardShell>
  )
}
