import { useState } from 'react'
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react'
import { ClickUpConnectDialog } from '@/components/clickup-connect-dialog'
import { ClickUpIcon } from '@/components/icons/ClickUpIcon'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useMountedRef } from '@/hooks/useMountedRef'
import {
  getProviderRuntimeContextKey,
  hasRemoteProviderRuntime
} from '@/lib/provider-runtime-context'
import { useAppStore } from '@/store'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import { useIntegrationSubordinateRowClass } from './integration-card-presentation'
import { getProviderAccountScope } from './provider-account-scope'
import { ProviderHostScopeControl } from './ProviderHostScopeControl'
import { CLICKUP_INTEGRATION_SECTION_ID } from './task-provider-integration-section-ids'
import { translate } from '@/i18n/i18n'

type VerificationResult = { state: 'ok' } | { state: 'error'; error: string }

export function ClickUpIntegrationCard(): React.JSX.Element {
  const status = useAppStore((s) => s.clickUpStatus)
  const statusChecked = useAppStore((s) => s.clickUpStatusChecked)
  const statusContextKey = useAppStore((s) => s.clickUpStatusContextKey)
  const checkConnection = useAppStore((s) => s.checkClickUpConnection)
  const disconnect = useAppStore((s) => s.disconnectClickUp)
  const testConnection = useAppStore((s) => s.testClickUpConnection)
  const selectWorkspace = useAppStore((s) => s.selectClickUpWorkspace)
  const settings = useAppStore((s) => s.settings)
  const mountedRef = useMountedRef()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<VerificationResult | null>(null)

  const contextMatches = statusContextKey === getProviderRuntimeContextKey(settings)
  const checking = !contextMatches || !statusChecked
  const connected = contextMatches && status.connected
  const accountScope = getProviderAccountScope(settings)
  const rowClass = useIntegrationSubordinateRowClass('flex items-center gap-3')
  const accountScopeRowClass = useIntegrationSubordinateRowClass('text-xs')

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    const result = await testConnection()
    if (!mountedRef.current) {
      return
    }
    setTesting(false)
    setTestResult(result.ok ? { state: 'ok' } : { state: 'error', error: result.error })
  }

  const handleDisconnect = async (): Promise<void> => {
    await disconnect()
    if (mountedRef.current) {
      setTestResult(null)
    }
  }

  return (
    <IntegrationCardShell
      settingsSectionId={CLICKUP_INTEGRATION_SECTION_ID}
      icon={<ClickUpIcon className="size-5" />}
      name="ClickUp"
      description={
        connected && status.viewer
          ? translate(
              'auto.components.settings.clickup.integration.card.connectedAs',
              'Connected as {{name}}',
              { name: status.viewer.username }
            )
          : checking
            ? translate(
                'auto.components.settings.clickup.integration.card.checking',
                'Checking ClickUp access before showing setup actions.'
              )
            : translate(
                'auto.components.settings.clickup.integration.card.pitch',
                'Browse your ClickUp tasks and start workspaces from them.'
              )
      }
      checking={checking}
      statusTone={connected && !status.credentialError ? 'connected' : 'attention'}
      statusLabel={
        connected
          ? translate('auto.components.settings.clickup.integration.card.connected', 'Connected')
          : translate(
              'auto.components.settings.clickup.integration.card.notConnected',
              'Not connected'
            )
      }
      actions={
        !checking ? (
          <Button
            variant={connected ? 'outline' : 'default'}
            size="sm"
            onClick={() => setDialogOpen(true)}
          >
            {connected
              ? translate(
                  'auto.components.settings.clickup.integration.card.replaceToken',
                  'Replace token'
                )
              : translate(
                  'auto.components.settings.clickup.integration.card.connect',
                  'Connect ClickUp'
                )}
          </Button>
        ) : null
      }
    >
      <IntegrationCardDetails>
        <ProviderHostScopeControl
          labelPrefix={translate(
            'auto.components.settings.clickup.integration.card.accountScope',
            'Account scope'
          )}
          scope={accountScope}
          className={accountScopeRowClass}
        />
        {status.credentialError ? (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="size-3.5 shrink-0" />
            {status.credentialError}
          </p>
        ) : null}
        {connected ? (
          <div className="space-y-2">
            <div className={rowClass}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {status.viewer?.username}
                </p>
                {status.viewer?.email ? (
                  <p className="truncate text-xs text-muted-foreground">{status.viewer.email}</p>
                ) : null}
              </div>
              {testResult?.state === 'ok' ? (
                <span className="flex shrink-0 items-center gap-1 text-xs text-status-success">
                  <CheckCircle2 className="size-3.5" />
                  {translate(
                    'auto.components.settings.clickup.integration.card.verified',
                    'Verified'
                  )}
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
                      'auto.components.settings.clickup.integration.card.testing',
                      'Testing...'
                    )}
                  </>
                ) : (
                  translate('auto.components.settings.clickup.integration.card.test', 'Test')
                )}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void handleDisconnect()}>
                {translate(
                  'auto.components.settings.clickup.integration.card.disconnect',
                  'Disconnect'
                )}
              </Button>
            </div>
            {status.workspaces.length > 1 ? (
              <div className={rowClass}>
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {translate(
                    'auto.components.settings.clickup.integration.card.workspace',
                    'Workspace'
                  )}
                </p>
                <Select
                  value={status.selectedWorkspaceId ?? undefined}
                  onValueChange={(workspaceId) => void selectWorkspace(workspaceId)}
                >
                  <SelectTrigger size="sm" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {status.workspaces.map((workspace) => (
                      <SelectItem key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
        ) : !checking ? (
          <>
            <p className="text-xs text-muted-foreground">
              {hasRemoteProviderRuntime(settings)
                ? translate(
                    'auto.components.settings.clickup.integration.card.remoteCopy',
                    'Connect with a ClickUp personal API token. It is sent to the selected remote runtime and stored there with runtime-supported encryption.'
                  )
                : translate(
                    'auto.components.settings.clickup.integration.card.localCopy',
                    'Connect with a ClickUp personal API token. It is stored locally and encrypted when local runtime storage supports it.'
                  )}
            </p>
            <Button variant="ghost" size="sm" onClick={() => void checkConnection()}>
              {translate('auto.components.settings.clickup.integration.card.recheck', 'Re-check')}
            </Button>
          </>
        ) : null}
      </IntegrationCardDetails>

      <ClickUpConnectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConnected={() => setTestResult(null)}
      />
    </IntegrationCardShell>
  )
}
