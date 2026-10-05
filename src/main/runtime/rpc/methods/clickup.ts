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
  TaskStatusUpdate,
  TaskTimeEstimateUpdate
} from '../../../../shared/rpc-contract/clickup-params'

export const CLICKUP_METHODS = [
  defineMethod({
    name: 'clickup.connect',

    permission: 'accounts-admin',
    params: Connect,
    handler: async (params, { runtime }) => runtime.clickupConnect(params.apiToken.trim())
  }),
  defineMethod({
    name: 'clickup.disconnect',

    permission: 'accounts-admin',
    params: null,
    handler: async (_params, { runtime }) => runtime.clickupDisconnect()
  }),
  defineMethod({
    name: 'clickup.status',

    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => runtime.clickupStatus()
  }),
  defineMethod({
    name: 'clickup.testConnection',

    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => runtime.clickupTestConnection()
  }),
  defineMethod({
    name: 'clickup.selectWorkspace',

    permission: 'accounts-admin',
    params: SelectWorkspace,
    handler: async (params, { runtime }) =>
      runtime.clickupSelectWorkspace(params.workspaceId.trim())
  }),
  defineMethod({
    name: 'clickup.listTasks',

    permission: 'workspace',
    params: ListTasks,
    handler: async (params, { runtime }) => runtime.clickupListTasks(params?.filter, params?.limit)
  }),
  defineMethod({
    name: 'clickup.searchTasks',

    permission: 'workspace',
    params: SearchTasks,
    handler: async (params, { runtime, signal }) =>
      runtime.clickupSearchTasks(params.query, params.filter, params.limit, signal)
  }),
  defineMethod({
    name: 'clickup.getTask',

    permission: 'workspace',
    params: TaskRef,
    handler: async (params, { runtime }) => runtime.clickupGetTask(params.taskId.trim())
  }),
  defineMethod({
    name: 'clickup.taskComments',

    permission: 'workspace',
    params: TaskRef,
    handler: async (params, { runtime }) => runtime.clickupTaskComments(params.taskId.trim())
  }),
  defineMethod({
    name: 'clickup.updateTaskStatus',

    permission: 'workspace',
    params: TaskStatusUpdate,
    handler: async (params, { runtime }) =>
      runtime.clickupUpdateTaskStatus(params.taskId.trim(), params.status)
  }),
  defineMethod({
    name: 'clickup.updateTaskTimeEstimate',

    permission: 'workspace',
    params: TaskTimeEstimateUpdate,
    handler: async (params, { runtime }) =>
      runtime.clickupUpdateTaskTimeEstimate(params.taskId.trim(), params.hours)
  }),
  defineMethod({
    name: 'clickup.addTaskComment',

    permission: 'workspace',
    params: TaskComment,
    handler: async (params, { runtime }) =>
      runtime.clickupAddTaskComment(params.taskId.trim(), params.body)
  }),
  defineMethod({
    name: 'clickup.listSpaces',

    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => runtime.clickupListSpaces()
  }),
  defineMethod({
    name: 'clickup.listLists',

    permission: 'workspace',
    params: SpaceRef,
    handler: async (params, { runtime }) => runtime.clickupListLists(params.spaceId.trim())
  }),
  defineMethod({
    name: 'clickup.listStatuses',

    permission: 'workspace',
    params: ListRef,
    handler: async (params, { runtime }) => runtime.clickupListStatuses(params.listId.trim())
  })
]
