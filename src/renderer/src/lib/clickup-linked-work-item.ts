import type {
  ClickUpTask,
  ClickUpTaskSummary,
  ClickUpWorkspace
} from '../../../shared/clickup-types'
import type { ExecutionHostId } from '../../../shared/execution-host'
import {
  normalizeTaskSourceContext,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import {
  getLinkedWorkItemSuggestedName,
  getLinkedWorkItemWorkspaceName
} from '../../../shared/workspace-name'
import type { LinkedWorkItemContext } from './linked-work-item-context'
import type { LinkedWorkItemSummary } from './new-workspace'

export function buildClickUpLinkedWorkItem(
  task: ClickUpTaskSummary,
  full?: ClickUpTask | null
): LinkedWorkItemSummary {
  return {
    ...(full ? { linkedContext: buildClickUpLinkedContext(full) } : {}),
    type: 'issue',
    provider: 'clickup',
    // Why: ClickUp ids are strings; numeric issue metadata stays empty like Jira/Linear.
    number: 0,
    title: `${task.identifier} ${task.title}`,
    url: task.url,
    clickupIdentifier: task.identifier
  }
}

export function getClickUpTaskWorkspaceSeed(task: ClickUpTaskSummary): string {
  return (
    getLinkedWorkItemWorkspaceName({
      type: 'issue',
      provider: 'clickup',
      number: 0,
      title: `${task.identifier} ${task.title}`,
      clickupIdentifier: task.identifier
    })?.seedName ?? getLinkedWorkItemSuggestedName(task)
  )
}

export function buildClickUpTaskSourceContext(args: {
  projectId: string
  hostId: ExecutionHostId
  workspace: ClickUpWorkspace | null
}): TaskSourceContext | null {
  return normalizeTaskSourceContext({
    provider: 'clickup',
    projectId: args.projectId,
    hostId: args.hostId,
    providerIdentity: {
      provider: 'clickup',
      workspaceId: args.workspace?.id ?? null,
      workspaceName: args.workspace?.name ?? null
    },
    accountLabel: args.workspace?.name ?? null
  })
}

/** Task prose for the agent prompt; the composer wraps it as untrusted source data. */
export function buildClickUpLinkedContext(task: ClickUpTask): LinkedWorkItemContext {
  const facts = [
    `Status: ${task.status.name}`,
    task.listName ? `List: ${task.listName}` : null,
    task.assignees.length > 0
      ? `Assignees: ${task.assignees.map((assignee) => assignee.username).join(', ')}`
      : null
  ].filter((line): line is string => line !== null)
  return {
    provider: 'clickup',
    version: 1,
    renderedText: [
      `ClickUp task ${task.identifier}: ${task.title}`,
      facts.join(' · '),
      '',
      task.description.trim()
    ]
      .join('\n')
      .trim()
  }
}
