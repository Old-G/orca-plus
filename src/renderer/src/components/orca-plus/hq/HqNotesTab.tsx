// Custom build (hq-notes): HQ's «Waiting» in «New view», reworked into notes — one line to jot «who
// waits / whom I wait on» (HQ reads the person, the way and the date), a tick when it is done.
// Custom build (hq-waiting-replies): coloured counters on top, answers first, whom we wait on by person.
import { useState } from 'react'
import { hqSlackRequestKind } from '../../../../../shared/hq-slack-scout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { useAppStore } from '@/store'
import {
  answerHqSlackRequest,
  skipHqSlackRequest
} from '../slack-requests/hq-slack-request-actions'
import { HQ_NOTE_SOURCE, parseHqNote, type HqParsedNote } from '../../../../../shared/hq-note-parse'
import type { HqPerson, HqWaiting } from '../../../../../shared/hq-pulse-snapshot'
import { hqChatKey, type HqChatItem } from './hq-chat-list'
import { buildHqNotesBoard, groupHqNotesByPerson, type HqNotesFilter } from './hq-notes-board'
import { findHqWorktreeId } from './hq-today-actions'
import { HqNoteRow, noteDueLabel, noteInitials } from './HqNoteRow'
import { HqNotesTiles } from './HqNotesTiles'
import { useHqSlackDrafts } from './HqTodaySlackDrafts'
import { DecisionsColumn } from './HqWaitingTab'
import { ColumnHeader, errorText } from './hq-waiting-parts'
import { useHqChatList } from './use-hq-chat-list'
import { addHqWaiting, useHqPulse } from './use-hq-pulse'
import { structuredAgentSessionTabId } from '../../../../../shared/structured-agent-session-projection'

const AGE_TICK_MS = 60_000

function previewText(note: HqParsedNote): string {
  const due = note.dueAt
    ? translate('auto.hq.notes.previewDue', ' · due {{value0}}', {
        value0: noteDueLabel(note.dueAt)
      })
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
          <li key={draft.id} className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-accent/50">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">
              {noteInitials(draft.author || draft.channelName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-muted-foreground">
                {[draft.author, Number.isNaN(at) ? null : formatShortTimeAgo(at, now), 'Slack']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span className="block text-sm">{draft.ask || draft.title}</span>
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

// Why: the owner found the flat list hard to read — each group is a framed card, rows split by hairlines.
const NOTE_CARD_CLASS =
  'flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card'

function NoteSection({
  title,
  count,
  empty,
  framed = true,
  children
}: {
  title: string
  count: number
  empty: string
  /** False when the children are cards of their own. */
  framed?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <ColumnHeader title={title} count={count} />
      {count === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className={framed ? NOTE_CARD_CLASS : 'flex flex-col gap-2'}>{children}</ul>
      )}
    </section>
  )
}

export function HqNotesTab(): React.JSX.Element {
  const state = useHqPulse()
  const now = useNow(AGE_TICK_MS)
  const slack = useHqSlackDrafts()
  const { items } = useHqChatList()
  const [filter, setFilter] = useState<HqNotesFilter | null>(null)
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
  const personName = (id: string): string | null => names.get(id) ?? null
  const chats = new Map(items.map((item) => [item.key, item]))
  const chatFor = (waiting: HqWaiting): HqChatItem | null =>
    waiting.agentSessionId && waiting.worktreeId
      ? (chats.get(
          hqChatKey(waiting.worktreeId, structuredAgentSessionTabId(waiting.agentSessionId))
        ) ?? null)
      : null
  const row = (waiting: HqWaiting, showPerson = true): React.JSX.Element => (
    <HqNoteRow
      key={waiting.id}
      waiting={waiting}
      personName={waiting.personId ? personName(waiting.personId) : null}
      chat={chatFor(waiting)}
      now={now}
      hqWorktreeId={hqWorktreeId}
      showPerson={showPerson}
    />
  )
  const board = buildHqNotesBoard(waitings, now)
  const slackAnswers =
    slack.state.status === 'ready'
      ? slack.state.drafts.filter((draft) => hqSlackRequestKind(draft) === 'answer').length
      : 0
  const counts: Record<HqNotesFilter, number> = {
    waiting: board.waiting.length,
    answered: board.answered.length,
    'on-me': board.onMe.length + slackAnswers,
    overdue: board.overdue.length
  }
  const shows = (section: HqNotesFilter): boolean => filter === null || filter === section
  return (
    <div className="scrollbar-sleek flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-4">
      <NoteInput people={people} now={now} />
      <HqNotesTiles counts={counts} selected={filter} onSelect={setFilter} />
      {filter === 'overdue' ? (
        <NoteSection
          title={translate('auto.hq.notes.tileOverdue', 'Overdue')}
          count={board.overdue.length}
          empty={translate('auto.hq.notes.emptyOverdue', 'Nothing is overdue.')}
        >
          {board.overdue.map((waiting) => row(waiting))}
        </NoteSection>
      ) : null}
      {shows('answered') && (filter !== null || board.answered.length > 0) ? (
        <NoteSection
          title={translate('auto.hq.notes.tileAnswered', 'Answered')}
          count={board.answered.length}
          empty={translate('auto.hq.notes.emptyAnswered', 'No answers yet.')}
        >
          {board.answered.map((waiting) => row(waiting))}
        </NoteSection>
      ) : null}
      {shows('waiting') ? (
        <NoteSection
          title={translate('auto.hq.waiting.onThem', "I'm waiting on")}
          count={board.waiting.length}
          empty={translate('auto.hq.waiting.emptyOnThem', "You're not waiting on anyone.")}
          framed={false}
        >
          {groupHqNotesByPerson(board.waiting, personName).map((group) => (
            <li key={group.key} className="overflow-hidden rounded-lg border border-border bg-card">
              <span className="flex items-center gap-2 bg-muted/40 px-3 py-2 text-sm font-semibold">
                <span className="flex size-6 items-center justify-center rounded-full bg-status-warning-background text-2xs text-status-warning">
                  {noteInitials(group.name ?? '?')}
                </span>
                {group.name ?? translate('auto.hq.notes.nobody', 'No one named')}
                <span className="font-normal text-muted-foreground tabular-nums">
                  {group.items.length}
                </span>
              </span>
              <ul className="flex flex-col divide-y divide-border border-t border-border">
                {group.items.map((waiting) => row(waiting, group.name === null))}
              </ul>
            </li>
          ))}
        </NoteSection>
      ) : null}
      {shows('on-me') ? (
        <NoteSection
          title={translate('auto.hq.waiting.onMe', 'Waiting on me')}
          count={counts['on-me']}
          empty={translate('auto.hq.waiting.emptyOnMe', 'Nobody is waiting on you.')}
        >
          <SlackWaitingRows now={now} />
          {board.onMe.map((waiting) => row(waiting))}
        </NoteSection>
      ) : null}
      {filter === null ? (
        <>
          <NoteSection
            title={translate('auto.hq.notes.notes', 'Just notes')}
            count={board.notes.length}
            empty={translate('auto.hq.notes.empty', 'No notes.')}
          >
            {board.notes.map((waiting) => row(waiting))}
          </NoteSection>
          <DecisionsColumn decisions={decisions} now={now} initialLimit={5} />
        </>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.hq.notes.hintReplies',
          "A question a chat sends to Slack lands in «I'm waiting on»; the answer comes back here and to that chat. Remind writes to the person only after you approve it."
        )}
      </p>
    </div>
  )
}
