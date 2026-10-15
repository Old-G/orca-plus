// Custom build (hq-today-inbox): HQ's Today in «New view», laid out like a messenger — on the left
// everything that needs the owner, by urgency; on the right the open item with its own buttons.
import { useMemo, useState } from 'react'
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import { readyHqTasks } from '../../../../../shared/hq-closing'
import { hqSlackRequestKind } from '../../../../../shared/hq-slack-scout'
import { pendingHqTriageTasks } from '../../../../../shared/hq-triage'
import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useLiveDashboardSnapshot } from '../../dashboard/useLiveDashboardSnapshot'
import { useHqSlackRequestEditTarget } from '../slack-requests/hq-slack-request-actions'
import { buildHqTodayAgents, buildHqTodayTasks } from './hq-today'
import { findHqWorktreeId } from './hq-today-actions'
import {
  HQ_INBOX_SECTIONS,
  hqInboxBadge,
  pickHqInboxKey,
  buildHqInboxItems,
  type HqInboxItem,
  type HqInboxSection
} from './hq-today-inbox-items'
import { WaitingAgentCard } from './HqTodayPeople'
import { SlackRequestList, useHqSlackDrafts } from './HqTodaySlackDrafts'
import { HqCommandBox } from './HqTodayTab'
import { HqTodayTriage } from './HqTodayTriage'
import { HqTodayLimits } from './HqTodayWork'
import { HqTodayReviews } from './HqTodayWorkspaceReviews'
import { useHqReviewRequests } from './HqTodayReviewRequests'
import { ColumnHeader } from './hq-waiting-parts'
import { useHqClickUpConnection, useHqMyClickUpTasks } from './use-hq-project-clickup'

const AGE_TICK_MS = 60_000
const TODAY_SOURCE_PROJECT = 'hq-today'
const NO_DECISIONS = {}
const NO_SNOOZE: ReadonlySet<string> = new Set()
const OTHER_PRS = 'other:prs'
const OTHER_LIMITS = 'other:limits'

function sectionTitle(section: HqInboxSection): string {
  switch (section) {
    case 'needs':
      return translate('auto.hq.inbox.needs', 'Needs you')
    case 'ready':
      return translate('auto.hq.inbox.ready', 'Ready for review')
    case 'tasks':
      return translate('auto.hq.inbox.tasks', 'Tasks')
    case 'reviews':
      return translate('auto.hq.inbox.reviews', 'Reviews')
  }
}

function itemText(item: HqInboxItem): { title: string; subtitle: string } {
  switch (item.kind) {
    case 'slack': {
      const kind = hqSlackRequestKind(item.draft)
      const label =
        kind === 'answer'
          ? translate('auto.hq.slack.kind.answer', 'Reply')
          : kind === 'fyi'
            ? translate('auto.hq.slack.kind.fyi', 'FYI')
            : translate('auto.hq.slack.kind.do', 'Do')
      return {
        title: `${item.draft.author ? `${item.draft.author}: ` : ''}${item.draft.ask || item.draft.title}`,
        subtitle: [label, 'Slack', item.draft.channelName].filter(Boolean).join(' · ')
      }
    }
    case 'agent':
      return {
        title: item.card.conversationName || item.card.task || item.card.agentType,
        subtitle: `${item.card.repoName} · ${translate('auto.hq.inbox.agentWaits', 'waits for you')}`
      }
    case 'ready':
      return {
        title: `${item.task.identifier} ${item.task.title}`,
        subtitle: item.task.status.name
      }
    case 'new-task':
      return {
        title: `${translate('auto.hq.inbox.newTask', 'New')}: ${item.task.title}`,
        subtitle: ['ClickUp', item.task.listName ?? item.task.identifier].join(' · ')
      }
    case 'due':
      return {
        title: `${item.overdue ? translate('auto.hq.inbox.overdue', 'Overdue') : translate('auto.hq.inbox.dueToday', 'Due today')}: ${item.task.title}`,
        subtitle: item.task.status.name
      }
    case 'review':
      return {
        title: item.review.title,
        subtitle: [item.review.ref, item.review.author].filter(Boolean).join(' · ')
      }
  }
}

