// Custom build (hq-notes): HQ's «Waiting» in «New view», reworked into notes — one line to jot «who
// waits / whom I wait on» (HQ reads the person, the way and the date), a tick when it is done.
import { useState } from 'react'
import { hqSlackRequestKind } from '../../../../../shared/hq-slack-scout'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { useAppStore } from '@/store'
import {
  answerHqSlackRequest,
  skipHqSlackRequest
} from '../slack-requests/hq-slack-request-actions'
import { HQ_NOTE_SOURCE, parseHqNote, type HqParsedNote } from './hq-note-parse'
import type { HqPerson, HqWaiting } from './hq-pulse-snapshot'
import { findHqWorktreeId } from './hq-today-actions'
import { RemindButton } from './HqTodayPeople'
import { useHqSlackDrafts } from './HqTodaySlackDrafts'
import { DecisionsColumn } from './HqWaitingTab'
import { ColumnHeader, errorText } from './hq-waiting-parts'
import { addHqWaiting, closeHqWaiting, useHqPulse } from './use-hq-pulse'

const AGE_TICK_MS = 60_000
// Why: a day without an answer is when a nudge stops being pushy.
const REMIND_AFTER_MS = 24 * 60 * 60_000

function initials(text: string): string {
  return (
    text
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .slice(0, 2)
      .toUpperCase() || '··'
  )
}

function dueLabel(dueAt: number): string {
  return new Date(dueAt).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric'
  })
}

function previewText(note: HqParsedNote): string {
  const due = note.dueAt
    ? translate('auto.hq.notes.previewDue', ' · due {{value0}}', { value0: dueLabel(note.dueAt) })
    : ''
  if (note.direction === 'on-me') {
    return (
      translate('auto.hq.notes.previewOnMe', '{{value0}} waits on you', {
        value0: note.personName ?? '?'
      }) + due
    )
  }
  if (note.direction === 'on-them') {
    return (
      translate('auto.hq.notes.previewOnThem', 'You wait on {{value0}}', {
        value0: note.personName ?? '?'
      }) + due
    )
  }
  return translate('auto.hq.notes.previewNote', 'A note') + due
}

