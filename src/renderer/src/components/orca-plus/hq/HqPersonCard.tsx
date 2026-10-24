// Custom build (hq-people): one person in HQ's People — who they are in the company, what is open
// between them and the owner, what went to them through Approve, the owner's notes, and a button
// that has an HQ chat prepare a meeting with them.
import { useEffect, useState } from 'react'
import { CalendarClock, List } from 'lucide-react'
import {
  hqMeetingPrepPrompt,
  readHqPersonCard,
  type HqPeopleRow,
  type HqPersonCard as Card,
  type HqPersonCardItem
} from '../../../../../shared/hq-people'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { useAppStore } from '@/store'
import { startHqChatWithPrompt } from './hq-ask-chat'
import { findHqWorktreeId } from './hq-today-actions'
import { ColumnHeader } from './hq-waiting-parts'

const AGE_TICK_MS = 60_000

type CardState =
  | { status: 'loading' }
  | { status: 'ready'; card: Card }
  | { status: 'error'; message: string }

function useHqPersonCard(key: string, refresh: number): CardState {
  const [state, setState] = useState<CardState>({ status: 'loading' })
  useEffect(() => {
    let live = true
    void window.api.runtime
      .call({ method: 'hqProjects.person', params: { key } })
      .then((response) => {
        if (!live) {
          return
        }
        const card = response.ok ? readHqPersonCard(response.result) : null
        setState(
          card
            ? { status: 'ready', card }
            : {
                status: 'error',
                message: response.ok ? 'Unreadable answer.' : response.error.message
              }
        )
      })
      .catch((error: unknown) => live && setState({ status: 'error', message: String(error) }))
    return () => {
      live = false
    }
  }, [key, refresh])
  return state
}

function PersonLink({
  row,
  onSelect
}: {
  row: HqPeopleRow
  onSelect: (key: string) => void
}): React.JSX.Element {
  return (
    <Button type="button" variant="outline" size="xs" onClick={() => onSelect(row.key)}>
      {row.name}
    </Button>
  )
}

function Items({
  title,
  items,
  empty,
  now
}: {
  title: string
  items: HqPersonCardItem[]
  empty: string
  now: number
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1.5">
      <ColumnHeader title={title} count={items.length} />
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((entry) => (
            <li key={entry.id} className="flex items-baseline gap-2 text-[13px]">
              <span className="min-w-0 flex-1">{entry.title}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {[entry.project, formatShortTimeAgo(entry.at, now)].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function HqPersonCard({
  row,
  people,
  onSelect,
  onShowList
}: {
  row: HqPeopleRow
  people: HqPeopleRow[]
  onSelect: (key: string) => void
  /** Back to the list where the pane is too narrow for both. */
  onShowList: () => void
}): React.JSX.Element {
  const now = useNow(AGE_TICK_MS)
  const state = useHqPersonCard(row.key, row.onMe + row.onThem)
  const hqWorktreeId = useAppStore((s) =>
    findHqWorktreeId(s.settings?.hqPath, s.repos, s.worktreesByRepo)
  )
  const [prep, setPrep] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null
  })
  const manager = people.find((entry) => entry.key === row.supervisorKey) ?? null
  const reports = people.filter((entry) => entry.supervisorKey === row.key)
  const facts = [row.department, row.location].filter(Boolean).join(' · ')
  const prepare = (): void => {
    if (!hqWorktreeId) {
      return
    }
    setPrep({ busy: true, error: null })
    void startHqChatWithPrompt(
      hqWorktreeId,
      hqMeetingPrepPrompt(row),
      translate('auto.hq.people.prepChat', 'Meeting · {{name}}', { name: row.name })
    ).then((started) => setPrep({ busy: false, error: started.ok ? null : started.message }))
  }
  return (
    <article className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6 @max-md/hq:p-4">
        <header className="flex items-start gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="@xl/hq:hidden"
            onClick={onShowList}
            aria-label={translate('auto.hq.pinned.people', 'People')}
          >
            <List />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h3 className="text-base font-semibold">
              {row.name}
              {row.orgName && row.orgName !== row.name ? (
                <span className="font-normal text-muted-foreground"> · {row.orgName}</span>
              ) : null}
            </h3>
            {row.jobTitle ? <p className="text-[13px]">{row.jobTitle}</p> : null}
            {facts ? <p className="text-xs text-muted-foreground">{facts}</p> : null}
          </div>
          <Button
            type="button"
            size="sm"
            onClick={prepare}
            disabled={!hqWorktreeId || prep.busy}
            title={
              hqWorktreeId
                ? undefined
                : translate('auto.hq.remind.noHq', 'Add the HQ folder as a project first.')
            }
          >
            <CalendarClock />
            {translate('auto.hq.people.prepare', 'Prepare for a meeting')}
          </Button>
        </header>
        {prep.error ? <p className="text-xs text-destructive">{prep.error}</p> : null}
        {manager || reports.length > 0 ? (
          <div className="flex flex-col gap-2 text-[13px]">
            {manager ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">
                  {translate('auto.hq.people.reportsTo', 'Reports to')}
                </span>
                <PersonLink row={manager} onSelect={onSelect} />
              </div>
            ) : null}
            {reports.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">
                  {translate('auto.hq.people.team', 'Team')}
                </span>
                {reports.map((entry) => (
                  <PersonLink key={entry.key} row={entry} onSelect={onSelect} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {state.status === 'ready' ? (
          <>
            <Items
              title={translate('auto.hq.people.onMe', 'Waiting on you')}
              items={state.card.onMe}
              empty={translate('auto.hq.people.onMeEmpty', 'Nothing.')}
              now={now}
            />
            <Items
              title={translate('auto.hq.people.onThem', "You're waiting on them")}
              items={state.card.onThem}
              empty={translate('auto.hq.people.onThemEmpty', 'Nothing.')}
              now={now}
            />
            <Items
              title={translate('auto.hq.people.sent', 'Sent to them')}
              items={state.card.sent}
              empty={translate('auto.hq.people.sentEmpty', 'Nothing through Approve yet.')}
              now={now}
            />
            <section className="flex flex-col gap-1.5">
              <ColumnHeader title={translate('auto.hq.people.notes', 'Notes')} />
              {state.card.notes ? (
                <CommentMarkdown
                  variant="document"
                  content={state.card.notes}
                  className="text-sm"
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {row.pagePath
                    ? translate('auto.hq.people.notesEmpty', 'No notes in {{path}} yet.', {
                        path: row.pagePath
                      })
                    : translate('auto.hq.people.noPage', 'No page in HQ yet.')}
                </p>
              )}
            </section>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {state.status === 'error'
              ? state.message
              : translate('auto.hq.wiki.loading', 'Loading…')}
          </p>
        )}
        {row.slackUserId || row.clickupUserId || row.email ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            {[
              row.email ?? null,
              row.slackHandle ? `@${row.slackHandle}` : null,
              row.slackUserId ? `Slack ${row.slackUserId}` : null,
              row.clickupUserId ? `ClickUp ${row.clickupUserId}` : null
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
      </div>
    </article>
  )
}