function InboxRow({
  item,
  active,
  now,
  onSelect
}: {
  item: HqInboxItem
  active: boolean
  now: number
  onSelect: () => void
}): React.JSX.Element {
  const { title, subtitle } = itemText(item)
  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={onSelect}
        className={cn(
          'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          active && 'bg-accent'
        )}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">
          {hqInboxBadge(item)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px]">{title}</span>
            {item.at ? (
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {formatShortTimeAgo(item.at, now)}
              </span>
            ) : null}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>
        </span>
      </button>
    </li>
  )
}

function OtherRow({
  label,
  active,
  onSelect
}: {
  label: string
  active: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={onSelect}
        className={cn(
          'w-full rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          active && 'bg-accent text-foreground'
        )}
      >
        {label}
      </button>
    </li>
  )
}

function TaskDetail({ task }: { task: ClickUpTaskSummary }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {['ClickUp', task.identifier, task.status.name].join(' · ')}
      </p>
      <h3 className="text-sm font-semibold">{task.title}</h3>
      <div>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          onClick={() => void window.api.shell.openUrl(task.url)}
        >
          {translate('auto.hq.inbox.openClickUp', 'Open in ClickUp')}
        </Button>
      </div>
    </div>
  )
}

function ItemDetail({
  item,
  now,
  onSlackDone,
  onSlackChanged
}: {
  item: HqInboxItem
  now: number
  onSlackDone: (id: string) => void
  onSlackChanged: () => void
}): React.JSX.Element {
  const cards = useLiveDashboardSnapshot().cards
  switch (item.kind) {
    case 'slack':
      return (
        <div className="flex flex-col gap-3">
          <SlackRequestList drafts={[item.draft]} onDone={onSlackDone} onChanged={onSlackChanged} />
          {item.draft.description ? (
            <section className="flex flex-col gap-1 rounded-lg border border-border p-3">
              <h3 className="text-xs text-muted-foreground">
                {translate('auto.hq.inbox.understood', 'What HQ understood')}
              </h3>
              <p className="text-[13px] font-medium">{item.draft.title}</p>
              <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                {item.draft.description}
              </p>
            </section>
          ) : null}
        </div>
      )
    case 'agent':
      return (
        <ul>
          <WaitingAgentCard card={item.card} now={now} />
        </ul>
      )
    case 'ready':
    case 'new-task':
      return <HqTodayTriage now={now} cards={cards} focusTaskId={item.task.id} />
    case 'due':
      return <TaskDetail task={item.task} />
    case 'review':
      return (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs text-muted-foreground">
            {item.review.ref}
            {item.review.author ? ` · ${item.review.author}` : ''}
          </p>
          <h3 className="text-sm font-semibold">{item.review.title}</h3>
          <div>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              onClick={() => void window.api.shell.openUrl(item.review.url)}
            >
              {translate('auto.hq.inbox.openReview', 'Open the review')}
            </Button>
          </div>
        </div>
      )
  }
}

function useHqInboxItems(now: number): {
  items: HqInboxItem[]
  dropSlack: (id: string) => void
  refreshSlack: () => void
  workspaces: ReturnType<typeof useLiveDashboardSnapshot>['workspaces']
} {
  const snapshot = useLiveDashboardSnapshot()
  const slack = useHqSlackDrafts()
  const connection = useHqClickUpConnection(TODAY_SOURCE_PROJECT)
  const tasks = useHqMyClickUpTasks(connection)
  const reviews = useHqReviewRequests()
  const decisions = useAppStore((s) => s.settings?.hqTriageDecisions ?? NO_DECISIONS)
  const items = useMemo(() => {
    const all = tasks.state.status === 'ready' ? tasks.state.tasks : []
    return buildHqInboxItems({
      slack: slack.state.status === 'ready' ? slack.state.drafts : [],
      waitingAgents: buildHqTodayAgents(snapshot.cards).needYou,
      ready: readyHqTasks(all, decisions, snapshot.cards).map(({ task }) => task),
      newTasks: pendingHqTriageTasks(all, decisions, NO_SNOOZE),
      due: buildHqTodayTasks(all, now),
      reviews: reviews.state.status === 'ready' ? reviews.state.result.reviews : []
    })
  }, [slack.state, snapshot.cards, tasks.state, decisions, now, reviews.state])
  return {
    items,
    dropSlack: slack.drop,
    refreshSlack: slack.refresh,
    workspaces: snapshot.workspaces
  }
}

