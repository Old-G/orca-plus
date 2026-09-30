// Custom build (pulse-bell): Orca+'s bell — what needs you across agents, handoffs and limits.
import React, { useState } from 'react'
import { Inbox, TriangleAlert } from 'lucide-react'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { isWebClientLocation } from '@/lib/web-client-location'
import { PULSE_BELL_ACTION } from '../../../../../shared/pulse-bell'
import { runPulseBellAction } from './pulse-bell-actions'
import { usePulseBellInbox } from './use-pulse-bell-inbox'

function itemTitle(item: PulseInboxItem): string {
  return translate(`auto.pulseBell.kind.${item.kind}.${item.urgency}`, item.title)
}

function actionLabel(id: string, fallback: string): string {
  return translate(`auto.pulseBell.action.${id}`, fallback)
}

// Why: these take the user to another surface, so the popover must not cover it.
const NAVIGATING_ACTIONS: readonly string[] = [PULSE_BELL_ACTION.open, PULSE_BELL_ACTION.launch]

function PulseBellRow({
  item,
  onNavigate
}: {
  item: PulseInboxItem
  onNavigate: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const run = (actionId: string): void => {
    setBusy(true)
    if (NAVIGATING_ACTIONS.includes(actionId)) {
      onNavigate()
    }
    void runPulseBellAction(item, actionId)
      .catch((error: unknown) => console.warn('[pulse-bell] action failed:', error))
      .finally(() => setBusy(false))
  }
  const actions =
    item.actions.length > 0
      ? item.actions
      : [{ id: 'done', label: translate('auto.pulseBell.action.done', 'Done') }]
  return (
    <li className="flex flex-col gap-1.5 rounded-md px-2 py-2 hover:bg-accent">
      <div className="flex items-start gap-2">
        {item.urgency === 'urgent' ? (
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-sm', item.readAt === null && 'font-semibold')}>
            {itemTitle(item)}
          </p>
          {item.body ? (
            <p className="line-clamp-2 text-xs text-muted-foreground">{item.body}</p>
          ) : null}
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatRelativeTime(item.createdAt)}
        </span>
      </div>
      <div className="flex justify-end gap-1">
        {actions.map((action, index) => (
          <Button
            key={action.id}
            type="button"
            size="xs"
            variant={index === 0 ? 'secondary' : 'ghost'}
            disabled={busy}
            onClick={() => run(action.id)}
          >
            {actionLabel(action.id, action.label)}
          </Button>
        ))}
      </div>
    </li>
  )
}

export function PulseBellButton(): React.JSX.Element | null {
  const items = usePulseBellInbox()
  const [open, setOpen] = useState(false)
  const unread = items.filter((item) => item.readAt === null)
  const urgentUnread = unread.some((item) => item.urgency === 'urgent')
  const label = translate('auto.pulseBell.title', 'Inbox')
  // Why: the paired web client has no bell bridge, so its inbox would always look empty.
  if (isWebClientLocation()) {
    return null
  }
  const onOpenChange = (next: boolean): void => {
    setOpen(next)
    if (next && unread.length > 0) {
      void window.api.pulseBell.markRead(unread.map((item) => item.id))
    }
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size={unread.length > 0 ? 'xs' : 'icon-xs'}
              aria-label={label}
            >
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-muted-foreground',
                  urgentUnread && 'text-destructive'
                )}
              >
                <Inbox className="size-3.5" strokeWidth={2.25} />
                {unread.length > 0 ? unread.length : null}
              </span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="start" sideOffset={8} className="w-80">
        <div className="p-1.5">
          <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
          {items.length === 0 ? (
            <p className="px-2 pb-2 text-xs text-muted-foreground">
              {translate('auto.pulseBell.empty', 'Nothing needs you right now.')}
            </p>
          ) : (
            <ul className="scrollbar-sleek flex max-h-96 flex-col gap-0.5 overflow-y-auto">
              {items.map((item) => (
                <PulseBellRow key={item.id} item={item} onNavigate={() => setOpen(false)} />
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
