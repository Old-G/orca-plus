// Custom build (outgoing-approval): a held outgoing call in the bell — read the whole text, then approve,
// edit or reject. The agent waits on this answer.
import React, { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { PulseApprovalOutcome, PulseInboxItem } from '../../../../../shared/pulse-types'
import { OUTGOING_APPROVAL_ACTION } from '../../../../../shared/outgoing-approval/outgoing-approval-bell'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

/** The card body is `<what · where>\n<full text>`; see outgoingApprovalBellItem. */
export function splitOutgoingApprovalBody(body: string | null): { head: string; text: string } {
  const value = body ?? ''
  const newline = value.indexOf('\n')
  return newline === -1
    ? { head: value, text: '' }
    : { head: value.slice(0, newline), text: value.slice(newline + 1) }
}

export function OutgoingApprovalCard({ item }: { item: PulseInboxItem }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { head, text } = splitOutgoingApprovalBody(item.body)
  const canEdit = item.actions.some((action) => action.id === OUTGOING_APPROVAL_ACTION.edit)

  const decide = (outcome: PulseApprovalOutcome, editedText?: string): void => {
    if (!item.refId) {
      return
    }
    setBusy(true)
    setError(null)
    window.api.outgoingApproval
      .decide(item.refId, outcome, editedText)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }

  return (
    <li className="flex flex-col gap-1.5 rounded-md px-2 py-2 hover:bg-accent">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-sm', item.readAt === null && 'font-semibold')}>
            {translate(`auto.pulseBell.kind.${item.kind}.${item.urgency}`, item.title)}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={head}>
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
    </li>
  )
}
