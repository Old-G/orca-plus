// Custom build (hq): the «Today» tab's work side — the user's ClickUp tasks due today or overdue,
// open reviews in their workspaces, and how much of the Claude and Codex limits is left.
import { useState } from 'react'
import type { ClickUpTask, ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { DashboardWorkspace } from '../../../../../shared/dashboard-snapshot'
import type { ProviderRateLimits, RateLimitWindow } from '../../../../../shared/rate-limit-types'
import { ClickUpConnectDialog } from '@/components/clickup-connect-dialog'
import { ClickUpStatusChip } from '@/components/task-page/clickup/TaskList'
import { ClickUpTaskSheet } from '@/components/task-page/clickup/TaskSheet'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  buildClickUpLinkedWorkItem,
  getClickUpTaskWorkspaceSeed
} from '@/lib/clickup-linked-work-item'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { clickUpGetTask } from '@/runtime/runtime-clickup-client'
import { useAppStore } from '@/store'
import { buildHqTodayTasks, hqDaysOverdue } from './hq-today'
import { ColumnHeader } from './hq-waiting-parts'
import { useHqClickUpConnection, useHqMyClickUpTasks } from './use-hq-project-clickup'

const TODAY_SOURCE_PROJECT = 'hq-today'

function TaskRow({
  task,
  note,
  overdue,
  onOpen
}: {
  task: ClickUpTaskSummary
  note: string
  overdue: boolean
  onOpen: (task: ClickUpTaskSummary) => void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="w-20 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
          {task.identifier}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{task.title}</span>
        <span
          data-overdue={overdue}
          className="shrink-0 text-[11px] text-muted-foreground tabular-nums data-[overdue=true]:text-destructive"
        >
          {note}
        </span>
        <ClickUpStatusChip status={task.status} />
      </button>
    </li>
  )
}

export function HqTodayDeadlines({ now }: { now: number }): React.JSX.Element {
  const connection = useHqClickUpConnection(TODAY_SOURCE_PROJECT)
  const tasks = useHqMyClickUpTasks(connection)
  const [selected, setSelected] = useState<ClickUpTaskSummary | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const openModal = useAppStore((s) => s.openModal)
  const sourceContext = connection.status === 'ready' ? connection.sourceContext : null
  const due = buildHqTodayTasks(tasks.state.status === 'ready' ? tasks.state.tasks : [], now)
  const title = translate('auto.hq.today.deadlines', 'ClickUp deadlines')

  const startWorkspace = async (task: ClickUpTaskSummary | ClickUpTask): Promise<void> => {
    // Why: the agent prompt carries the task text, so a list row loads the full task first.
    const full =
      'description' in task ? task : await clickUpGetTask(sourceContext, task.id).catch(() => null)
    setSelected(null)
    openModal('new-workspace-composer', {
      linkedWorkItem: buildClickUpLinkedWorkItem(task, full),
      taskSourceContext: sourceContext,
      prefilledName: getClickUpTaskWorkspaceSeed(task),
      telemetrySource: 'sidebar'
    })
  }

  let body: React.JSX.Element
  if (connection.status === 'disconnected') {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          {connection.error ??
            translate('auto.hq.today.clickUpOff', 'Connect ClickUp to see your deadlines.')}
        </p>
        <Button type="button" variant="secondary" size="xs" onClick={() => setConnectOpen(true)}>
          {translate('auto.hq.project.connectClickUp', 'Connect ClickUp')}
        </Button>
        <ClickUpConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
      </div>
    )
  } else if (tasks.state.status === 'error') {
    body = (
      <p className="text-xs text-destructive">
        {translate('auto.hq.project.tasksFailed', "Couldn't read tasks: {{value0}}", {
          value0: tasks.state.message
        })}
      </p>
    )
  } else if (connection.status === 'checking' || tasks.state.status === 'loading') {
    body = (
      <p className="text-xs text-muted-foreground">
        {translate('auto.hq.waiting.loading', 'Loading…')}
      </p>
    )
  } else if (due.overdue.length === 0 && due.today.length === 0) {
    body = (
      <p className="text-xs text-muted-foreground">
        {translate('auto.hq.today.noDeadlines', 'Nothing is due today.')}
      </p>
    )
  } else {
    body = (
      <ul className="flex flex-col">
        {due.overdue.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            overdue
            note={translate('auto.hq.today.overdueDays', '{{value0}} d late', {
              value0: String(hqDaysOverdue(task.dueDate ?? now, now))
            })}
            onOpen={setSelected}
          />
        ))}
        {due.today.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            overdue={false}
            note={translate('auto.hq.today.dueToday', 'today')}
            onOpen={setSelected}
          />
        ))}
      </ul>
    )
  }
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <ColumnHeader title={title} count={due.overdue.length + due.today.length} />
      {body}
      <ClickUpTaskSheet
        summary={selected}
        sourceContext={sourceContext}
        onClose={() => setSelected(null)}
        onUse={(task) => void startWorkspace(task)}
        onTaskChanged={tasks.refresh}
      />
    </section>
  )
}

export function HqTodayReviews({
  workspaces
}: {
  workspaces: readonly DashboardWorkspace[]
}): React.JSX.Element {
  const open = workspaces.filter(
    (workspace) => workspace.review?.state === 'open' || workspace.review?.state === 'draft'
  )
  const title = translate('auto.hq.today.reviews', 'Open reviews in your workspaces')
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <ColumnHeader title={title} count={open.length} />
      {open.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.today.noReviews', 'No open pull or merge requests.')}
        </p>
      ) : (
        <ul className="flex flex-col">
          {open.map((workspace) => (
            <li key={workspace.worktreeId}>
              <button
                type="button"
                onClick={() => activateAndRevealWorkspace(workspace.worktreeId)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="w-14 shrink-0 font-mono text-[11px] text-muted-foreground">
                  #{workspace.review?.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {workspace.repoName} · {workspace.worktreeName}
                </span>
                {workspace.review?.state === 'draft' ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {translate('auto.hq.today.draft', 'draft')}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function LimitWindow({
  label,
  window
}: {
  label: string
  window: RateLimitWindow | null
}): React.JSX.Element | null {
  if (!window) {
    return null
  }
  return (
    <span className="flex items-baseline gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        data-high={window.usedPercent >= 80}
        className="font-medium tabular-nums data-[high=true]:text-destructive"
      >
        {Math.round(window.usedPercent)}%
      </span>
      {window.resetDescription ? (
        <span className="text-[11px] text-muted-foreground">↻ {window.resetDescription}</span>
      ) : null}
    </span>
  )
}

export function HqTodayLimits(): React.JSX.Element {
  const limits = useAppStore((s) => s.rateLimits)
  const title = translate('auto.hq.today.limits', 'Limits')
  const providers = [
    { name: 'Claude', limits: limits.claude },
    { name: 'Codex', limits: limits.codex }
  ].filter((entry): entry is { name: string; limits: ProviderRateLimits } =>
    Boolean(entry.limits?.session || entry.limits?.weekly)
  )
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <ColumnHeader title={title} />
      {providers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.today.noLimits', 'No usage read yet.')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {providers.map((provider) => (
            <li key={provider.name} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="w-14 shrink-0 text-[13px]">{provider.name}</span>
              <LimitWindow
                label={translate('auto.hq.today.session', '5 h')}
                window={provider.limits.session}
              />
              <LimitWindow
                label={translate('auto.hq.today.week', 'week')}
                window={provider.limits.weekly}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
