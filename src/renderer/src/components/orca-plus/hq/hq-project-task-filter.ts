// Custom build (hq): how a project card filters its ClickUp tasks — whose (asked of ClickUp) and
// which statuses (applied to what came back), remembered per project in this browser only.
import type {
  ClickUpStatus,
  ClickUpTaskScope,
  ClickUpTaskSummary
} from '../../../../../shared/clickup-types'

export type HqTaskFilter = {
  scope: ClickUpTaskScope
  /** Status names to show; empty shows every status. */
  statuses: string[]
}

export type HqStatusOption = { status: ClickUpStatus; count: number }

const STORAGE_KEY = 'orca-plus.hq.project-task-filter'
const DEFAULT_FILTER: HqTaskFilter = { scope: 'mine', statuses: [] }

function statusKey(name: string): string {
  return name.trim().toLocaleLowerCase()
}

/** Statuses present in the loaded tasks, in the list's own order. */
export function hqStatusOptions(tasks: readonly ClickUpTaskSummary[]): HqStatusOption[] {
  const byKey = new Map<string, HqStatusOption>()
  for (const task of tasks) {
    const key = statusKey(task.status.name)
    const option = byKey.get(key)
    byKey.set(key, { status: option?.status ?? task.status, count: (option?.count ?? 0) + 1 })
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.status.orderIndex - b.status.orderIndex || a.status.name.localeCompare(b.status.name)
  )
}

/** A chosen status no task carries any more is ignored, so a stale choice never empties the list. */
export function filterHqTasks(
  tasks: readonly ClickUpTaskSummary[],
  statuses: readonly string[]
): ClickUpTaskSummary[] {
  const present = new Set(tasks.map((task) => statusKey(task.status.name)))
  const wanted = new Set(statuses.map(statusKey).filter((key) => present.has(key)))
  return wanted.size === 0
    ? [...tasks]
    : tasks.filter((task) => wanted.has(statusKey(task.status.name)))
}

export function toggleHqStatus(statuses: readonly string[], name: string): string[] {
  const key = statusKey(name)
  return statuses.some((entry) => statusKey(entry) === key)
    ? statuses.filter((entry) => statusKey(entry) !== key)
    : [...statuses, name]
}

function readAll(): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    return typeof raw === 'object' && raw !== null ? Object.fromEntries(Object.entries(raw)) : {}
  } catch {
    return {}
  }
}

export function readHqTaskFilter(repoId: string): HqTaskFilter {
  const stored: unknown = readAll()[repoId]
  if (typeof stored !== 'object' || stored === null) {
    return DEFAULT_FILTER
  }
  const scope: unknown = Reflect.get(stored, 'scope')
  const statuses: unknown = Reflect.get(stored, 'statuses')
  return {
    scope: scope === 'all' ? 'all' : 'mine',
    statuses: Array.isArray(statuses)
      ? statuses.filter((entry): entry is string => typeof entry === 'string')
      : []
  }
}

export function writeHqTaskFilter(repoId: string, filter: HqTaskFilter): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [repoId]: filter }))
  } catch {
    // Why: the filter is a convenience; blocked storage must not break the card.
  }
}
