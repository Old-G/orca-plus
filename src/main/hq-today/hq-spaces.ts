// Custom build (hq-spaces): the workspaces under the global HQ — `workspaces/<slug>/workspace.yaml`
// each — with the projects each one holds, resolved against HQ's project pages.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import {
  HQ_SPACE_FILE,
  HQ_SPACES_DIR,
  readHqSpaceFile,
  resolveHqSpaces,
  type HqSpace,
  type HqSpaceFile,
  type HqSpaceGroup
} from '../../shared/hq-spaces'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'

/** Custom build (hq-rooms): Orca's live repos and sidebar groups, so a «Move to group» moves the
 *  project's room at once — HQ's pages learn of it only at the next sync. */
export type HqSpaceLiveGroups = {
  repos: readonly { id: string; path?: string; projectGroupId?: string | null }[]
  groups: readonly (HqSpaceGroup & { parentGroupId: string | null })[]
}

let liveGroups: (() => HqSpaceLiveGroups | null) | null = null

export function setHqSpaceLiveGroups(reader: (() => HqSpaceLiveGroups | null) | null): void {
  liveGroups = reader
}

/** A repo's group and the groups above it, nearest first; a loop in the tree stops the walk. */
function groupChain(
  groupId: string | null | undefined,
  byId: ReadonlyMap<string, { parentGroupId: string | null }>
): string[] {
  const chain: string[] = []
  let current = groupId ?? null
  while (current && !chain.includes(current) && byId.has(current)) {
    chain.push(current)
    current = byId.get(current)?.parentGroupId ?? null
  }
  return chain
}

type SpaceFiles = { files: { slug: string; file: HqSpaceFile }[]; complete: boolean }

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT')
}

/** `complete` is false when a workspace.yaml exists but could not be read or parsed. */
async function readSpaceFiles(hqPath: string): Promise<SpaceFiles> {
  const root = join(hqPath, HQ_SPACES_DIR)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  let complete = true
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          const text = await readFile(join(root, entry.name, HQ_SPACE_FILE), 'utf8')
          const file = readHqSpaceFile(entry.name, parse(text))
          return file ? { slug: entry.name, file } : null
        } catch (error) {
          // Why: a folder without a workspace.yaml is not a workspace yet; a broken one is a misread.
          complete &&= isMissing(error)
          return null
        }
      })
  )
  return {
    files: files.filter((entry): entry is { slug: string; file: HqSpaceFile } => entry !== null),
    complete
  }
}

export async function listHqSpaces(hqPath: string): Promise<HqSpace[]> {
  return (await readHqSpacePlacing(hqPath)).spaces
}

/** Custom build (hq-plus-journal): what places a record or a chat in a workspace — the spaces, the
 *  workspace claiming each project group (folder workspaces have no repo), each repo's HQ slug. */
export type HqSpacePlacing = {
  spaces: HqSpace[]
  groupRooms: Map<string, string>
  projectOfRepo: Map<string, string>
  /** The workspace marked `default: true`, first by order; null when none is. */
  defaultRoom: string | null
  /** False when a workspace file or the project pages could not be read: the rest may misplace. */
  complete: boolean
}

export async function readHqSpacePlacing(hqPath: string): Promise<HqSpacePlacing> {
  const { files, complete } = await readSpaceFiles(hqPath)
  if (files.length === 0) {
    return {
      spaces: [],
      groupRooms: new Map(),
      projectOfRepo: new Map(),
      defaultRoom: null,
      complete
    }
  }
  let pagesRead = true
  const pages = await listHqProjectPages(hqPath).catch((error: unknown) => {
    pagesRead = isMissing(error)
    return []
  })
  const live = liveGroups?.() ?? null
  const groupById = new Map((live?.groups ?? []).map((group) => [group.id, group]))
  const repoGroup = new Map((live?.repos ?? []).map((repo) => [repo.id, repo.projectGroupId]))
  const paged = new Set(pages.map((page) => page.repoId))
  const spaces = resolveHqSpaces(
    files,
    [
      ...pages.map((page) => {
        const chain = repoGroup.has(page.repoId)
          ? groupChain(repoGroup.get(page.repoId), groupById)
          : []
        return {
          repoId: page.repoId,
          slug: page.slug,
          // Why: the live group's name beats the page's, which waits for the next HQ sync.
          group: repoGroup.has(page.repoId)
            ? chain.length
              ? (groupById.get(chain[0])?.name ?? null)
              : null
            : page.group,
          groupIds: chain
        }
      }),
      // Why: a repo added to a group before the next HQ sync wrote its page still takes a room.
      ...(live?.repos ?? [])
        .filter(
          (repo) =>
            !paged.has(repo.id) &&
            // Why: HQ's own repo is no project and never gets a page.
            !(
              repo.path &&
              normalizeRuntimePathForComparison(repo.path) ===
                normalizeRuntimePathForComparison(hqPath)
            )
        )
        .map((repo) => {
          const chain = groupChain(repo.projectGroupId, groupById)
          return {
            repoId: repo.id,
            slug: null,
            group: chain.length ? (groupById.get(chain[0])?.name ?? null) : null,
            groupIds: chain
          }
        })
    ],
    live?.groups ?? []
  )
  const groupRooms = new Map<string, string>()
  for (const space of spaces) {
    const file = files.find((entry) => entry.slug === space.slug)?.file
    // Custom build (hq-rooms): a room that is a group claims its own name and its nested groups' names.
    const named = file?.groupId
      ? [...groupById.values()]
          .filter((group) => groupChain(group.id, groupById).includes(file.groupId ?? ''))
          .map((group) => group.name)
      : []
    for (const group of [...named, ...(file?.groups ?? [])]) {
      // Why: like a project, a group claimed twice stays with the first workspace.
      if (!groupRooms.has(group)) {
        groupRooms.set(group, space.slug)
      }
    }
  }
  return {
    spaces,
    groupRooms,
    projectOfRepo: new Map(pages.map((page): [string, string] => [page.repoId, page.slug])),
    defaultRoom:
      spaces.find((space) => files.find((entry) => entry.slug === space.slug)?.file.isDefault)
        ?.slug ?? null,
    complete: complete && pagesRead
  }
}
