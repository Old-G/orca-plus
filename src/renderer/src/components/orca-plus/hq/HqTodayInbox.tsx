// Custom build (hq-today-inbox): HQ's Today in «New view», laid out like a messenger — on the left
// everything that needs the owner, by urgency; on the right the open item with its own buttons.
import { useMemo, useState } from 'react'
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import { readyHqTasks } from '../../../../../shared/hq-closing'
import { pendingHqTriageTasks } from '../../../../../shared/hq-triage'
import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useLiveDashboardSnapshot } from '../../dashboard/useLiveDashboardSnapshot'
import { useHqSlackRequestEditTarget } from '../slack-requests/hq-slack-request-actions'
import { buildHqTodayAgents, buildHqTodayTasks } from './hq-today'
import { findHqWorktreeId } from './hq-today-actions'
import {
  HQ_INBOX_SECTIONS,
  pickHqInboxKey,
  buildHqInboxItems,
  type HqInboxItem
} from './hq-today-inbox-items'
import { WaitingAgentCard } from './HqTodayPeople'
import { SlackRequestList, useHqSlackDrafts } from './HqTodaySlackDrafts'
import { HqTodayQuiet } from './HqTodayQuiet'
import type { HqSlackQuietItem } from '../../../../../shared/hq-slack-digest'
import { HqCommandBox } from './HqTodayTab'
import { HqTodayTriage } from './HqTodayTriage'
import { HqTodayLimits } from './HqTodayWork'
import { HqTodayReviews } from './HqTodayWorkspaceReviews'
import { useHqReviewRequests } from './HqTodayReviewRequests'
import { BellOff, Gauge, GitPullRequest } from 'lucide-react'
import { CommentMarkdownAsync } from '../../sidebar/comment-markdown-lazy'
import { HqInboxCard, HqInboxOtherRow, HqInboxRow, hqInboxSectionTitle } from './HqTodayInboxRow'
import { HqStatusUpdateButton } from './HqStatusUpdateButton'
import { useHqClickUpConnection, useHqMyClickUpTasks } from './use-hq-project-clickup'
import { useHqSpaces, type HqSpacesView } from './use-hq-spaces'
import { hqReviewProject } from '../../../../../shared/hq-spaces'

const AGE_TICK_MS = 60_000
const TODAY_SOURCE_PROJECT = 'hq-today'
const NO_DECISIONS = {}
const NO_SNOOZE: ReadonlySet<string> = new Set()
const OTHER_PRS = 'other:prs'
const OTHER_LIMITS = 'other:limits'
const OTHER_QUIET = 'other:quiet'

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
            <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs text-muted-foreground">
                {translate('auto.hq.inbox.understood', 'What HQ understood')}
              </h3>
              <p className="text-sm font-medium">{item.draft.title}</p>
              <CommentMarkdownAsync
                content={item.draft.description}
                variant="document"
                className="text-sm text-muted-foreground"
              />
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

function hqInboxItemShown(item: HqInboxItem, spaces: HqSpacesView): boolean {
  switch (item.kind) {
    case 'slack':
      return item.draft.project
        ? spaces.shows({ project: item.draft.project })
        : spaces.usesSource(item.draft.source ?? 'slack')
    case 'agent':
      return spaces.shows({ repoId: item.card.repoId })
    case 'review':
      return spaces.shows({ project: hqReviewProject(item.review.ref) })
    case 'ready':
    case 'new-task':
    case 'due':
      return spaces.usesSource('clickup')
  }
}

