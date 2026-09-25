import { useEffect, useState } from 'react'
import { ArrowRight, ExternalLink, LoaderCircle, X } from 'lucide-react'
import { VisuallyHidden } from 'radix-ui'
import { toast } from 'sonner'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import {
  clickUpAddTaskComment,
  clickUpGetTask,
  clickUpListStatuses,
  clickUpTaskComments,
  clickUpUpdateTaskStatus
} from '@/runtime/runtime-clickup-client'
import type {
  ClickUpComment,
  ClickUpStatus,
  ClickUpTask,
  ClickUpTaskSummary
} from '../../../../../shared/clickup-types'
import type { TaskSourceContext } from '../../../../../shared/task-source-context'
import { ClickUpStatusChip, formatClickUpTime } from './TaskList'

type TaskDetails = {
  task: ClickUpTask | null
  comments: ClickUpComment[]
  statuses: ClickUpStatus[]
  loading: boolean
}

const EMPTY_DETAILS: TaskDetails = { task: null, comments: [], statuses: [], loading: false }

function useClickUpTaskDetails(
  summary: ClickUpTaskSummary | null,
  sourceContext: TaskSourceContext | null,
  reloadNonce: number
): TaskDetails {
  const [details, setDetails] = useState<TaskDetails>(EMPTY_DETAILS)
  const taskId = summary?.id ?? null
  const listId = summary?.listId ?? null
  useEffect(() => {
    if (!taskId) {
      return
    }
    let cancelled = false
    setDetails((previous) => ({ ...previous, loading: true }))
    void Promise.all([
      clickUpGetTask(sourceContext, taskId),
      clickUpTaskComments(sourceContext, taskId).catch(() => []),
      listId ? clickUpListStatuses(sourceContext, listId).catch(() => []) : Promise.resolve([])
    ])
      .then(([task, comments, statuses]) => {
        if (!cancelled) {
          setDetails({ task, comments, statuses, loading: false })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetails((previous) => ({ ...previous, loading: false }))
          toast.error(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [listId, reloadNonce, sourceContext, taskId])
  return details
}

export function ClickUpTaskSheet({
  summary,
  sourceContext,
  onClose,
  onUse,
  onTaskChanged
}: {
  summary: ClickUpTaskSummary | null
  sourceContext: TaskSourceContext | null
  onClose: () => void
  onUse: (task: ClickUpTaskSummary | ClickUpTask) => void
  onTaskChanged: () => void
}): React.JSX.Element {
  const [reloadNonce, setReloadNonce] = useState(0)
  const details = useClickUpTaskDetails(summary, sourceContext, reloadNonce)
  const [statusPending, setStatusPending] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentPending, setCommentPending] = useState(false)
  // Why: show the list row immediately and swap in the full task once it arrives.
  const task = details.task && details.task.id === summary?.id ? details.task : null
  const displayed: ClickUpTaskSummary | null = task ?? summary

  const changeStatus = async (status: string): Promise<void> => {
    if (!displayed || status === displayed.status.name) {
      return
    }
    setStatusPending(true)
    const result = await clickUpUpdateTaskStatus(sourceContext, displayed.id, status)
    setStatusPending(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setReloadNonce((n) => n + 1)
    onTaskChanged()
  }

  const submitComment = async (): Promise<void> => {
    if (!displayed || !commentDraft.trim()) {
      return
    }
    setCommentPending(true)
    const result = await clickUpAddTaskComment(sourceContext, displayed.id, commentDraft)
    setCommentPending(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setCommentDraft('')
    setReloadNonce((n) => n + 1)
  }

  return (
    <Sheet open={summary !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[min(92vw,780px)] sm:max-w-[780px]"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <VisuallyHidden.Root asChild>
          <SheetTitle>
            {displayed?.title ??
              translate('auto.components.task-page.clickup.TaskSheet.title', 'ClickUp task')}
          </SheetTitle>
        </VisuallyHidden.Root>
        <VisuallyHidden.Root asChild>
          <SheetDescription>
            {translate(
              'auto.components.task-page.clickup.TaskSheet.description',
              'Preview the task, change its status, comment, and start work from it.'
            )}
          </SheetDescription>
        </VisuallyHidden.Root>
        {displayed ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
            <div className="flex-none border-b border-border/50 bg-muted/30 px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-mono">{displayed.identifier}</span>
                    {displayed.listName ? <span>{displayed.listName}</span> : null}
                    <span>{formatClickUpTime(displayed.updatedAt)}</span>
                    {details.loading ? <LoaderCircle className="size-3 animate-spin" /> : null}
                  </div>
                  <h2 className="mt-1 text-[20px] font-semibold leading-tight text-foreground">
                    {displayed.title}
                  </h2>
                </div>
                <Button size="sm" className="shrink-0" onClick={() => onUse(task ?? displayed)}>
                  {translate(
                    'auto.components.task-page.clickup.TaskSheet.start',
                    'Start workspace'
                  )}
                  <ArrowRight />
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => window.api.shell.openUrl(displayed.url)}
                      aria-label={translate(
                        'auto.components.task-page.clickup.TaskSheet.open',
                        'Open in ClickUp'
                      )}
                    >
                      <ExternalLink />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    {translate(
                      'auto.components.task-page.clickup.TaskSheet.open',
                      'Open in ClickUp'
                    )}
                  </TooltipContent>
                </Tooltip>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onClose}
                  aria-label={translate(
                    'auto.components.task-page.clickup.TaskSheet.close',
                    'Close'
                  )}
                >
                  <X />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
              {details.statuses.length > 0 ? (
                <Select
                  value={displayed.status.name}
                  onValueChange={(value) => void changeStatus(value)}
                  disabled={statusPending}
                >
                  <SelectTrigger
                    size="sm"
                    className="min-w-40"
                    aria-label={translate(
                      'auto.components.task-page.clickup.TaskSheet.status',
                      'Status'
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {details.statuses.map((status) => (
                      <SelectItem key={status.name} value={status.name}>
                        <ClickUpStatusChip status={status} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <ClickUpStatusChip status={displayed.status} />
              )}
              <span>
                {displayed.assignees.map((assignee) => assignee.username).join(', ') ||
                  translate('auto.components.task-page.clickup.TaskSheet.unassigned', 'Unassigned')}
              </span>
              {displayed.dueDate ? (
                <span>
                  {translate('auto.components.task-page.clickup.TaskSheet.due', 'Due {{date}}', {
                    date: new Date(displayed.dueDate).toLocaleDateString()
                  })}
                </span>
              ) : null}
              {displayed.priority ? <span>{displayed.priority.label}</span> : null}
              {task?.tags.length ? <span>{task.tags.join(', ')}</span> : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
              <section className="border-b border-border/40 px-4 py-4">
                {task?.description.trim() ? (
                  <CommentMarkdown
                    content={task.description}
                    variant="document"
                    className="text-sm leading-relaxed"
                  />
                ) : (
                  <p className="text-sm italic text-muted-foreground">
                    {task
                      ? translate(
                          'auto.components.task-page.clickup.TaskSheet.noDescription',
                          'No description provided.'
                        )
                      : translate(
                          'auto.components.task-page.clickup.TaskSheet.loading',
                          'Loading task…'
                        )}
                  </p>
                )}
              </section>
              <section className="space-y-3 px-4 py-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {translate('auto.components.task-page.clickup.TaskSheet.comments', 'Comments')}
                </h3>
                {details.comments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {translate(
                      'auto.components.task-page.clickup.TaskSheet.noComments',
                      'No comments yet.'
                    )}
                  </p>
                ) : (
                  details.comments.map((comment) => (
                    <div key={comment.id} className="rounded-md border border-border/50 px-3 py-2">
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {comment.author?.username}
                        </span>
                        <span>{formatClickUpTime(comment.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-foreground">{comment.body}</p>
                    </div>
                  ))
                )}
              </section>
            </div>

            <div className="flex-none space-y-2 border-t border-border/50 px-4 py-3">
              <Textarea
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                placeholder={translate(
                  'auto.components.task-page.clickup.TaskSheet.commentPlaceholder',
                  'Add a comment to this task'
                )}
                className="min-h-16"
                disabled={commentPending}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => void submitComment()}
                  disabled={!commentDraft.trim() || commentPending}
                >
                  {commentPending ? <LoaderCircle className="animate-spin" /> : null}
                  {translate('auto.components.task-page.clickup.TaskSheet.comment', 'Comment')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
