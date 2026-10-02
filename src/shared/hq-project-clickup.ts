// Custom build (hq): which ClickUp list holds each project's tasks, keyed by Orca repo id and kept in
// Orca+ settings — HQ's own pages are rewritten by its sync, so the link cannot live there.
export type HqClickUpListBinding = {
  listId: string
  /** `Folder / List` as ClickUp shows it, kept so the card can name the list before it loads. */
  listName: string
  spaceId: string
}

export type HqProjectClickUpLists = Record<string, HqClickUpListBinding>

function text(record: object, key: string): string | null {
  const value: unknown = Reflect.get(record, key)
  return typeof value === 'string' && value.trim() ? value : null
}

/** The project's list, or null when none is linked or the stored record does not fit. */
export function readHqClickUpBinding(lists: unknown, repoId: string): HqClickUpListBinding | null {
  if (typeof lists !== 'object' || lists === null) {
    return null
  }
  const record: unknown = Reflect.get(lists, repoId)
  if (typeof record !== 'object' || record === null) {
    return null
  }
  const listId = text(record, 'listId')
  const spaceId = text(record, 'spaceId')
  if (!listId || !spaceId) {
    return null
  }
  return { listId, spaceId, listName: text(record, 'listName') ?? listId }
}

/** A copy with the project's link set, or removed when `binding` is null. */
export function withHqClickUpBinding(
  lists: HqProjectClickUpLists | null | undefined,
  repoId: string,
  binding: HqClickUpListBinding | null
): HqProjectClickUpLists {
  const next = Object.fromEntries(Object.entries(lists ?? {}).filter(([id]) => id !== repoId))
  return binding ? { ...next, [repoId]: binding } : next
}
