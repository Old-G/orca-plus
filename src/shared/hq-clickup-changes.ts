// Custom build (hq-clickup-triage): step 0 of the ClickUp inbox — what changed in a task the owner is
// on (assignee, watcher or creator) beyond comments, worked out by diffing snapshots, no model.
// Status, assignees, dates, tags and priority are not followed: they are bookkeeping, not requests.

export const HQ_CLICKUP_CHANGES_FILE = 'clickup-changes.json'

/** Edits of one task within this long of each other are one change. */
export const CLICKUP_CHANGE_QUIET_MS = 30 * 60_000
// Why: a task nobody touched for a month is dropped; seeing it again starts a fresh baseline.
const SNAPSHOT_KEEP_MS = 30 * 24 * 60 * 60_000
const TEXT_KEEP = 8_000
const ADDED_MAX = 1_500

export type ClickUpWatchedTask = {
  id: string
  identifier: string
  title: string
  url: string
  listName: string
  creatorId: string | null
  watcherIds: string[]
  assigneeIds: string[]
  createdAt: number
  updatedAt: number
  description: string
  /** Values of the custom fields that are not dates, as one comparable string. */
  fields: string
  /** Attachment ids with who added them; null when the task was not read in full. */
  attachments: { id: string; userId: string | null }[] | null
}

export type ClickUpTaskSnapshot = {
  description: string
  fields: string
  attachmentIds: string[]
  seenAt: number
}

export type ClickUpChangeKind = 'created' | 'description' | 'attachments' | 'fields'

export type ClickUpChangeEvent = {
  taskId: string
  identifier: string
  title: string
  url: string
  listName: string
  kinds: ClickUpChangeKind[]
  /** Lines the description gained, for the triage to read. */
  added: string
  attachmentsAdded: number
  firstAt: number
  lastAt: number
}

export type ClickUpChangesState = {
  lastCheckAt: number | null
  snapshots: Record<string, ClickUpTaskSnapshot>
  pending: ClickUpChangeEvent[]
}

export function involvesOwner(task: ClickUpWatchedTask, ownerId: string): boolean {
  return (
    task.creatorId === ownerId ||
    task.watcherIds.includes(ownerId) ||
    task.assigneeIds.includes(ownerId)
  )
}

function addedLines(before: string, after: string): string {
  const old = new Set(before.split('\n').map((line) => line.trim()))
  const added = after
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !old.has(line))
    .join('\n')
  return added.length > ADDED_MAX ? `${added.slice(0, ADDED_MAX - 1)}…` : added
}

export function snapshotOf(
  task: ClickUpWatchedTask,
  previous: ClickUpTaskSnapshot | undefined,
  now: number
): ClickUpTaskSnapshot {
  return {
    description: task.description.slice(0, TEXT_KEEP),
    fields: task.fields,
    attachmentIds:
      task.attachments?.map((attachment) => attachment.id) ?? previous?.attachmentIds ?? [],
    seenAt: now
  }
}

/** What changed since the snapshot; a task first seen counts only when someone else just created it. */
export function diffClickUpTask(
  previous: ClickUpTaskSnapshot | undefined,
  task: ClickUpWatchedTask,
  ownerId: string,
  since: number
): Pick<ClickUpChangeEvent, 'kinds' | 'added' | 'attachmentsAdded'> {
  if (!previous) {
    const created = task.createdAt > since && task.creatorId !== ownerId
    return created
      ? { kinds: ['created'], added: addedLines('', task.description), attachmentsAdded: 0 }
      : { kinds: [], added: '', attachmentsAdded: 0 }
  }
  const kinds: ClickUpChangeKind[] = []
  let added = ''
  if (task.description.slice(0, TEXT_KEEP) !== previous.description) {
    added = addedLines(previous.description, task.description)
    // Why: a deletion or a reflow adds nothing for anyone to answer.
    if (added) {
      kinds.push('description')
    }
  }
  const known = new Set(previous.attachmentIds)
  const fresh = (task.attachments ?? []).filter(
    (attachment) => !known.has(attachment.id) && attachment.userId !== ownerId
  )
  if (fresh.length > 0) {
    kinds.push('attachments')
  }
  if (task.fields !== previous.fields) {
    kinds.push('fields')
  }
  return { kinds, added, attachmentsAdded: fresh.length }
}

