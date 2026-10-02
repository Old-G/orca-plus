// Custom build (hq): the waiting pieces both the Waiting tab and a project's card show — a quick-add
// row, a waiting card with Done/Drop, a column header, and how a decision reads.
import { useState } from 'react'
import type { PulseWaitingDirection } from '../../../../../shared/pulse-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import type { HqDecision, HqPerson, HqWaiting } from './hq-pulse-snapshot'
import { addHqWaiting, closeHqWaiting } from './use-hq-pulse'

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function decisionLabel(decision: HqDecision): string {
  switch (decision.outcome) {
    case 'approved':
      return translate('auto.hq.waiting.outcomeApproved', 'Approved')
    case 'edited':
      return translate('auto.hq.waiting.outcomeEdited', 'Edited')
    case 'rejected':
      return translate('auto.hq.waiting.outcomeRejected', 'Rejected')
    case null:
      return translate('auto.hq.waiting.kindDecision', 'Decision')
  }
}

export function ColumnHeader({
  title,
  count
}: {
  title: string
  /** Left out where a count says nothing. */
  count?: number
}): React.JSX.Element {
  return (
    <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
      {title}
      {count === undefined ? null : <span className="tabular-nums">{count}</span>}
    </h2>
  )
}

export function QuickAdd({
  direction,
  people,
  project = null
}: {
  direction: PulseWaitingDirection
  people: readonly HqPerson[]
  /** HQ slug the new waiting belongs to, when added from a project's card. */
  project?: string | null
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [personName, setPersonName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = (): void => {
    if (!title.trim() || busy) {
      return
    }
    setBusy(true)
    setError(null)
    addHqWaiting({ direction, title, personName, people, project })
      .then(() => {
        setTitle('')
        setPersonName('')
      })
      .catch((reason: unknown) => setError(errorText(reason)))
      .finally(() => setBusy(false))
  }
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="flex gap-1.5">
        <Input
          className="flex-1"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={translate('auto.hq.waiting.titlePlaceholder', 'What…')}
          aria-label={translate('auto.hq.waiting.titleLabel', 'What is waiting')}
          disabled={busy}
        />
        <Input
          className="w-28"
          value={personName}
          onChange={(event) => setPersonName(event.target.value)}
          placeholder={translate('auto.hq.waiting.personPlaceholder', 'Who')}
          aria-label={translate('auto.hq.waiting.personLabel', 'Person')}
          disabled={busy}
        />
        <Button type="submit" variant="secondary" disabled={busy || !title.trim()}>
          {translate('auto.hq.waiting.add', 'Add')}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  )
}

export function WaitingCard({
  waiting,
  personName,
  now,
  action
}: {
  waiting: HqWaiting
  personName: string | null
  now: number
  /** An extra button before Done/Drop, such as the Today tab's Remind. */
  action?: React.ReactNode
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = (status: 'resolved' | 'cancelled'): void => {
    setBusy(true)
    setError(null)
    // Why: on success the snapshot refresh removes the card, so busy stays set until then.
    closeHqWaiting(waiting.id, status).catch((reason: unknown) => {
      setError(errorText(reason))
      setBusy(false)
    })
  }
  const meta = [personName, waiting.project, formatShortTimeAgo(waiting.createdAt, now)].filter(
    (part): part is string => Boolean(part)
  )
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3 text-card-foreground">
      <p className="text-sm">{waiting.title}</p>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{meta.join(' · ')}</span>
        {waiting.dueAt !== null ? (
          <span
            data-overdue={waiting.dueAt < now}
            className="shrink-0 data-[overdue=true]:text-destructive"
          >
            {translate('auto.hq.waiting.due', 'due {{value0}}', {
              value0: new Date(waiting.dueAt).toLocaleDateString()
            })}
          </span>
        ) : null}
      </div>
      <div className="flex justify-end gap-1">
        {action}
        <Button
          type="button"
          size="xs"
          variant="secondary"
          disabled={busy}
          onClick={() => close('resolved')}
        >
          {translate('auto.hq.waiting.done', 'Done')}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => close('cancelled')}
        >
          {translate('auto.hq.waiting.drop', 'Drop')}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </li>
  )
}
