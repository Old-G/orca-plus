// Custom build (hq-triage): «Take» on an HQ «New tasks» row — start Claude in a fresh worktree of the
// chosen project (or a coordinator for several), then move the ClickUp task to «in process» and
// remember the decision.
import type {
  ClickUpMutationResult,
  ClickUpStatus,
  ClickUpTask,
  ClickUpTaskSummary
} from '../../../../../shared/clickup-types'
import type { HqAutonomyLevel } from '../../../../../shared/hq-autonomy'
import {
  findInProcessStatus,
  hqCoordinatorPrompt,
  hqTriagePrompt
} from '../../../../../shared/hq-triage'
import { buildClickUpLinkedWorkItem } from '@/lib/clickup-linked-work-item'
import type { LaunchableWorkItem } from '@/lib/launch-work-item-direct-types'
import { buildContainedLinkedContextBlock } from '@/lib/linked-work-item-context'

export type HqTriageTakeDeps = {
  getTask: (taskId: string) => Promise<ClickUpTask | null>
  launch: (item: LaunchableWorkItem) => Promise<boolean>
  listStatuses: (listId: string) => Promise<ClickUpStatus[]>
  setStatus: (taskId: string, status: string) => Promise<ClickUpMutationResult>
  remember: () => Promise<unknown>
}

export type HqTriageStatusOutcome =
  | { kind: 'set' }
  /** The task's list has no «in process» status to move it to. */
  | { kind: 'missing' }
  | { kind: 'failed'; message: string }

export type HqTriageTakeResult =
  | { launched: false }
  | { launched: true; status: HqTriageStatusOutcome }

function withTaskData(
  task: ClickUpTaskSummary,
  full: ClickUpTask | null,
  prompt: string
): LaunchableWorkItem {
  // Why: the title must reach the agent only inside the untrusted block, even without the full task.
  const item = buildClickUpLinkedWorkItem(
    task,
    full ?? { ...task, description: '', tags: [], creator: null, createdAt: null }
  )
  const context = buildContainedLinkedContextBlock(item.linkedContext)
  return { ...item, pasteContent: context ? `${prompt}\n\n${context}` : prompt }
}

export function buildHqTriageWorkItem(
  task: ClickUpTaskSummary,
  full: ClickUpTask | null,
  project: { name: string; level: HqAutonomyLevel }
): LaunchableWorkItem {
  return withTaskData(
    task,
    full,
    hqTriagePrompt({
      identifier: task.identifier,
      url: task.url,
      projectName: project.name,
      level: project.level
    })
  )
}

/** Custom build (hq-triage): the coordinator of a task that spans several projects. */
export function buildHqCoordinatorWorkItem(
  task: ClickUpTaskSummary,
  full: ClickUpTask | null,
  coordinator: {
    projects: readonly { name: string; path: string; level: HqAutonomyLevel }[]
    model: string
    effort: string
  }
): LaunchableWorkItem {
  return withTaskData(
    task,
    full,
    hqCoordinatorPrompt({ identifier: task.identifier, url: task.url, ...coordinator })
  )
}

export async function takeHqTriageTask(
  task: ClickUpTaskSummary,
  buildItem: (full: ClickUpTask | null) => LaunchableWorkItem,
  deps: HqTriageTakeDeps
): Promise<HqTriageTakeResult> {
  // Why: the agent's prompt carries the task text, so the row's summary is not enough.
  const full = await deps.getTask(task.id).catch(() => null)
  if (!(await deps.launch(buildItem(full)))) {
    return { launched: false }
  }
  await deps.remember()
  return { launched: true, status: await moveToInProcess(task, deps) }
}

async function moveToInProcess(
  task: ClickUpTaskSummary,
  deps: HqTriageTakeDeps
): Promise<HqTriageStatusOutcome> {
  if (!task.listId) {
    return { kind: 'missing' }
  }
  try {
    const status = findInProcessStatus(await deps.listStatuses(task.listId))
    if (!status) {
      return { kind: 'missing' }
    }
    const result = await deps.setStatus(task.id, status.name)
    return result.ok ? { kind: 'set' } : { kind: 'failed', message: result.error }
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}
