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
} from '../../shared/clickup-types'

export type ClickUpApi = {
  connect: (args: { apiToken: string }) => Promise<ClickUpConnectResult>
  disconnect: () => Promise<void>
  status: () => Promise<ClickUpConnectionStatus>
  testConnection: () => Promise<ClickUpConnectResult>
  selectWorkspace: (args: { workspaceId: string }) => Promise<ClickUpConnectionStatus>
  listTasks: (args: { filter: ClickUpTaskFilter; limit?: number }) => Promise<ClickUpTaskSummary[]>
  searchTasks: (args: {
    query: string
    filter: ClickUpTaskFilter
    limit?: number
  }) => Promise<ClickUpTaskSummary[]>
  getTask: (args: { taskId: string }) => Promise<ClickUpTask | null>
  taskComments: (args: { taskId: string }) => Promise<ClickUpComment[]>
  updateTaskStatus: (args: { taskId: string; status: string }) => Promise<ClickUpMutationResult>
  addTaskComment: (args: { taskId: string; body: string }) => Promise<ClickUpMutationResult>
  listSpaces: () => Promise<ClickUpSpace[]>
  listLists: (args: { spaceId: string }) => Promise<ClickUpList[]>
  listStatuses: (args: { listId: string }) => Promise<ClickUpStatus[]>
}
