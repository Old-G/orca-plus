import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  isClickUpStatusDone,
  type ClickUpStatus,
  type ClickUpTaskSummary
} from '../../../../../shared/clickup-types'

export function ClickUpStatusChip({ status }: { status: ClickUpStatus }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex max-w-[160px] items-center gap-1.5 rounded-full border border-border/50 px-2 py-0.5 text-[11px]',
        isClickUpStatusDone(status) ? 'text-status-success' : 'text-muted-foreground'
      )}
    >
      {/* Why: the dot carries the workspace's own status color; the label stays tokenized. */}
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full bg-muted-foreground"
        style={status.color ? { backgroundColor: status.color } : undefined}
      />
      <span className="truncate">{status.name}</span>
    </span>
  )
}

export function formatClickUpTime(timestamp: number | null): string | null {
  return timestamp ? formatUiRelativeTime(timestamp - Date.now()) : null
}

export function ClickUpTaskList({
  tasks,
  selectedTaskId,
  onOpenTask,
  onStartWorkspace
}: {
  tasks: ClickUpTaskSummary[]
  selectedTaskId: string | null
  onOpenTask: (task: ClickUpTaskSummary) => void
  onStartWorkspace: (task: ClickUpTaskSummary) => void
}): React.JSX.Element {
  return (
    <div className="divide-y divide-border/50">
      {tasks.map((task) => (
        <div
          key={task.id}
          data-current={selectedTaskId === task.id ? 'true' : undefined}
          className="group flex items-center gap-3 px-3 py-2 hover:bg-accent data-[current=true]:bg-accent"
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            onClick={() => onOpenTask(task)}
          >
            <span className="w-24 shrink-0 truncate font-mono text-xs text-muted-foreground">
              {task.identifier}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-foreground">{task.title}</span>
              {task.listName ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {task.listName}
                </span>
              ) : null}
            </span>
            <ClickUpStatusChip status={task.status} />
            <span className="hidden w-24 shrink-0 truncate text-xs text-muted-foreground md:block">
              {task.assignees
                .map((assignee) => assignee.initials ?? assignee.username)
                .join(', ') ||
                translate('auto.components.task-page.clickup.TaskList.unassigned', 'Unassigned')}
            </span>
            <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground lg:block">
              {formatClickUpTime(task.updatedAt)}
            </span>
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={() => onStartWorkspace(task)}
                aria-label={translate(
                  'auto.components.task-page.clickup.TaskList.startWorkspace',
                  'Start workspace'
                )}
              >
                <ArrowRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {translate(
                'auto.components.task-page.clickup.TaskList.startWorkspace',
                'Start workspace'
              )}
            </TooltipContent>
          </Tooltip>
        </div>
      ))}
    </div>
  )
}
