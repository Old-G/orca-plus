// Custom build (hq-rooms): a room is an Orca sidebar group — renaming, recolouring or removing one
// edits its `workspace.yaml` in place (comments kept); the group itself is changed by the caller.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { getProjectGroupSubtreeIds } from '../../shared/project-groups'
import {
  HQ_SPACE_FILE,
  HQ_SPACE_SLUG,
  HQ_SPACES_DIR,
  readHqSpaceFile,
  type HqSpaceFile
} from '../../shared/hq-spaces'

/** Where a removed room's folder goes; readers skip it (not a slug). */
export const HQ_REMOVED_ROOMS_DIR = '.removed'

function roomFile(hqPath: string, slug: string): string {
  if (!HQ_SPACE_SLUG.test(slug)) {
    throw new Error(`No room ${slug}.`)
  }
  return join(hqPath, HQ_SPACES_DIR, slug, HQ_SPACE_FILE)
}

export async function readHqRoom(hqPath: string, slug: string): Promise<HqSpaceFile> {
  const text = await readFile(roomFile(hqPath, slug), 'utf8').catch(() => {
    throw new Error(`No room ${slug}.`)
  })
  const file = readHqSpaceFile(slug, parseDocument(text).toJS())
  if (!file) {
    throw new Error(`Room ${slug} cannot be read.`)
  }
  return file
}

/** Sets top-level keys of a room's file; `undefined` leaves a key as it is, `null` writes null. */
export async function setHqRoomFields(
  hqPath: string,
  slug: string,
  fields: Record<string, string | number | null | undefined>
): Promise<void> {
  const path = roomFile(hqPath, slug)
  const doc = parseDocument(await readFile(path, 'utf8'))
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      doc.set(key, value)
    }
  }
  await writeFile(path, doc.toString())
}

/** Moves the room's folder aside; its projects fall to the default room. The default one stays. */
export async function removeHqRoomFolder(hqPath: string, slug: string, now: Date): Promise<string> {
  const file = await readHqRoom(hqPath, slug)
  if (file.isDefault) {
    throw new Error('The default room holds every project in no group; it cannot be removed.')
  }
  const aside = join(hqPath, HQ_SPACES_DIR, HQ_REMOVED_ROOMS_DIR)
  await mkdir(aside, { recursive: true })
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  const target = join(aside, `${slug}-${stamp}`)
  await rename(join(hqPath, HQ_SPACES_DIR, slug), target)
  return target
}

/** The sidebar-group calls a room makes; the runtime's project-group controller in the app. */
export type HqRoomGroups = {
  create: (name: string) => Promise<{ id: string }>
  update: (id: string, updates: { name?: string; color?: string | null }) => Promise<unknown>
  remove: (id: string) => Promise<unknown>
  /** What else lives under the group; removing it would delete these, not ungroup them. */
  contents: (id: string) => Promise<{ groups: number; folders: number }>
}

const COLOR = /^#[0-9a-fA-F]{6}$/

/** A new room is a new sidebar group of the same name; a failed room file takes the group back. */
export async function createHqRoomWithGroup<T>(
  groups: HqRoomGroups,
  input: { name: string; color?: string },
  addRoom: (groupId: string) => Promise<T>
): Promise<T> {
  const name = input.name.trim()
  if (!name) {
    throw new Error('A room needs a name.')
  }
  if (input.color && !COLOR.test(input.color)) {
    throw new Error('A colour is #rrggbb.')
  }
  const group = await groups.create(name)
  try {
    if (input.color) {
      await groups.update(group.id, { color: input.color })
    }
    return await addRoom(group.id)
  } catch (error) {
    await groups.remove(group.id).catch(() => undefined)
    throw error
  }
}

/** Renames or recolours a room and its group together; a room with no group changes its file only. */
export async function updateHqRoom(
  groups: HqRoomGroups,
  hqPath: string,
  slug: string,
  changes: { name?: string; color?: string }
): Promise<void> {
  const name = changes.name?.trim()
  if (changes.name !== undefined && !name) {
    throw new Error('A room needs a name.')
  }
  if (changes.color !== undefined && !COLOR.test(changes.color)) {
    throw new Error('A colour is #rrggbb.')
  }
  const file = await readHqRoom(hqPath, slug)
  if (file.groupId) {
    await groups.update(file.groupId, {
      ...(name ? { name } : {}),
      ...(changes.color ? { color: changes.color } : {})
    })
  }
  await setHqRoomFields(hqPath, slug, { name, color: changes.color })
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

/** Removes a room and its group; the group's projects stay in the sidebar, in no group. */
export async function removeHqRoom(
  groups: HqRoomGroups,
  hqPath: string,
  slug: string,
  now: Date
): Promise<{ archived: string }> {
  const file = await readHqRoom(hqPath, slug)
  if (file.groupId) {
    // Why: deleting a group drops its nested groups and folder workspaces (and their sessions).
    const held = await groups.contents(file.groupId)
    if (held.groups > 0 || held.folders > 0) {
      const parts = [
        held.folders > 0 ? plural(held.folders, 'folder workspace') : null,
        held.groups > 0 ? plural(held.groups, 'group') : null
      ].filter(Boolean)
      throw new Error(
        `Room ${file.name} holds ${parts.join(' and ')} in its sidebar group; move them out of the group first.`
      )
    }
  }
  const archived = await removeHqRoomFolder(hqPath, slug, now)
  if (file.groupId) {
    await groups.remove(file.groupId)
  }
  return { archived }
}

/** The app's runtime as a room's group calls. */
export function hqRoomGroupsOf(runtime: {
  createProjectGroup: (input: { name: string }) => Promise<{ id: string }>
  updateProjectGroup: (
    id: string,
    updates: { name?: string; color?: string | null }
  ) => Promise<unknown>
  deleteProjectGroup: (id: string) => Promise<unknown>
  listProjectGroups: () => { id: string; parentGroupId: string | null }[]
  listFolderWorkspaces: () => { projectGroupId: string }[]
}): HqRoomGroups {
  return {
    create: (name) => runtime.createProjectGroup({ name }),
    update: (id, updates) => runtime.updateProjectGroup(id, updates),
    remove: (id) => runtime.deleteProjectGroup(id),
    contents: async (id) => {
      const subtree = getProjectGroupSubtreeIds(runtime.listProjectGroups(), id)
      return {
        groups: subtree.size - 1,
        folders: runtime
          .listFolderWorkspaces()
          .filter((folder) => subtree.has(folder.projectGroupId)).length
      }
    }
  }
}
