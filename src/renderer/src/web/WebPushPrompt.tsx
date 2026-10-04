// Custom build (web-push): the paired phone app's switch for bell notifications, shown in HQ until
// they are on.
import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { enableWebPush, isWebPushEnabled, webPushAvailability } from './web-push-subscription'

type PromptState = 'hidden' | 'offer' | 'install-first' | 'denied'

export default function WebPushPrompt(): React.JSX.Element | null {
  const [state, setState] = useState<PromptState>('hidden')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const availability = webPushAvailability()
    if (availability === 'install-first') {
      setState('install-first')
      return
    }
    if (availability !== 'available') {
      return
    }
    if (Notification.permission === 'denied') {
      setState('denied')
      return
    }
    let cancelled = false
    void isWebPushEnabled()
      .then((enabled) => !cancelled && setState(enabled ? 'hidden' : 'offer'))
      .catch(() => !cancelled && setState('offer'))
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'hidden') {
    return null
  }

  const enable = (): void => {
    setBusy(true)
    enableWebPush()
      .then((result) => setState(result === 'enabled' ? 'hidden' : 'denied'))
      .catch((error: unknown) =>
        toast.error(translate('auto.webPush.failed', 'Notifications could not be turned on'), {
          description: error instanceof Error ? error.message : String(error)
        })
      )
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2 text-sm">
      <BellRing className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-muted-foreground">
        {state === 'offer'
          ? translate(
              'auto.webPush.offer',
              'Get the bell on this phone while you are away from the Mac.'
            )
          : state === 'install-first'
            ? translate(
                'auto.webPush.installFirst',
                'For notifications, add Orca+ to the Home Screen and open it from there.'
              )
            : translate(
                'auto.webPush.denied',
                'Notifications are blocked for Orca+ in this phone’s settings.'
              )}
      </span>
      {state === 'offer' ? (
        <Button size="sm" onClick={enable} disabled={busy}>
          {translate('auto.webPush.enable', 'Turn on')}
        </Button>
      ) : null}
    </div>
  )
}
