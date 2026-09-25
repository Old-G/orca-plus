import { ipcMain } from 'electron'
import {
  clampClickUpTaskLimit,
  normalizeClickUpTaskFilter,
  type ClickUpConnectResult,
  type ClickUpMutationResult
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
import { _resetPreflightCache } from './preflight'

function readArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : {}
}

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Registers every `clickup:*` IPC handler on the main process. */
export function registerClickUpHandlers(): void {
  ipcMain.handle(
    'clickup:connect',
    async (_event, args: unknown): Promise<ClickUpConnectResult> => {
      const { apiToken } = readArgs(args)
      if (typeof apiToken !== 'string') {
        return { ok: false, error: 'Personal API token is required.' }
      }
      const result = await connectClickUp(apiToken)
      if (result.ok) {
        _resetPreflightCache()
      }
      return result
    }
  )

  ipcMain.handle('clickup:disconnect', async () => {
    disconnectClickUp()
    _resetPreflightCache()
  })

  ipcMain.handle('clickup:status', async () => getClickUpStatus())

  ipcMain.handle('clickup:testConnection', async () => testClickUpConnection())

  ipcMain.handle('clickup:selectWorkspace', async (_event, args: unknown) => {
    const workspaceId = readId(readArgs(args).workspaceId)
    return workspaceId ? selectClickUpWorkspace(workspaceId) : getClickUpStatus()
  })

  ipcMain.handle('clickup:listTasks', async (_event, args: unknown) => {
    const input = readArgs(args)
    return listClickUpTasks(
      normalizeClickUpTaskFilter(input.filter),
      clampClickUpTaskLimit(input.limit)
    )
  })

  ipcMain.handle('clickup:searchTasks', async (_event, args: unknown) => {
    const input = readArgs(args)
    return typeof input.query === 'string'
      ? searchClickUpTasks(
          input.query,
          normalizeClickUpTaskFilter(input.filter),
          clampClickUpTaskLimit(input.limit)
        )
      : []
  })

  ipcMain.handle('clickup:getTask', async (_event, args: unknown) => {
    const taskId = readId(readArgs(args).taskId)
    return taskId ? getClickUpTask(taskId) : null
  })

  ipcMain.handle('clickup:taskComments', async (_event, args: unknown) => {
    const taskId = readId(readArgs(args).taskId)
    return taskId ? listClickUpTaskComments(taskId) : []
  })

  ipcMain.handle(
    'clickup:updateTaskStatus',
    async (_event, args: unknown): Promise<ClickUpMutationResult> => {
      const input = readArgs(args)
      const taskId = readId(input.taskId)
      const status = readId(input.status)
      return taskId && status
        ? updateClickUpTaskStatus(taskId, status)
        : { ok: false, error: 'Task and status are required.' }
    }
  )

  ipcMain.handle(
    'clickup:addTaskComment',
    async (_event, args: unknown): Promise<ClickUpMutationResult> => {
      const input = readArgs(args)
      const taskId = readId(input.taskId)
      return taskId && typeof input.body === 'string'
        ? addClickUpTaskComment(taskId, input.body)
        : { ok: false, error: 'Task and comment are required.' }
    }
  )

  ipcMain.handle('clickup:listSpaces', async () => listClickUpSpaces())

  ipcMain.handle('clickup:listLists', async (_event, args: unknown) => {
    const spaceId = readId(readArgs(args).spaceId)
    return spaceId ? listClickUpLists(spaceId) : []
  })

  ipcMain.handle('clickup:listStatuses', async (_event, args: unknown) => {
    const listId = readId(readArgs(args).listId)
    return listId ? listClickUpListStatuses(listId) : []
  })
}
