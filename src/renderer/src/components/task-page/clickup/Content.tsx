import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { TaskPageComposerActionsModel } from '../../use-task-page-composer-actions'
import { ClickUpConnectDialog } from '@/components/clickup-connect-dialog'
import { ClickUpIcon } from '@/components/icons/ClickUpIcon'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  buildClickUpLinkedWorkItem,
  buildClickUpTaskSourceContext,
  getClickUpTaskWorkspaceSeed
} from '@/lib/clickup-linked-work-item'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { useAppStore } from '@/store'
import type { ClickUpTask, ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import { clickUpGetTask } from '@/runtime/runtime-clickup-client'
import { ClickUpTaskFilters } from './Filters'
import { ClickUpTaskList } from './TaskList'
import { ClickUpTaskSheet } from './TaskSheet'
import { useClickUpTaskList } from './use-clickup-task-list'

export function TaskPageClickUpContent({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element {
  const { hideTaskSource, accountBackedTaskSourceHostId, fallbackTaskSourceProjectId } = model
  const settings = useAppStore((s) => s.settings)
  const status = useAppStore((s) => s.clickUpStatus)
  const statusChecked = useAppStore((s) => s.clickUpStatusChecked)
  const statusContextKey = useAppStore((s) => s.clickUpStatusContextKey)
  const openModal = useAppStore((s) => s.openModal)
  const checkConnection = useAppStore((s) => s.checkClickUpConnection)
  const [connectOpen, setConnectOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<ClickUpTaskSummary | null>(null)

  const contextKey = getProviderRuntimeContextKey(settings)
  const ready = statusChecked && statusContextKey === contextKey
  const connected = ready && status.connected
  // Why: only Settings checked the connection, so a cold start left the page spinning.
  useEffect(() => {
    if (!ready) {
      void checkConnection()
    }
  }, [checkConnection, contextKey, ready])
  const workspace =
    status.workspaces.find((entry) => entry.id === status.selectedWorkspaceId) ??
    status.workspaces[0] ??
    null
  const sourceContext = useMemo(
    () =>
      buildClickUpTaskSourceContext({
        projectId: fallbackTaskSourceProjectId,
        hostId: accountBackedTaskSourceHostId,
        workspace
      }),
    [accountBackedTaskSourceHostId, fallbackTaskSourceProjectId, workspace]
  )
  const list = useClickUpTaskList(sourceContext, connected)

  const startWorkspace = async (task: ClickUpTaskSummary | ClickUpTask): Promise<void> => {
    // Why: the agent prompt carries the task text, so list rows load the full task first.
    const full =
      'description' in task ? task : await clickUpGetTask(sourceContext, task.id).catch(() => null)
    openModal('new-workspace-composer', {
      linkedWorkItem: buildClickUpLinkedWorkItem(task, full),
      taskSourceContext: sourceContext,
      prefilledName: getClickUpTaskWorkspaceSeed(task),
      telemetrySource: 'sidebar'
    })
  }

  if (!ready) {
    return (
      <div className="mt-4 flex items-center justify-center py-14">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
        <ClickUpIcon className="mb-4 size-8 text-muted-foreground" />
        <p className="text-base font-medium text-foreground">
          {translate('auto.components.task-page.clickup.Content.connectTitle', 'Connect ClickUp')}
        </p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {translate(
            'auto.components.task-page.clickup.Content.connectBody',
            'Browse your ClickUp tasks and start a workspace from any of them.'
          )}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => setConnectOpen(true)}>
            {translate('auto.components.task-page.clickup.Content.connect', 'Connect ClickUp')}
          </Button>
          <Button variant="outline" onClick={() => hideTaskSource('clickup', 'ClickUp')}>
            {translate('auto.components.task-page.clickup.Content.hide', 'Hide ClickUp')}
          </Button>
        </div>
        <ClickUpConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
      </div>
    )
  }

  return (
    <div className="mt-3 flex min-h-0 max-h-full flex-col">
      <ClickUpTaskFilters state={list} />
      <div className="flex min-h-0 flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
        <div className="flex h-10 flex-none items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3">
          <div className="min-w-0 truncate text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {workspace?.name ?? translate('auto.components.TaskPage.clickUpSource', 'ClickUp')}
          </div>
          <div className="shrink-0 text-[11px] text-muted-foreground">
            {translate('auto.components.task-page.clickup.Content.shown', '{{count}} shown', {
              count: list.tasks.length
            })}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
          {status.credentialError || list.error ? (
            <div className="border-b border-border px-4 py-4 text-sm text-destructive">
              {status.credentialError ?? list.error}
            </div>
          ) : null}
          {list.loading && list.tasks.length === 0 ? (
            <div className="divide-y divide-border/50">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="px-3 py-3">
                  <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
                  <div className="mt-2 h-3 w-3/5 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : null}
          {!list.loading && list.tasks.length === 0 && !list.error ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium text-foreground">
                {translate(
                  'auto.components.task-page.clickup.Content.empty',
                  'No ClickUp tasks found'
                )}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {list.appliedSearch
                  ? translate(
                      'auto.components.task-page.clickup.Content.emptySearch',
                      'Title search covers the 500 most recently updated tasks in this view.'
                    )
                  : translate(
                      'auto.components.task-page.clickup.Content.emptyFilter',
                      'No open tasks match these filters.'
                    )}
              </p>
            </div>
          ) : null}
          <ClickUpTaskList
            tasks={list.tasks}
            selectedTaskId={selectedTask?.id ?? null}
            onOpenTask={setSelectedTask}
            onStartWorkspace={(task) => void startWorkspace(task)}
          />
        </div>
      </div>
      <ClickUpTaskSheet
        summary={selectedTask}
        sourceContext={sourceContext}
        onClose={() => setSelectedTask(null)}
        onUse={(task) => void startWorkspace(task)}
        onTaskChanged={list.refresh}
      />
    </div>
  )
}
