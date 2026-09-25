import type {
  ClickUpComment,
  ClickUpList,
  ClickUpPriority,
  ClickUpSpace,
  ClickUpStatus,
  ClickUpStatusType,
  ClickUpTask,
  ClickUpTaskSummary,
  ClickUpUser,
  ClickUpViewer,
  ClickUpWorkspace
} from '../../shared/clickup-types'

export function asClickUpRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(Object.entries(value))
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

// Why: ClickUp returns ids as numbers in some payloads and strings in others.
function asId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

// Why: timestamps arrive as millisecond strings ("1790271004674").
function asTimestamp(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const STATUS_TYPES: readonly ClickUpStatusType[] = ['open', 'custom', 'done', 'closed']

function toStatusType(value: unknown): ClickUpStatusType {
  return STATUS_TYPES.find((type) => type === value) ?? 'custom'
}

export function mapClickUpStatus(value: unknown): ClickUpStatus {
  const raw = asClickUpRecord(value)
  const orderIndex = Number(raw.orderindex)
  return {
    name: asText(raw.status) ?? '',
    color: asText(raw.color),
    type: toStatusType(raw.type),
    orderIndex: Number.isFinite(orderIndex) ? orderIndex : 0
  }
}

export function mapClickUpUser(value: unknown): ClickUpUser | null {
  const raw = asClickUpRecord(value)
  const id = asId(raw.id)
  if (!id) {
    return null
  }
  return {
    id,
    username: asText(raw.username) ?? asText(raw.email) ?? id,
    initials: asText(raw.initials),
    color: asText(raw.color)
  }
}

function mapPriority(value: unknown): ClickUpPriority | null {
  const raw = asClickUpRecord(value)
  const label = asText(raw.priority)
  return label ? { label, color: asText(raw.color) } : null
}

export function mapClickUpTaskSummary(value: unknown): ClickUpTaskSummary | null {
  const raw = asClickUpRecord(value)
  const id = asId(raw.id)
  const title = asText(raw.name)
  if (!id || !title) {
    return null
  }
  const customId = asText(raw.custom_id)
  const list = asClickUpRecord(raw.list)
  const space = asClickUpRecord(raw.space)
  return {
    id,
    customId,
    identifier: customId ?? id,
    title: title.trim(),
    url: asText(raw.url) ?? `https://app.clickup.com/t/${id}`,
    status: mapClickUpStatus(raw.status),
    priority: mapPriority(raw.priority),
    assignees: asArray(raw.assignees).flatMap((entry) => mapClickUpUser(entry) ?? []),
    dueDate: asTimestamp(raw.due_date),
    updatedAt: asTimestamp(raw.date_updated),
    listId: asId(list.id),
    listName: asText(list.name),
    spaceId: asId(space.id),
    workspaceId: asId(raw.team_id)
  }
}

export function mapClickUpTask(value: unknown): ClickUpTask | null {
  const summary = mapClickUpTaskSummary(value)
  if (!summary) {
    return null
  }
  const raw = asClickUpRecord(value)
  return {
    ...summary,
    description:
      asText(raw.markdown_description) ?? asText(raw.text_content) ?? asText(raw.description) ?? '',
    tags: asArray(raw.tags).flatMap((tag) => asText(asClickUpRecord(tag).name) ?? []),
    creator: mapClickUpUser(raw.creator),
    createdAt: asTimestamp(raw.date_created)
  }
}

export function mapClickUpTasks(value: unknown): {
  tasks: ClickUpTaskSummary[]
  lastPage: boolean
} {
  const raw = asClickUpRecord(value)
  const entries = asArray(raw.tasks)
  return {
    tasks: entries.flatMap((entry) => mapClickUpTaskSummary(entry) ?? []),
    // Why: older responses omit last_page; then a short page marks the end.
    lastPage: typeof raw.last_page === 'boolean' ? raw.last_page : entries.length < 100
  }
}

export function mapClickUpComments(value: unknown): ClickUpComment[] {
  return asArray(asClickUpRecord(value).comments).flatMap((entry) => {
    const raw = asClickUpRecord(entry)
    const id = asId(raw.id)
    if (!id) {
      return []
    }
    return [
      {
        id,
        body: typeof raw.comment_text === 'string' ? raw.comment_text : '',
        author: mapClickUpUser(raw.user),
        createdAt: asTimestamp(raw.date)
      }
    ]
  })
}

export function mapClickUpViewer(value: unknown): ClickUpViewer | null {
  const raw = asClickUpRecord(asClickUpRecord(value).user)
  const id = asId(raw.id)
  if (!id) {
    return null
  }
  return { id, username: asText(raw.username) ?? id, email: asText(raw.email) }
}

export function mapClickUpWorkspaces(value: unknown): ClickUpWorkspace[] {
  return asArray(asClickUpRecord(value).teams).flatMap((entry) => {
    const raw = asClickUpRecord(entry)
    const id = asId(raw.id)
    return id ? [{ id, name: asText(raw.name) ?? id }] : []
  })
}

export function mapClickUpSpaces(value: unknown): ClickUpSpace[] {
  return asArray(asClickUpRecord(value).spaces).flatMap((entry) => {
    const raw = asClickUpRecord(entry)
    const id = asId(raw.id)
    return id ? [{ id, name: asText(raw.name) ?? id }] : []
  })
}

function mapLists(entries: unknown, folderName: string | null): ClickUpList[] {
  return asArray(entries).flatMap((entry) => {
    const raw = asClickUpRecord(entry)
    const id = asId(raw.id)
    return id ? [{ id, name: asText(raw.name) ?? id, folderName }] : []
  })
}

export function mapClickUpFolderLists(value: unknown): ClickUpList[] {
  return asArray(asClickUpRecord(value).folders).flatMap((entry) => {
    const folder = asClickUpRecord(entry)
    return mapLists(folder.lists, asText(folder.name))
  })
}

export function mapClickUpFolderlessLists(value: unknown): ClickUpList[] {
  return mapLists(asClickUpRecord(value).lists, null)
}

export function mapClickUpListStatuses(value: unknown): ClickUpStatus[] {
  return asArray(asClickUpRecord(value).statuses)
    .map(mapClickUpStatus)
    .filter((status) => status.name)
    .sort((a, b) => a.orderIndex - b.orderIndex)
}
