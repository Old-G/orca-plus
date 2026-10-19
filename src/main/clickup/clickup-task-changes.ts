// Custom build (hq-clickup-triage): the workspace tasks updated since a time, in the shape the change
// diff reads. The list endpoint has no attachments, so a task the owner is on is read in full for them.
import { involvesOwner, type ClickUpWatchedTask } from '../../shared/hq-clickup-changes'
import { withClickUpSession, type ClickUpSession } from './clickup-client'
import { clickUpRequest } from './clickup-request'

// Why: 10 pages of 100 cover a busy workspace's ten minutes many times over.
const MAX_PAGES = 10

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function idOf(value: unknown): string | null {
  const id = record(value).id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}

function ids(value: unknown): string[] {
  return list(value).flatMap((entry) => idOf(entry) ?? [])
}

function millis(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Non-date custom field values, sorted by id, so a reorder is not a change. */
function fieldsKey(value: unknown): string {
  return JSON.stringify(
    list(value)
      .map(record)
      .filter((field) => field.type !== 'date' && field.value !== undefined && field.value !== null)
      .map((field) => [String(field.id ?? ''), field.value])
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
  )
}

export function mapClickUpWatchedTask(raw: unknown): ClickUpWatchedTask | null {
  const task = record(raw)
  const id = typeof task.id === 'string' ? task.id : null
  if (!id) {
    return null
  }
  const text = typeof task.text_content === 'string' ? task.text_content : ''
  return {
    id,
    identifier: typeof task.custom_id === 'string' && task.custom_id ? task.custom_id : id,
    title: typeof task.name === 'string' ? task.name : '',
    url: typeof task.url === 'string' ? task.url : `https://app.clickup.com/t/${id}`,
    listName: String(record(task.list).name ?? ''),
    creatorId: idOf(task.creator),
    watcherIds: ids(task.watchers),
    assigneeIds: ids(task.assignees),
    createdAt: millis(task.date_created),
    updatedAt: millis(task.date_updated),
    description: text,
    fields: fieldsKey(task.custom_fields),
    attachments: Array.isArray(task.attachments)
      ? task.attachments.map(record).flatMap((attachment) => {
          const attachmentId = idOf(attachment)
          return attachmentId ? [{ id: attachmentId, userId: idOf(attachment.user) }] : []
        })
      : null
  }
}

async function updatedPage(session: ClickUpSession, since: number, page: number) {
  const params = new URLSearchParams({
    page: String(page),
    order_by: 'updated',
    subtasks: 'true',
    date_updated_gt: String(since)
  })
  const body = record(
    await clickUpRequest(
      session.token,
      `/team/${encodeURIComponent(session.workspaceId)}/task?${params.toString()}`
    )
  )
  return { tasks: list(body.tasks), last: body.last_page !== false }
}

/** Open tasks the owner is on that changed after `since`, read in full; and who the owner is. */
export function listClickUpOwnerTasksUpdatedSince(
  since: number
): Promise<{ ownerId: string; tasks: ClickUpWatchedTask[] }> {
  return withClickUpSession(async (session) => {
    const ownerId = session.viewer.id
    const found: ClickUpWatchedTask[] = []
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { tasks, last } = await updatedPage(session, since, page)
      for (const raw of tasks) {
        const task = mapClickUpWatchedTask(raw)
        if (task && involvesOwner(task, ownerId)) {
          found.push(task)
        }
      }
      if (last) {
        break
      }
    }
    const full = await Promise.all(
      found.map(async (task) => {
        const read = mapClickUpWatchedTask(
          await clickUpRequest(session.token, `/task/${encodeURIComponent(task.id)}`)
        )
        return read ?? task
      })
    )
    return { ownerId, tasks: full }
  })
}
