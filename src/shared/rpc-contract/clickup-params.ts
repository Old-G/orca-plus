import { z } from 'zod'
import { OptionalFiniteNumber, requiredString } from './rpc-param-primitives'

// Why: normalizeClickUpTaskFilter narrows the payload on the host, so the
// schema only rejects non-object filters instead of re-validating each field.
const TaskFilter = z.record(z.string(), z.unknown()).optional()

export const Connect = z.object({
  apiToken: requiredString('Personal API token is required')
})

export const SelectWorkspace = z.object({
  workspaceId: requiredString('Workspace is required')
})

export const ListTasks = z
  .object({
    filter: TaskFilter,
    limit: OptionalFiniteNumber
  })
  .optional()

export const SearchTasks = z.object({
  query: z.string(),
  filter: TaskFilter,
  limit: OptionalFiniteNumber
})

export const TaskRef = z.object({
  taskId: requiredString('Task is required')
})

export const TaskStatusUpdate = z.object({
  taskId: requiredString('Task is required'),
  status: requiredString('Status is required')
})

export const TaskComment = z.object({
  taskId: requiredString('Task is required'),
  body: requiredString('Comment body is required')
})

export const SpaceRef = z.object({
  spaceId: requiredString('Space is required')
})

export const ListRef = z.object({
  listId: requiredString('List is required')
})
