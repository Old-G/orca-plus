import {
  clampClickUpTaskLimit,
  normalizeClickUpTaskFilter,
  type ClickUpConnectionStatus
} from '../../shared/clickup-types'
import {
  connectClickUp,
  disconnectClickUp,
  getClickUpStatus,
  selectClickUpWorkspace,
  testClickUpConnection
} from '../clickup/clickup-client'
import {
  addClickUpTaskComment,
  getClickUpTask,
  listClickUpListStatuses,
  listClickUpLists,
  listClickUpSpaces,
  listClickUpTaskComments,
  listClickUpTasks,
  searchClickUpTasks,
  updateClickUpTaskStatus
} from '../clickup/clickup-tasks'

export class RuntimeClickUpCommands {
  clickupConnect(apiToken: string): ReturnType<typeof connectClickUp> {
    return connectClickUp(apiToken)
  }

  clickupDisconnect(): { ok: true } {
    disconnectClickUp()
    return { ok: true }
  }

  clickupStatus(): ClickUpConnectionStatus {
    return getClickUpStatus()
  }

  clickupTestConnection(): ReturnType<typeof testClickUpConnection> {
    return testClickUpConnection()
  }

  clickupSelectWorkspace(workspaceId: string): ClickUpConnectionStatus {
    return selectClickUpWorkspace(workspaceId)
  }

  clickupListTasks(filter: unknown, limit: unknown): ReturnType<typeof listClickUpTasks> {
    return listClickUpTasks(normalizeClickUpTaskFilter(filter), clampClickUpTaskLimit(limit))
  }

  clickupSearchTasks(
    query: string,
    filter: unknown,
    limit: unknown,
    signal?: AbortSignal
  ): ReturnType<typeof searchClickUpTasks> {
    return searchClickUpTasks(
      query,
      normalizeClickUpTaskFilter(filter),
      clampClickUpTaskLimit(limit),
      signal
    )
  }

  clickupGetTask(taskId: string): ReturnType<typeof getClickUpTask> {
    return getClickUpTask(taskId)
  }

  clickupTaskComments(taskId: string): ReturnType<typeof listClickUpTaskComments> {
    return listClickUpTaskComments(taskId)
  }

  clickupUpdateTaskStatus(
    taskId: string,
    status: string
  ): ReturnType<typeof updateClickUpTaskStatus> {
    return updateClickUpTaskStatus(taskId, status)
  }

  clickupAddTaskComment(taskId: string, body: string): ReturnType<typeof addClickUpTaskComment> {
    return addClickUpTaskComment(taskId, body)
  }

  clickupListSpaces(): ReturnType<typeof listClickUpSpaces> {
    return listClickUpSpaces()
  }

  clickupListLists(spaceId: string): ReturnType<typeof listClickUpLists> {
    return listClickUpLists(spaceId)
  }

  clickupListStatuses(listId: string): ReturnType<typeof listClickUpListStatuses> {
    return listClickUpListStatuses(listId)
  }
}