/** Folds a task's new change into the one still settling for that task. */
export function mergeClickUpChange(
  pending: readonly ClickUpChangeEvent[],
  task: ClickUpWatchedTask,
  change: Pick<ClickUpChangeEvent, 'kinds' | 'added' | 'attachmentsAdded'>,
  now: number
): ClickUpChangeEvent[] {
  const current = pending.find((event) => event.taskId === task.id)
  const rest = pending.filter((event) => event.taskId !== task.id)
  const added = [current?.added, change.added].filter(Boolean).join('\n')
  return [
    ...rest,
    {
      taskId: task.id,
      identifier: task.identifier,
      title: task.title,
      url: task.url,
      listName: task.listName,
      kinds: [...new Set([...(current?.kinds ?? []), ...change.kinds])],
      added: added.length > ADDED_MAX ? `${added.slice(0, ADDED_MAX - 1)}…` : added,
      attachmentsAdded: (current?.attachmentsAdded ?? 0) + change.attachmentsAdded,
      firstAt: current?.firstAt ?? now,
      lastAt: now
    }
  ]
}

/** Changes quiet for half an hour are ready for the triage; the rest keep settling. */
export function splitReadyClickUpChanges(
  pending: readonly ClickUpChangeEvent[],
  now: number
): { ready: ClickUpChangeEvent[]; settling: ClickUpChangeEvent[] } {
  const ready = pending.filter((event) => now - event.lastAt >= CLICKUP_CHANGE_QUIET_MS)
  return { ready, settling: pending.filter((event) => !ready.includes(event)) }
}

export function pruneClickUpSnapshots(
  snapshots: Record<string, ClickUpTaskSnapshot>,
  now: number
): Record<string, ClickUpTaskSnapshot> {
  return Object.fromEntries(
    Object.entries(snapshots).filter(([, snapshot]) => now - snapshot.seenAt <= SNAPSHOT_KEEP_MS)
  )
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

const KINDS: ReadonlySet<string> = new Set(['created', 'description', 'attachments', 'fields'])

function isChangeKind(value: unknown): value is ClickUpChangeKind {
  return typeof value === 'string' && KINDS.has(value)
}

function readEvent(value: unknown): ClickUpChangeEvent[] {
  const entry = record(value)
  if (!entry || !str(entry.taskId)) {
    return []
  }
  const kinds = (Array.isArray(entry.kinds) ? entry.kinds : []).filter(isChangeKind)
  return [
    {
      taskId: str(entry.taskId),
      identifier: str(entry.identifier),
      title: str(entry.title),
      url: str(entry.url),
      listName: str(entry.listName),
      kinds,
      added: str(entry.added),
      attachmentsAdded: num(entry.attachmentsAdded),
      firstAt: num(entry.firstAt),
      lastAt: num(entry.lastAt)
    }
  ]
}

export function parseClickUpChangesState(text: string | null): ClickUpChangesState {
  let raw: Record<string, unknown> | null = null
  try {
    raw = record(text ? JSON.parse(text) : null)
  } catch {
    raw = null
  }
  if (!raw) {
    return { lastCheckAt: null, snapshots: {}, pending: [] }
  }
  const snapshots: Record<string, ClickUpTaskSnapshot> = {}
  for (const [id, value] of Object.entries(record(raw.snapshots) ?? {})) {
    const snapshot = record(value)
    if (snapshot) {
      snapshots[id] = {
        description: str(snapshot.description),
        fields: str(snapshot.fields),
        attachmentIds: (Array.isArray(snapshot.attachmentIds) ? snapshot.attachmentIds : []).filter(
          (item: unknown): item is string => typeof item === 'string'
        ),
        seenAt: num(snapshot.seenAt)
      }
    }
  }
  return {
    lastCheckAt: typeof raw.lastCheckAt === 'number' ? raw.lastCheckAt : null,
    snapshots,
    pending: (Array.isArray(raw.pending) ? raw.pending : []).flatMap(readEvent)
  }
}
