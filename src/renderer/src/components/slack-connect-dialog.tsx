import { useId, useState } from 'react'
import { ExternalLink, LoaderCircle, Lock } from 'lucide-react'
import { useMountedRef } from '@/hooks/useMountedRef'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { preventOutsideDismissWhenDirty } from '@/lib/outside-dismiss-guard'
import { translate } from '@/i18n/i18n'
import { buildSlackCreateAppUrl, SLACK_APPS_URL } from '../../../shared/slack-app-manifest'

type SlackConnectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}

export function SlackConnectDialog({
  open,
  onOpenChange,
  onConnected
}: SlackConnectDialogProps): React.JSX.Element {
  const mountedRef = useMountedRef()
  const botTokenId = useId()
  const appTokenId = useId()
  const ownerIdInputId = useId()
  const errorId = useId()
  const [botToken, setBotToken] = useState('')
  const [appToken, setAppToken] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    // Why: reset typed secrets between openings so a stale token never lingers.
    setWasOpen(open)
    if (open) {
      setBotToken('')
      setAppToken('')
      setError(null)
    }
  }

  const ready = botToken.trim() !== '' && appToken.trim() !== '' && ownerId.trim() !== ''
  const guardOutsideDismiss = preventOutsideDismissWhenDirty(
    () => botToken !== '' || appToken !== ''
  )

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!connecting) {
      onOpenChange(nextOpen)
    }
  }

  const handleConnect = async (): Promise<void> => {
    if (!ready || connecting) {
      return
    }
    setConnecting(true)
    setError(null)
    const result = await window.api.slack.connect({ botToken, appToken, ownerId })
    if (!mountedRef.current) {
      return
    }
    setConnecting(false)
    if (result.ok) {
      setBotToken('')
      setAppToken('')
      onOpenChange(false)
      onConnected()
      return
    }
    setError(result.error)
  }

  const clearError = (): void => setError(null)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        // Why: same layering as the Linear/Jira/ClickUp connect dialogs opened from Settings cards.
        overlayClassName="z-[110]"
        className="z-[120] sm:max-w-lg"
        onPointerDownOutside={guardOutsideDismiss}
        onInteractOutside={guardOutsideDismiss}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && ready && !connecting) {
            event.preventDefault()
            void handleConnect()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.slack.connect.dialog.title', 'Connect Slack')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.slack.connect.dialog.description',
              'Orca+ posts agent updates to you and acts only on messages you send it.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li>
              {translate(
                'auto.components.slack.connect.dialog.stepCreate',
                'Create the app from the Orca+ manifest, then install it to your workspace.'
              )}
            </li>
            <li>
              {translate(
                'auto.components.slack.connect.dialog.stepAppToken',
                'Basic Information → App-Level Tokens: generate one with the connections:write scope.'
              )}
            </li>
            <li>
              {translate(
                'auto.components.slack.connect.dialog.stepBotToken',
                'OAuth & Permissions: copy the Bot User OAuth Token.'
              )}
            </li>
            <li>
              {translate(
                'auto.components.slack.connect.dialog.stepMemberId',
                'Your Slack profile → ⋮ → Copy member ID.'
              )}
            </li>
          </ol>
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={() => window.api.shell.openUrl(buildSlackCreateAppUrl())}
            >
              <ExternalLink />
              {translate('auto.components.slack.connect.dialog.createApp', 'Create Slack app')}
            </Button>
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={() => window.api.shell.openUrl(SLACK_APPS_URL)}
            >
              <ExternalLink />
              {translate('auto.components.slack.connect.dialog.yourApps', 'Your Slack apps')}
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor={botTokenId}>
              {translate('auto.components.slack.connect.dialog.botTokenLabel', 'Bot token')}
            </Label>
            <Input
              id={botTokenId}
              autoFocus
              type="password"
              placeholder={translate(
                'auto.components.slack.connect.dialog.botTokenPlaceholder',
                'xoxb-...'
              )}
              value={botToken}
              onChange={(event) => {
                setBotToken(event.target.value)
                clearError()
              }}
              disabled={connecting}
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={appTokenId}>
              {translate('auto.components.slack.connect.dialog.appTokenLabel', 'App-level token')}
            </Label>
            <Input
              id={appTokenId}
              type="password"
              placeholder={translate(
                'auto.components.slack.connect.dialog.appTokenPlaceholder',
                'xapp-...'
              )}
              value={appToken}
              onChange={(event) => {
                setAppToken(event.target.value)
                clearError()
              }}
              disabled={connecting}
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={ownerIdInputId}>
              {translate('auto.components.slack.connect.dialog.memberIdLabel', 'Your member ID')}
            </Label>
            <Input
              id={ownerIdInputId}
              placeholder={translate(
                'auto.components.slack.connect.dialog.memberIdPlaceholder',
                'U0123ABCD'
              )}
              value={ownerId}
              onChange={(event) => {
                setOwnerId(event.target.value)
                clearError()
              }}
              disabled={connecting}
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          {error ? (
            <p id={errorId} className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="size-3 shrink-0" />
            {translate(
              'auto.components.slack.connect.dialog.storage',
              'Tokens stay in this Orca+ profile, encrypted with Electron storage when available.'
            )}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={connecting}>
            {translate('auto.components.slack.connect.dialog.cancel', 'Cancel')}
          </Button>
          <Button onClick={() => void handleConnect()} disabled={!ready || connecting}>
            {connecting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                {translate('auto.components.slack.connect.dialog.verifying', 'Verifying...')}
              </>
            ) : (
              translate('auto.components.slack.connect.dialog.connect', 'Connect')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
