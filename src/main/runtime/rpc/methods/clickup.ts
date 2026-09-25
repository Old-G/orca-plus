import { defineMethod } from '../core'
import {
  Connect,
  ListRef,
  ListTasks,
  SearchTasks,
  SelectWorkspace,
  SpaceRef,
  TaskComment,
  TaskRef,
  TaskStatusUpdate
} from '../../../../shared/rpc-contract/clickup-params'

export const CLICKUP_METHODS = [
  defineMethod({
    name: 'clickup.connect',
    params: Connect,
    handler: async (params, { runtime }) => runtime.clickupConnect(params.apiToken.trim())
  }),
  defineMethod({
    name: 'clickup.disconnect',
    params: null,
    handler: async (_params, { runtime }) => runtime.clickupDisconnect()
  }),
  defineMethod({
    name: 'clickup.status',
    params: null,
    handler: async (_params, { runtime }) => runtime.clickupStatus()
  }),
  defineMethod({
    name: 'clickup.testConnection',
    params: null,
    handler: async (_params, { runtime }) => runtime.clickupTestConnection()
  }),
  defineMethod({
    name: 'clickup.selectWorkspace',
    params: SelectWorkspace,
    handler: async (params, { runtime }) =>
      runtime.clickupSelectWorkspace(params.workspaceId.trim())
  }),
  defineMethod({
    name: 'clickup.listTasks',
    params: ListTasks,
    handler: async (params, { runtime }) => runtime.clickupListTasks(params?.filter, params?.limit)
  }),
  defineMethod({
    name: 'clickup.searchTasks',
    params: SearchTasks,
    handler: async (params, { runtime, signal }) =>
      runtime.clickupSearchTasks(params.query, params.filter, params.limit, signal)
  }),
  defineMethod({
    name: 'clickup.getTask',
    params: TaskRef,
    handler: async (params, { runtime }) => runtime.clickupGetTask(params.taskId.trim())
  }),
  defineMethod({
    name: 'clickup.taskComments',
    params: TaskRef,
    handler: async (params, { runtime }) => runtime.clickupTaskComments(params.taskId.trim())
  }),
  defineMethod({
    name: 'clickup.updateTaskStatus',
    params: TaskStatusUpdate,
    handler: async (params, { runtime }) =>
      runtime.clickupUpdateTaskStatus(params.taskId.trim(), params.status)
  }),
  defineMethod({
    name: 'clickup.addTaskComment',
    params: TaskComment,
    handler: async (params, { runtime }) =>
      runtime.clickupAddTaskComment(params.taskId.trim(), params.body)
  }),
  defineMethod({
    name: 'clickup.listSpaces',
    params: null,
    handler: async (_params, { runtime }) => runtime.clickupListSpaces()
  }),
  defineMethod({
    name: 'clickup.listLists',
    params: SpaceRef,
    handler: async (params, { runtime }) => runtime.clickupListLists(params.spaceId.trim())
  }),
  defineMethod({
    name: 'clickup.listStatuses',
    params: ListRef,
    handler: async (params, { runtime }) => runtime.clickupListStatuses(params.listId.trim())
  })
]
