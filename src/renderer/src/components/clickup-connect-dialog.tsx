import { useId, useState } from 'react'
import { ExternalLink, LoaderCircle, Lock } from 'lucide-react'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
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

const CLICKUP_TOKEN_SETTINGS_URL = 'https://app.clickup.com/settings/apps'

type ClickUpConnectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected?: () => void
}

export function ClickUpConnectDialog({
  open,
  onOpenChange,
  onConnected
}: ClickUpConnectDialogProps): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const connectClickUp = useAppStore((s) => s.connectClickUp)
  const mountedRef = useMountedRef()
  const tokenInputId = useId()
  const tokenErrorId = useId()
  const [token, setToken] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    // Why: reset the typed token between openings so a stale secret never lingers.
    setWasOpen(open)
    if (open) {
      setToken('')
      setError(null)
    }
  }

  const remote = getActiveRuntimeTarget(settings).kind === 'environment'
  const guardOutsideDismiss = preventOutsideDismissWhenDirty(() => token !== '')

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!connecting) {
      onOpenChange(nextOpen)
    }
  }

  const handleConnect = async (): Promise<void> => {
    const trimmed = token.trim()
    if (!trimmed || connecting) {
      return
    }
    setConnecting(true)
    setError(null)
    const result = await connectClickUp(trimmed)
    if (!mountedRef.current) {
      return
    }
    setConnecting(false)
    if (result.ok) {
      setToken('')
      onOpenChange(false)
      onConnected?.()
      return
    }
    setError(result.error)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        // Why: same layering as the Linear/Jira connect dialogs opened from Settings cards.
        overlayClassName="z-[110]"
        className="z-[120] sm:max-w-lg"
        onPointerDownOutside={guardOutsideDismiss}
        onInteractOutside={guardOutsideDismiss}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && token.trim() && !connecting) {
            event.preventDefault()
            void handleConnect()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.clickup.connect.dialog.title', 'Connect ClickUp')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.clickup.connect.dialog.description',
              'Paste a personal API token. Orca reads your tasks, and changes a status or adds a comment only when you do it from Orca.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={tokenInputId}>
              {translate('auto.components.clickup.connect.dialog.tokenLabel', 'Personal API token')}
            </Label>
            <Input
              id={tokenInputId}
              autoFocus
              type="password"
              placeholder={translate(
                'auto.components.clickup.connect.dialog.tokenPlaceholder',
                'pk_...'
              )}
              value={token}
              onChange={(event) => {
                setToken(event.target.value)
                setError(null)
              }}
              disabled={connecting}
              aria-invalid={error !== null}
              aria-describedby={error ? tokenErrorId : undefined}
            />
          </div>
          {error ? (
            <p id={tokenErrorId} className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
            <p>
              {translate(
                'auto.components.clickup.connect.dialog.tokenHelp',
                'Create it in ClickUp under Settings → Apps → API Token. The token acts as your account, with your workspace permissions.'
              )}
            </p>
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={() => window.api.shell.openUrl(CLICKUP_TOKEN_SETTINGS_URL)}
            >
              <ExternalLink />
              {translate(
                'auto.components.clickup.connect.dialog.openSettings',
                'ClickUp API settings'
              )}
            </Button>
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="size-3 shrink-0" />
            {remote
              ? translate(
                  'auto.components.clickup.connect.dialog.remoteStorage',
                  'This token is stored by the active remote runtime.'
                )
              : translate(
                  'auto.components.clickup.connect.dialog.localStorage',
                  'The token is stored on this device using Electron encrypted storage when available.'
                )}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={connecting}>
            {translate('auto.components.clickup.connect.dialog.cancel', 'Cancel')}
          </Button>
          <Button onClick={() => void handleConnect()} disabled={!token.trim() || connecting}>
            {connecting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                {translate('auto.components.clickup.connect.dialog.verifying', 'Verifying...')}
              </>
            ) : (
              translate('auto.components.clickup.connect.dialog.connect', 'Connect')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