export function HqTodayInbox(): React.JSX.Element {
  const now = useNow(AGE_TICK_MS)
  const { items, dropSlack, refreshSlack, workspaces } = useHqInboxItems(now)
  const [selected, setSelected] = useState<string | null>(null)
  const editTarget = useHqSlackRequestEditTarget()
  const hqWorktreeId = useAppStore((s) =>
    findHqWorktreeId(s.settings?.hqPath, s.repos, s.worktreesByRepo)
  )
  // Why: «Edit» in the bell or a toast opens this request, whatever was open before.
  const editKey = editTarget.id ? `slack:${editTarget.id}` : null
  const activeKey =
    editKey && items.some((item) => item.key === editKey)
      ? editKey
      : selected === OTHER_PRS || selected === OTHER_LIMITS
        ? selected
        : pickHqInboxKey(items, selected)
  const active = items.find((item) => item.key === activeKey) ?? null
  const select = (key: string): void => {
    if (editTarget.id) {
      editTarget.clear()
    }
    setSelected(key)
  }

  return (
    <div className="flex h-full min-h-0 flex-row @max-3xl/hq:flex-col">
      <aside className="scrollbar-sleek flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border p-3 @max-3xl/hq:max-h-80 @max-3xl/hq:w-full @max-3xl/hq:border-r-0 @max-3xl/hq:border-b">
        <HqCommandBox hqWorktreeId={hqWorktreeId} compact />
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {translate('auto.hq.inbox.empty', 'Nothing needs you right now.')}
          </p>
        ) : null}
        {HQ_INBOX_SECTIONS.map((section) => {
          const rows = items.filter((item) => item.section === section)
          return rows.length === 0 ? null : (
            <section
              key={section}
              className="flex flex-col gap-1"
              aria-label={sectionTitle(section)}
            >
              <ColumnHeader title={sectionTitle(section)} count={rows.length} />
              <ul className="flex flex-col">
                {rows.map((item) => (
                  <InboxRow
                    key={item.key}
                    item={item}
                    active={item.key === activeKey}
                    now={now}
                    onSelect={() => select(item.key)}
                  />
                ))}
              </ul>
            </section>
          )
        })}
        <ul className="mt-auto flex flex-col border-t border-border pt-2">
          <OtherRow
            label={translate('auto.hq.inbox.yourPrs', 'Your open PRs and MRs')}
            active={activeKey === OTHER_PRS}
            onSelect={() => select(OTHER_PRS)}
          />
          <OtherRow
            label={translate('auto.hq.inbox.limits', 'Limits')}
            active={activeKey === OTHER_LIMITS}
            onSelect={() => select(OTHER_LIMITS)}
          />
        </ul>
      </aside>
      <div className="scrollbar-sleek min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        {activeKey === OTHER_PRS ? (
          <HqTodayReviews workspaces={workspaces ?? []} />
        ) : activeKey === OTHER_LIMITS ? (
          <HqTodayLimits />
        ) : active ? (
          <ItemDetail
            key={active.key}
            item={active}
            now={now}
            onSlackDone={dropSlack}
            onSlackChanged={refreshSlack}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            {translate('auto.hq.inbox.emptyDetail', 'Pick an item on the left.')}
          </p>
        )}
      </div>
    </div>
  )
}
