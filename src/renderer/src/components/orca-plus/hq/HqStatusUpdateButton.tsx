// Custom build (hq-status-update): the owner's button for a status update to the client — it opens an
// HQ chat that drafts the message; it goes out only after his yes and the Approve card.
import { useState } from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { startHqStatusUpdate } from './hq-ask-chat'

export function HqStatusUpdateButton({
  hqWorktreeId
}: {
  hqWorktreeId: string | null
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const start = (): void => {
    if (!hqWorktreeId || busy) {
      return
    }
    setBusy(true)
    void startHqStatusUpdate(hqWorktreeId)
      .then((result) => {
        if (!result.ok) {
          toast.error(result.message)
        }
      })
      .finally(() => setBusy(false))
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={!hqWorktreeId || busy}
          onClick={start}
          className="shrink-0"
        >
          <Send />
          {translate('auto.hq.status.button', 'Status update')}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {translate(
          'auto.hq.status.hint',
          'Draft one status message for the client across all projects. You review it in the chat, and it goes out only after your Approve.'
        )}
      </TooltipContent>
    </Tooltip>
  )
}