function useHqInboxItems(now: number): {
  items: HqInboxItem[]
  dropSlack: (id: string) => void
  refreshSlack: () => void
  quiet: HqSlackQuietItem[]
  workspaces: ReturnType<typeof useLiveDashboardSnapshot>['workspaces']
} {
  const snapshot = useLiveDashboardSnapshot()
  const slack = useHqSlackDrafts()
  const connection = useHqClickUpConnection(TODAY_SOURCE_PROJECT)
  const tasks = useHqMyClickUpTasks(connection)
  const reviews = useHqReviewRequests()
  const decisions = useAppStore((s) => s.settings?.hqTriageDecisions ?? NO_DECISIONS)
  // Custom build (hq-spaces): only the chosen workspace's requests, agents, tasks and reviews.
  const spaces = useHqSpaces()
  const items = useMemo(() => {
    const all = tasks.state.status === 'ready' ? tasks.state.tasks : []
    return buildHqInboxItems({
      slack: slack.state.status === 'ready' ? slack.state.drafts : [],
      waitingAgents: buildHqTodayAgents(snapshot.cards).needYou,
      ready: readyHqTasks(all, decisions, snapshot.cards).map(({ task }) => task),
      newTasks: pendingHqTriageTasks(all, decisions, NO_SNOOZE),
      due: buildHqTodayTasks(all, now),
      reviews: reviews.state.status === 'ready' ? reviews.state.result.reviews : []
    }).filter((item) => hqInboxItemShown(item, spaces))
  }, [slack.state, snapshot.cards, tasks.state, decisions, now, reviews.state, spaces])
  return {
    items,
    dropSlack: slack.drop,
    refreshSlack: slack.refresh,
    quiet: slack.state.status === 'ready' ? slack.state.quiet : [],
    workspaces: snapshot.workspaces
  }
}

export function HqTodayInbox(): React.JSX.Element {
  const now = useNow(AGE_TICK_MS)
  const { items, dropSlack, refreshSlack, workspaces, quiet } = useHqInboxItems(now)
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
      : selected === OTHER_PRS || selected === OTHER_LIMITS || selected === OTHER_QUIET
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
    <div className="flex h-full min-h-0 flex-col">
      {/* Custom build (hq-ask, hq-status-update): the two things the owner starts from Today. */}
      <header className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <HqCommandBox hqWorktreeId={hqWorktreeId} />
        </div>
        <HqStatusUpdateButton hqWorktreeId={hqWorktreeId} />
      </header>
      <div className="flex min-h-0 flex-1 flex-row @max-3xl/hq:flex-col">
        <aside className="scrollbar-sleek flex w-96 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border p-4 @max-3xl/hq:max-h-96 @max-3xl/hq:w-full @max-3xl/hq:border-r-0 @max-3xl/hq:border-b">
          {items.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              {translate('auto.hq.inbox.empty', 'Nothing needs you right now.')}
            </p>
          ) : null}
          {HQ_INBOX_SECTIONS.map((section) => {
            const rows = items.filter((item) => item.section === section)
            return rows.length === 0 ? null : (
              <HqInboxCard key={section} title={hqInboxSectionTitle(section)} count={rows.length}>
                {rows.map((item) => (
                  <HqInboxRow
                    key={item.key}
                    item={item}
                    active={item.key === activeKey}
                    now={now}
                    onSelect={() => select(item.key)}
                  />
                ))}
              </HqInboxCard>
            )
          })}
          <HqInboxCard title={translate('auto.hq.inbox.more', 'More')}>
            <HqInboxOtherRow
              icon={<GitPullRequest className="size-4" />}
              label={translate('auto.hq.inbox.yourPrs', 'Your open PRs and MRs')}
              active={activeKey === OTHER_PRS}
              onSelect={() => select(OTHER_PRS)}
            />
            <HqInboxOtherRow
              icon={<Gauge className="size-4" />}
              label={translate('auto.hq.inbox.limits', 'Limits')}
              active={activeKey === OTHER_LIMITS}
              onSelect={() => select(OTHER_LIMITS)}
            />
            {/* Custom build (hq-scout-digest): Slack read and set aside without a card. */}
            <HqInboxOtherRow
              icon={<BellOff className="size-4" />}
              label={translate('auto.hq.inbox.quiet', 'Quiet in Slack ({{value0}})', {
                value0: quiet.length
              })}
              active={activeKey === OTHER_QUIET}
              onSelect={() => select(OTHER_QUIET)}
            />
          </HqInboxCard>
        </aside>
        <div className="scrollbar-sleek min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col">
            {activeKey === OTHER_PRS ? (
              <HqTodayReviews workspaces={workspaces ?? []} />
            ) : activeKey === OTHER_LIMITS ? (
              <HqTodayLimits />
            ) : activeKey === OTHER_QUIET ? (
              <HqTodayQuiet items={quiet} now={now} />
            ) : active ? (
              <ItemDetail
                key={active.key}
                item={active}
                now={now}
                onSlackDone={dropSlack}
                onSlackChanged={refreshSlack}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {translate('auto.hq.inbox.emptyDetail', 'Pick an item on the left.')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
