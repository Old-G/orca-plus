import type {
  ClickUpComment,
  ClickUpConnectResult,
  ClickUpConnectionStatus,
  ClickUpList,
  ClickUpMutationResult,
  ClickUpSpace,
  ClickUpStatus,
  ClickUpTask,
  ClickUpTaskFilter,
  ClickUpTaskSummary
} from '../../../shared/clickup-types'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import {
  getTaskSourceRuntimeSettings,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'

export type RuntimeClickUpSettings =
  | Pick<GlobalSettings, 'activeRuntimeEnvironmentId'>
  | TaskSourceContext
  | null
  | undefined

// Why: like Jira, a paired `orca serve` host owns its ClickUp token; local and
// direct-SSH workspaces call this desktop's main process.
function call<T>(
  settings: RuntimeClickUpSettings,
  method: string,
  params: unknown,
  local: () => Promise<T>,
  timeoutMs = 30_000
): Promise<T> {
  const target = getActiveRuntimeTarget(
    settings && 'kind' in settings ? getTaskSourceRuntimeSettings(settings) : settings
  )
  return target.kind === 'environment'
    ? callRuntimeRpc<T>(target, `clickup.${method}`, params, { timeoutMs })
    : local()
}

export function clickUpStatus(settings: RuntimeClickUpSettings): Promise<ClickUpConnectionStatus> {
  return call(settings, 'status', undefined, () => window.api.clickup.status(), 15_000)
}

export function clickUpConnect(
  settings: RuntimeClickUpSettings,
  apiToken: string
): Promise<ClickUpConnectResult> {
  return call(settings, 'connect', { apiToken }, () => window.api.clickup.connect({ apiToken }))
}

export async function clickUpDisconnect(settings: RuntimeClickUpSettings): Promise<void> {
  await call(settings, 'disconnect', undefined, () => window.api.clickup.disconnect(), 15_000)
}

export function clickUpTestConnection(
  settings: RuntimeClickUpSettings
): Promise<ClickUpConnectResult> {
  return call(settings, 'testConnection', undefined, () => window.api.clickup.testConnection())
}

export function clickUpSelectWorkspace(
  settings: RuntimeClickUpSettings,
  workspaceId: string
): Promise<ClickUpConnectionStatus> {
  return call(settings, 'selectWorkspace', { workspaceId }, () =>
    window.api.clickup.selectWorkspace({ workspaceId })
  )
}

export function clickUpListTasks(
  settings: RuntimeClickUpSettings,
  filter: ClickUpTaskFilter,
  limit?: number
): Promise<ClickUpTaskSummary[]> {
  const args = { filter, limit }
  return call(settings, 'listTasks', args, () => window.api.clickup.listTasks(args), 60_000)
}

export function clickUpSearchTasks(
  settings: RuntimeClickUpSettings,
  query: string,
  filter: ClickUpTaskFilter,
  limit?: number
): Promise<ClickUpTaskSummary[]> {
  const args = { query, filter, limit }
  return call(settings, 'searchTasks', args, () => window.api.clickup.searchTasks(args), 60_000)
}

export function clickUpGetTask(
  settings: RuntimeClickUpSettings,
  taskId: string
): Promise<ClickUpTask | null> {
  return call(settings, 'getTask', { taskId }, () => window.api.clickup.getTask({ taskId }))
}

export function clickUpTaskComments(
  settings: RuntimeClickUpSettings,
  taskId: string
): Promise<ClickUpComment[]> {
  return call(settings, 'taskComments', { taskId }, () =>
    window.api.clickup.taskComments({ taskId })
  )
}

export function clickUpUpdateTaskStatus(
  settings: RuntimeClickUpSettings,
  taskId: string,
  status: string
): Promise<ClickUpMutationResult> {
  const args = { taskId, status }
  return call(settings, 'updateTaskStatus', args, () => window.api.clickup.updateTaskStatus(args))
}

export function clickUpAddTaskComment(
  settings: RuntimeClickUpSettings,
  taskId: string,
  body: string
): Promise<ClickUpMutationResult> {
  const args = { taskId, body }
  return call(settings, 'addTaskComment', args, () => window.api.clickup.addTaskComment(args))
}

export function clickUpListSpaces(settings: RuntimeClickUpSettings): Promise<ClickUpSpace[]> {
  return call(settings, 'listSpaces', undefined, () => window.api.clickup.listSpaces())
}

export function clickUpListLists(
  settings: RuntimeClickUpSettings,
  spaceId: string
): Promise<ClickUpList[]> {
  return call(settings, 'listLists', { spaceId }, () => window.api.clickup.listLists({ spaceId }))
}

export function clickUpListStatuses(
  settings: RuntimeClickUpSettings,
  listId: string
): Promise<ClickUpStatus[]> {
  return call(settings, 'listStatuses', { listId }, () =>
    window.api.clickup.listStatuses({ listId })
  )
}
