import {
  isClickUpStatusDone,
  type ClickUpComment,
  type ClickUpList,
  type ClickUpMutationResult,
  type ClickUpSpace,
  type ClickUpStatus,
  type ClickUpTask,
  type ClickUpTaskFilter,
  type ClickUpTaskSummary
} from '../../shared/clickup-types'
import { parseClickUpTaskReference } from '../../shared/clickup-task-reference'
import { withClickUpSession, type ClickUpSession } from './clickup-client'
import { ClickUpApiError, clickUpRequest, isClickUpAccessDenied } from './clickup-request'
import {
  mapClickUpComments,
  mapClickUpFolderLists,
  mapClickUpFolderlessLists,
  mapClickUpListStatuses,
  mapClickUpSpaces,
  mapClickUpTask,
  mapClickUpTasks
} from './clickup-task-mapping'

// Why: the filtered-team-tasks endpoint pages at 100 and has no text search, so
// list/search reads walk a bounded number of recently updated pages.
const MAX_LIST_PAGES = 5

function buildTeamTaskQuery(
  session: ClickUpSession,
  filter: ClickUpTaskFilter,
  page: number
): string {
  const params = new URLSearchParams({
    page: String(page),
    order_by: 'updated',
    subtasks: 'true',
    include_closed: filter.includeDone ? 'true' : 'false'
  })
  if (filter.scope === 'mine') {
    params.append('assignees[]', session.viewer.id)
  }
  if (filter.spaceId) {
    params.append('space_ids[]', filter.spaceId)
  }
  if (filter.listId) {
    params.append('list_ids[]', filter.listId)
  }
  return `/team/${encodeURIComponent(session.workspaceId)}/task?${params.toString()}`
}

async function collectTasks(
  session: ClickUpSession,
  filter: ClickUpTaskFilter,
  limit: number,
  matches: (task: ClickUpTaskSummary) => boolean,
  signal?: AbortSignal
): Promise<ClickUpTaskSummary[]> {
  const collected: ClickUpTaskSummary[] = []
  for (let page = 0; page < MAX_LIST_PAGES && collected.length < limit; page += 1) {
    const { tasks, lastPage } = mapClickUpTasks(
      await clickUpRequest(session.token, buildTeamTaskQuery(session, filter, page), { signal })
    )
    for (const task of tasks) {
      // Why: include_closed only drops `closed`; `done` statuses (e.g. "check")
      // still come back and are not open work.
      if ((filter.includeDone || !isClickUpStatusDone(task.status)) && matches(task)) {
        collected.push(task)
      }
    }
    if (lastPage) {
      break
    }
  }
  return collected.slice(0, limit)
}

export function listClickUpTasks(
  filter: ClickUpTaskFilter,
  limit = 50
): Promise<ClickUpTaskSummary[]> {
  return withClickUpSession((session) => collectTasks(session, filter, limit, () => true))
}

function taskPath(session: ClickUpSession, reference: { id: string; custom: boolean }): string {
  const params = new URLSearchParams({ include_markdown_description: 'true' })
  if (reference.custom) {
    params.set('custom_task_ids', 'true')
    params.set('team_id', session.workspaceId)
  }
  return `/task/${encodeURIComponent(reference.id)}?${params.toString()}`
}

async function readTask(
  session: ClickUpSession,
  reference: { id: string; custom: boolean },
  signal?: AbortSignal
): Promise<ClickUpTask | null> {
  const task = mapClickUpTask(
    await clickUpRequest(session.token, taskPath(session, reference), { signal })
  )
  return task ? { ...task, workspaceId: task.workspaceId ?? session.workspaceId } : null
}

function isNotFound(error: unknown): boolean {
  return (
    (error instanceof ClickUpApiError && (error.status === 404 || error.status === 400)) ||
    isClickUpAccessDenied(error)
  )
}

/** Accepts a task URL, custom id (DEV-123) or task id; anything else is matched by title. */
export function searchClickUpTasks(
  query: string,
  filter: ClickUpTaskFilter,
  limit = 50,
  signal?: AbortSignal
): Promise<ClickUpTaskSummary[]> {
  return withClickUpSession(async (session) => {
    const reference = parseClickUpTaskReference(query)
    if (reference) {
      try {
        const task = await readTask(session, reference, signal)
        if (task) {
          return [task]
        }
      } catch (error) {
        // Why: an id-shaped word that is not a task falls back to title search.
        if (!isNotFound(error)) {
          throw error
        }
      }
    }
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) {
      return collectTasks(session, filter, limit, () => true, signal)
    }
    return collectTasks(
      session,
      filter,
      limit,
      (task) =>
        task.title.toLocaleLowerCase().includes(needle) ||
        task.identifier.toLocaleLowerCase().includes(needle),
      signal
    )
  })
}

export function getClickUpTask(taskRef: string): Promise<ClickUpTask | null> {
  return withClickUpSession((session) => {
    const reference = parseClickUpTaskReference(taskRef) ?? { id: taskRef.trim(), custom: false }
    return readTask(session, reference)
  })
}

export function listClickUpTaskComments(taskId: string): Promise<ClickUpComment[]> {
  return withClickUpSession(async (session) =>
    mapClickUpComments(
      await clickUpRequest(session.token, `/task/${encodeURIComponent(taskId)}/comment`)
    ).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  )
}

async function mutate(
  run: (session: ClickUpSession) => Promise<unknown>
): Promise<ClickUpMutationResult> {
  try {
    await withClickUpSession(run)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.message ? error.message : 'ClickUp update failed.'
    }
  }
}

export function updateClickUpTaskStatus(
  taskId: string,
  status: string
): Promise<ClickUpMutationResult> {
  return mutate((session) =>
    clickUpRequest(session.token, `/task/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    })
  )
}

export function addClickUpTaskComment(
  taskId: string,
  body: string
): Promise<ClickUpMutationResult> {
  const text = body.trim()
  if (!text) {
    return Promise.resolve({ ok: false, error: 'Comment is empty.' })
  }
  return mutate((session) =>
    clickUpRequest(session.token, `/task/${encodeURIComponent(taskId)}/comment`, {
      method: 'POST',
      // Why: posting from Orca should not page every watcher of the task.
      body: JSON.stringify({ comment_text: text, notify_all: false })
    })
  )
}

export function listClickUpSpaces(): Promise<ClickUpSpace[]> {
  return withClickUpSession(async (session) =>
    mapClickUpSpaces(
      await clickUpRequest(
        session.token,
        `/team/${encodeURIComponent(session.workspaceId)}/space?archived=false`
      )
    )
  )
}

export function listClickUpLists(spaceId: string): Promise<ClickUpList[]> {
  return withClickUpSession(async (session) => {
    const space = encodeURIComponent(spaceId)
    const [folders, folderless] = await Promise.all([
      clickUpRequest(session.token, `/space/${space}/folder?archived=false`),
      clickUpRequest(session.token, `/space/${space}/list?archived=false`)
    ])
    return [...mapClickUpFolderlessLists(folderless), ...mapClickUpFolderLists(folders)]
  })
}

export function listClickUpListStatuses(listId: string): Promise<ClickUpStatus[]> {
  return withClickUpSession(async (session) =>
    mapClickUpListStatuses(
      await clickUpRequest(session.token, `/list/${encodeURIComponent(listId)}`)
    )
  )
}
