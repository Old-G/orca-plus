// Custom build (hq-slack-requests): a new Slack request pops bottom-right with its four answers and
// stays until it is decided or put off; the bell keeps it either way.
import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import {
  HQ_SLACK_REQUEST_BELL_KIND,
  readHqSlackRequestRef
} from '../../../../../shared/hq-slack-request-bell'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { runPulseBellAction } from '../pulse-bell/pulse-bell-actions'

// Why: main raises every pending request right after launch; those are old news, not new ones.
const LAUNCH_GRACE_MS = 60_000
// Why: a burst (the scout's first run of the day) must not wall the screen; the rest wait in the bell.
const MAX_SHOWN = 3

const toastId = (itemId: string): string => `slack-request-toast-${itemId}`

export type HqSlackRequestToastMemory = { since: number; seen: Set<string>; shown: Set<string> }

export function createHqSlackRequestToastMemory(now: number): HqSlackRequestToastMemory {
  return { since: now + LAUNCH_GRACE_MS, seen: new Set(), shown: new Set() }
}

function HqSlackRequestToast({ item }: { item: PulseInboxItem }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [meta, quote] = (item.body ?? '').split('\n')
  const run = (actionId: string): void => {
    setBusy(true)
    void runPulseBellAction(item, actionId)
      .catch((error: unknown) => console.warn('[slack-requests] toast action failed:', error))
      .finally(() => setBusy(false))
  }
  return (
    <div
      role="alertdialog"
      aria-label={item.title}
      className="flex w-[var(--width)] max-w-[calc(100vw-32px)] flex-col gap-1.5 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xs"
    >
      <div className="flex items-start gap-2">
        <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold">{item.title}</p>
          {meta ? <p className="truncate text-xs text-muted-foreground">{meta}</p> : null}
          {quote ? <p className="line-clamp-2 text-xs text-muted-foreground">{quote}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-1">
        {item.actions.map((action, index) => (
          <Button
            key={action.id}
            type="button"
            size="xs"
            variant={index === 0 ? 'secondary' : 'ghost'}
            disabled={busy}
            onClick={() => run(action.id)}
          >
            {translate(`auto.pulseBell.action.${action.id}`, action.label)}
          </Button>
        ))}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => toast.dismiss(toastId(item.id))}
        >
          {translate('auto.pulseBell.action.later', 'Later')}
        </Button>
      </div>
    </div>
  )
}

/** Pops requests that arrived after launch (not FYIs) and closes the ones decided since. */
export function syncHqSlackRequestToasts(
  items: readonly PulseInboxItem[],
  memory: HqSlackRequestToastMemory
): void {
  const requests = items.filter((item) => item.kind === HQ_SLACK_REQUEST_BELL_KIND)
  const open = new Set(requests.map((item) => item.id))
  for (const id of memory.shown) {
    if (!open.has(id)) {
      toast.dismiss(toastId(id))
      memory.shown.delete(id)
    }
  }
  for (const item of requests) {
    const ref = readHqSlackRequestRef(item.refId)
    // Why: by request, not item — a corrected request gets a new item but is no news.
    const key = ref?.id ?? item.id
    if (memory.seen.has(key)) {
      continue
    }
    memory.seen.add(key)
    if (
      !ref ||
      ref.kind === 'fyi' ||
      item.createdAt < memory.since ||
      memory.shown.size >= MAX_SHOWN
    ) {
      continue
    }
    memory.shown.add(item.id)
    toast.custom(() => <HqSlackRequestToast item={item} />, {
      id: toastId(item.id),
      duration: Number.POSITIVE_INFINITY,
      unstyled: true,
      dismissible: false,
      closeButton: false
    })
  }
}
