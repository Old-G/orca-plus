// Custom build (outgoing-approval): a held outgoing call in the bell — read the whole text, then approve,
// edit or reject. The agent waits on this answer.
import React, { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { PulseApprovalOutcome, PulseInboxItem } from '../../../../../shared/pulse-types'
import { OUTGOING_APPROVAL_ACTION } from '../../../../../shared/outgoing-approval/outgoing-approval-bell'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useOutgoingApprovalOptions } from './use-outgoing-approval-options'

/** The card body is `<what · where>\n<full text>`; see outgoingApprovalBellItem. */
export function splitOutgoingApprovalBody(body: string | null): { head: string; text: string } {
  const value = body ?? ''
  const newline = value.indexOf('\n')
  return newline === -1
    ? { head: value, text: '' }
    : { head: value.slice(0, newline), text: value.slice(newline + 1) }
}

/** The decision itself — what is held, its whole text, and Approve / Edit / Reject — shared by the
 *  bell's card and the toast that pops for it. */
function OutgoingApprovalDecision({ item }: { item: PulseInboxItem }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [withFooter, setWithFooter] = useState(true)
  const options = useOutgoingApprovalOptions(item.refId)
  const { head, text } = splitOutgoingApprovalBody(item.body)
  const canEdit = item.actions.some((action) => action.id === OUTGOING_APPROVAL_ACTION.edit)

  const decide = (outcome: PulseApprovalOutcome, editedText?: string): void => {
    if (!item.refId) {
      return
    }
    setBusy(true)
    setError(null)
    window.api.outgoingApproval
      .decide(item.refId, outcome, editedText, { footer: withFooter })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-sm', item.readAt === null && 'font-semibold')}>
            {translate(`auto.pulseBell.kind.${item.kind}.${item.urgency}`, item.title)}
          </p>
          {/* Custom build (outgoing-approval-target): where it goes and from which chat, wrapped. */}
          <p className="line-clamp-3 text-xs break-words text-muted-foreground" title={head}>
            {head}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatRelativeTime(item.createdAt)}
        </span>
      </div>
      {editing === null ? (
        <pre className="scrollbar-sleek max-h-40 overflow-auto rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-4 whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground">
          {text}
        </pre>
      ) : (
        <Textarea
          variant="code"
          rows={6}
          value={editing}
          autoFocus
          aria-label={translate('auto.outgoingApproval.editLabel', 'Text to send')}
          onChange={(event) => setEditing(event.target.value)}
        />
      )}
      {/* Custom build (outgoing-footer): the line Approve adds, which the owner can leave off. */}
      {options.footer ? (
        <label className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={withFooter}
            disabled={busy}
            onCheckedChange={(next) => setWithFooter(next === true)}
            className="mt-px"
            aria-label={translate('auto.outgoingApproval.footer', 'Add the footer')}
          />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{options.footer}</span>
        </label>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-1">
        {editing === null ? (
          <>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              disabled={busy}
              onClick={() => decide('approved')}
            >
              {translate('auto.pulseBell.action.approve', 'Approve')}
            </Button>
            {canEdit ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => setEditing(text)}
              >
                {translate('auto.pulseBell.action.edit', 'Edit')}
              </Button>
            ) : null}
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => decide('rejected')}
            >
              {translate('auto.pulseBell.action.reject', 'Reject')}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              disabled={busy || !editing.trim()}
              onClick={() => decide('edited', editing)}
            >
              {translate('auto.outgoingApproval.sendEdited', 'Send edited')}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              {translate('auto.outgoingApproval.cancelEdit', 'Cancel')}
            </Button>
          </>
        )}
      </div>
    </>
  )
}

export function OutgoingApprovalCard({ item }: { item: PulseInboxItem }): React.JSX.Element {
  return (
    <li className="flex flex-col gap-1.5 rounded-md px-2 py-2 hover:bg-accent">
      <OutgoingApprovalDecision item={item} />
    </li>
  )
}

/** Custom build (approval-toast): the same decision popped bottom-right, so a held call is seen
 *  without opening the bell. */
export function OutgoingApprovalToast({ item }: { item: PulseInboxItem }): React.JSX.Element {
  return (
    <div
      role="alertdialog"
      aria-label={translate(`auto.pulseBell.kind.${item.kind}.${item.urgency}`, item.title)}
      className="flex w-[var(--width)] max-w-[calc(100vw-32px)] flex-col gap-1.5 rounded-lg border border-destructive/50 bg-popover p-3 text-popover-foreground shadow-xs"
    >
      <OutgoingApprovalDecision item={item} />
    </div>
  )
}