function NoteInput({
  people,
  now
}: {
  people: readonly HqPerson[]
  now: number
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = text.trim() ? parseHqNote(text, now) : null
  const submit = (): void => {
    const note = text.trim() ? parseHqNote(text, Date.now()) : null
    if (!note || busy) {
      return
    }
    setBusy(true)
    setError(null)
    addHqWaiting({
      direction: note.direction ?? 'on-me',
      title: note.title,
      personName: note.personName ?? '',
      people,
      dueAt: note.dueAt,
      ...(note.direction ? {} : { source: HQ_NOTE_SOURCE })
    })
      .then(() => setText(''))
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
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          placeholder={translate(
            'auto.hq.notes.placeholder',
            '+ Note… e.g. «@Vera жду выгрузку до пт» — HQ reads who, what and when'
          )}
          aria-label={translate('auto.hq.notes.label', 'New note')}
        />
        <Button type="submit" variant="secondary" disabled={busy || !preview}>
          {translate('auto.hq.waiting.add', 'Add')}
        </Button>
      </div>
      {preview ? <p className="text-xs text-muted-foreground">→ {previewText(preview)}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  )
}

function NoteRow({
  waiting,
  personName,
  now,
  hqWorktreeId
}: {
  waiting: HqWaiting
  personName: string | null
  now: number
  hqWorktreeId: string | null
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = (status: 'resolved' | 'cancelled'): void => {
    setBusy(true)
    setError(null)
    // Why: on success the snapshot refresh removes the row, so busy stays set until then.
    closeHqWaiting(waiting.id, status).catch((reason: unknown) => {
      setError(errorText(reason))
      setBusy(false)
    })
  }
  const meta = [
    personName ??
      (waiting.source === HQ_NOTE_SOURCE ? translate('auto.hq.notes.self', 'Me') : null),
    formatShortTimeAgo(waiting.createdAt, now),
    waiting.project
  ].filter((part): part is string => Boolean(part))
  const canRemind =
    waiting.direction === 'on-them' &&
    waiting.source !== HQ_NOTE_SOURCE &&
    now - waiting.createdAt > REMIND_AFTER_MS
  return (
    <li className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <Checkbox
        className="mt-1"
        disabled={busy}
        onCheckedChange={() => close('resolved')}
        aria-label={translate('auto.hq.waiting.done', 'Done')}
      />
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">
        {initials(personName ?? 'HQ')}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate">{meta.join(' · ')}</span>
          {waiting.dueAt !== null ? (
            <span
              data-overdue={waiting.dueAt < now}
              className="shrink-0 data-[overdue=true]:text-destructive"
            >
              {translate('auto.hq.waiting.due', 'due {{value0}}', {
                value0: dueLabel(waiting.dueAt)
              })}
            </span>
          ) : null}
        </span>
        <span className="block text-[13px]">{waiting.title}</span>
        {error ? <span className="block text-xs text-destructive">{error}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {canRemind ? (
          <RemindButton waiting={waiting} personName={personName} hqWorktreeId={hqWorktreeId} />
        ) : null}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => close('cancelled')}
        >
          {translate('auto.hq.waiting.drop', 'Drop')}
        </Button>
      </span>
    </li>
  )
}

function SlackWaitingRows({ now }: { now: number }): React.JSX.Element | null {
  const { state, drop } = useHqSlackDrafts()
  const drafts =
    state.status === 'ready'
      ? state.drafts.filter((draft) => hqSlackRequestKind(draft) === 'answer')
      : []
  if (drafts.length === 0) {
    return null
  }
  return (
    <>
      {drafts.map((draft) => {
        const at = Date.parse(draft.foundAt)
        return (
          <li
            key={draft.id}
            className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">
              {initials(draft.author || draft.channelName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] text-muted-foreground">
                {[draft.author, Number.isNaN(at) ? null : formatShortTimeAgo(at, now), 'Slack']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span className="block text-[13px]">{draft.ask || draft.title}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="xs"
                variant="secondary"
                onClick={() =>
                  void answerHqSlackRequest(draft).then((done) =>
                    done ? drop(draft.id) : undefined
                  )
                }
              >
                {translate('auto.hq.slack.answer', 'Just reply')}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() =>
                  void skipHqSlackRequest(draft.id).then((done) =>
                    done ? drop(draft.id) : undefined
                  )
                }
              >
                {translate('auto.hq.slack.skip', 'Skip')}
              </Button>
            </span>
          </li>
        )
      })}
    </>
  )
}

function NoteSection({
  title,
  count,
  empty,
  children
}: {
  title: string
  count: number
  empty: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1" aria-label={title}>
      <ColumnHeader title={title} count={count} />
      {count === 0 ? <p className="px-2 text-xs text-muted-foreground">{empty}</p> : null}
      <ul className="flex flex-col">{children}</ul>
    </section>
  )
}

export function HqNotesTab(): React.JSX.Element {
  const state = useHqPulse()
  const now = useNow(AGE_TICK_MS)
  const slack = useHqSlackDrafts()
  const hqWorktreeId = useAppStore((s) =>
    findHqWorktreeId(s.settings?.hqPath, s.repos, s.worktreesByRepo)
  )
  if (state.status !== 'ready') {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {state.status === 'loading'
          ? translate('auto.hq.waiting.loading', 'Loading…')
          : translate('auto.hq.waiting.loadFailed', "Couldn't read waitings: {{value0}}", {
              value0: state.message
            })}
      </p>
    )
  }
  const { people, waitings, decisions } = state.pulse
  const names = new Map(people.map((person) => [person.id, person.name]))
  const row = (waiting: HqWaiting): React.JSX.Element => (
    <NoteRow
      key={waiting.id}
      waiting={waiting}
      personName={waiting.personId ? (names.get(waiting.personId) ?? null) : null}
      now={now}
      hqWorktreeId={hqWorktreeId}
    />
  )
  const notes = waitings.filter((waiting) => waiting.source === HQ_NOTE_SOURCE)
  const onMe = waitings.filter(
    (waiting) => waiting.direction === 'on-me' && waiting.source !== HQ_NOTE_SOURCE
  )
  const onThem = waitings.filter(
    (waiting) => waiting.direction === 'on-them' && waiting.source !== HQ_NOTE_SOURCE
  )
  const slackAnswers =
    slack.state.status === 'ready'
      ? slack.state.drafts.filter((draft) => hqSlackRequestKind(draft) === 'answer').length
      : 0
  return (
    <div className="scrollbar-sleek flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-4">
      <NoteInput people={people} now={now} />
      <NoteSection
        title={translate('auto.hq.waiting.onMe', 'Waiting on me')}
        count={onMe.length + slackAnswers}
        empty={translate('auto.hq.waiting.emptyOnMe', 'Nobody is waiting on you.')}
      >
        <SlackWaitingRows now={now} />
        {onMe.map(row)}
      </NoteSection>
      <NoteSection
        title={translate('auto.hq.waiting.onThem', "I'm waiting on")}
        count={onThem.length}
        empty={translate('auto.hq.waiting.emptyOnThem', "You're not waiting on anyone.")}
      >
        {onThem.map(row)}
      </NoteSection>
      <NoteSection
        title={translate('auto.hq.notes.notes', 'Just notes')}
        count={notes.length}
        empty={translate('auto.hq.notes.empty', 'No notes.')}
      >
        {notes.map(row)}
      </NoteSection>
      <DecisionsColumn decisions={decisions} now={now} />
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.hq.notes.hint',
          'Slack questions to you land in «Waiting on me» on their own. Remind writes to the person only after you approve it.'
        )}
      </p>
    </div>
  )
}
