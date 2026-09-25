export type ClickUpViewer = {
  id: string
  username: string
  email: string | null
}

export type ClickUpWorkspace = {
  id: string
  name: string
}

export type ClickUpConnectionStatus = {
  connected: boolean
  viewer: ClickUpViewer | null
  workspaces: ClickUpWorkspace[]
  selectedWorkspaceId: string | null
  credentialError?: string
}

export type ClickUpConnectResult =
  | { ok: true; viewer: ClickUpViewer }
  | { ok: false; error: string }

export type ClickUpMutationResult = { ok: true } | { ok: false; error: string }

/**
 * ClickUp status types: `open` (first column), `custom` (in progress), `done`
 * and `closed`. Names are free text (and can mix scripts), so logic keys on type.
 */
export type ClickUpStatusType = 'open' | 'custom' | 'done' | 'closed'

export type ClickUpStatus = {
  name: string
  color: string | null
  type: ClickUpStatusType
  orderIndex: number
}

export type ClickUpUser = {
  id: string
  username: string
  initials: string | null
  color: string | null
}

export type ClickUpPriority = {
  label: string
  color: string | null
}

export type ClickUpTaskSummary = {
  id: string
  customId: string | null
  /** Custom id (e.g. DEV-123) when the workspace uses them, else the task id. */
  identifier: string
  title: string
  url: string
  status: ClickUpStatus
  priority: ClickUpPriority | null
  assignees: ClickUpUser[]
  dueDate: number | null
  updatedAt: number | null
  listId: string | null
  listName: string | null
  spaceId: string | null
  workspaceId: string | null
}

export type ClickUpTask = ClickUpTaskSummary & {
  description: string
  tags: string[]
  creator: ClickUpUser | null
  createdAt: number | null
}

export type ClickUpComment = {
  id: string
  body: string
  author: ClickUpUser | null
  createdAt: number | null
}

export type ClickUpSpace = {
  id: string
  name: string
}

export type ClickUpList = {
  id: string
  name: string
  folderName: string | null
}

export type ClickUpTaskScope = 'mine' | 'all'

export type ClickUpTaskFilter = {
  scope: ClickUpTaskScope
  /** Include tasks whose status type is `done` or `closed`. */
  includeDone?: boolean
  spaceId?: string
  listId?: string
}

export function isClickUpStatusDone(status: Pick<ClickUpStatus, 'type'>): boolean {
  return status.type === 'done' || status.type === 'closed'
}

function optionalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Narrows an untrusted IPC/RPC payload; unknown input means "my open tasks". */
export function normalizeClickUpTaskFilter(value: unknown): ClickUpTaskFilter {
  if (!value || typeof value !== 'object') {
    return { scope: 'mine' }
  }
  const raw = Object.fromEntries(Object.entries(value))
  const spaceId = optionalId(raw.spaceId)
  const listId = optionalId(raw.listId)
  return {
    scope: raw.scope === 'all' ? 'all' : 'mine',
    ...(raw.includeDone === true ? { includeDone: true } : {}),
    ...(spaceId ? { spaceId } : {}),
    ...(listId ? { listId } : {})
  }
}

export function clampClickUpTaskLimit(value: unknown, fallback = 50): number {
  const limit = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(Math.max(1, limit), 200)
}
