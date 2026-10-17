// Custom build (outgoing-venue): on an approval card, the other places the message could go — the
// ClickUp task instead of Slack (or Slack instead of the task), or a thread this chat already has in the
// channel. The owner picks; nothing moves on its own.
import { ArrowRightLeft, MessagesSquare } from 'lucide-react'
import type { OutgoingApprovalOptions } from '../../../../../shared/outgoing-approval/outgoing-approval-options'
import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import { translate } from '@/i18n/i18n'

export function OutgoingApprovalVenue({
  options,
  threadTs,
  busy,
  onThread,
  onMove
}: {
  options: OutgoingApprovalOptions
  threadTs: string | null
  busy: boolean
  onThread: (ts: string | null) => void
  onMove: (to: 'clickup' | 'slack') => void
}): React.JSX.Element | null {
  const { move, threads } = options
  if (!move && threads.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col gap-1">
      {threads.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
          aria-label={translate(
            'auto.outgoingApproval.threads',
            'Threads this chat already has here'
          )}
        >
          <MessagesSquare className="size-3 shrink-0" aria-hidden />
          <span>{translate('auto.outgoingApproval.intoThread', 'Into a thread:')}</span>
          {threads.map((thread) => (
            <Button
              key={thread.ts}
              type="button"
              size="xs"
              disabled={busy}
              variant={threadTs === thread.ts ? 'secondary' : 'ghost'}
              title={thread.said}
              onClick={() => onThread(threadTs === thread.ts ? null : thread.ts)}
            >
              <span className="max-w-48 truncate">
                {thread.said || formatRelativeTime(thread.at)}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
      {move ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={busy}
            title={move.task?.name ?? undefined}
            onClick={() => onMove(move.to)}
          >
            <ArrowRightLeft />
            {move.to === 'clickup'
              ? translate('auto.outgoingApproval.moveToTask', 'Ask in {{value0}} instead', {
                  value0: move.task.id
                })
              : translate('auto.outgoingApproval.moveToSlack', 'Send in Slack instead')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
