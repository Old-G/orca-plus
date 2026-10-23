// Custom build (hq-plus-journal): which room (HQ space) a journal record belongs to, and which room
// the chat asking for the journal works in. A chat in the HQ repo itself sees every room's headings.
import { basename } from 'node:path'
import { HQ_JOURNAL_UNASSIGNED } from '../../shared/hq-journal'
import { hqSpaceOf, type HqSpace } from '../../shared/hq-spaces'
import {
  isPathInsideOrEqual,
  normalizeRuntimePathForComparison
} from '../../shared/cross-platform-path'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { getRepoIdFromWorktreeId, splitWorktreeId } from '../../shared/worktree/id'

export type HqRoomSources = {
  spaces: readonly HqSpace[]
  /** Project-group name → the room claiming it; folder workspaces have no repo to go by. */
  groupRooms: ReadonlyMap<string, string>
  /** Orca repo id → its HQ project slug. */
  projectOfRepo: ReadonlyMap<string, string>
  /** Where an HQ project no room claims belongs; null = HQ_JOURNAL_UNASSIGNED. */
  defaultRoom: string | null
  repos: readonly { id: string; path: string; displayName: string }[]
  hqPath: string | null
  folderGroup: (folderWorkspaceId: string) => string | null
  /** The workspace an agent session ran in. */
  sessionWorkspace: (sessionId: string) => string | null
}

export type HqRoomRef = {
  worktreeId?: string | null
  sessionId?: string | null
  cwd?: string | null
  /** A project slug, or the folder name some records use instead. */
  project?: string | null
  /** Where it came from (`slack`, `clickup`), for a record with nothing else to place it by. */
  channel?: string | null
}

export type HqPlace = {
  /** A room's slug, or HQ_JOURNAL_UNASSIGNED. */
  room: string
  project: string | null
  /** The HQ repo itself. */
  hq: boolean
  /** A room claims it (or it is HQ); false for a guess — the default room, a channel, no room. */
  firm: boolean
}

type Found = { room: string | null; project: string | null; hq: boolean; firm: boolean }

function samePath(a: string, b: string): boolean {
  return normalizeRuntimePathForComparison(a) === normalizeRuntimePathForComparison(b)
}

/** A project's room; an HQ project no room claims goes to the default room. Only a project HQ
 *  knows does: a record naming something else could belong to any room, so it stays unassigned. */
function roomOfProject(
  sources: HqRoomSources,
  repoId: string | null,
  project: string | null
): { room: string | null; firm: boolean } {
  const claimed = hqSpaceOf(sources.spaces, { repoId, project })?.slug
  if (claimed) {
    return { room: claimed, firm: true }
  }
  const known =
    project !== null &&
    [...sources.projectOfRepo.values()].some((slug) => slug.toLowerCase() === project.toLowerCase())
  return { room: known ? sources.defaultRoom : null, firm: false }
}

function placeOfRepo(sources: HqRoomSources, repoId: string, worktreePath: string | null): Found {
  const repo = sources.repos.find((entry) => entry.id === repoId)
  const hqPath = sources.hqPath
  const hq =
    hqPath !== null &&
    ((repo !== undefined && samePath(repo.path, hqPath)) ||
      (worktreePath !== null && samePath(worktreePath, hqPath)))
  const project = sources.projectOfRepo.get(repoId) ?? null
  if (hq) {
    return { room: null, project, hq, firm: true }
  }
  return { ...roomOfProject(sources, repoId, project), project, hq }
}

function placeOfWorkspace(sources: HqRoomSources, workspaceId: string): Found | null {
  const scope = parseWorkspaceKey(workspaceId)
  if (scope?.type === 'folder') {
    const group = sources.folderGroup(scope.folderWorkspaceId)
    const room = group ? (sources.groupRooms.get(group) ?? null) : null
    return { room, project: null, hq: false, firm: room !== null }
  }
  const worktreeId = scope?.type === 'worktree' ? scope.worktreeId : workspaceId
  const split = splitWorktreeId(worktreeId)
  return placeOfRepo(sources, getRepoIdFromWorktreeId(worktreeId), split?.worktreePath ?? null)
}

function placeOfCwd(sources: HqRoomSources, cwd: string): Found | null {
  if (sources.hqPath && isPathInsideOrEqual(sources.hqPath, cwd)) {
    return { room: null, project: null, hq: true, firm: true }
  }
  const repo = sources.repos
    .filter((entry) => isPathInsideOrEqual(entry.path, cwd))
    .sort((a, b) => b.path.length - a.path.length)[0]
  return repo ? placeOfRepo(sources, repo.id, null) : null
}

/** A project named by its folder or display name, as its HQ slug when Orca knows the repo. */
function projectSlug(sources: HqRoomSources, name: string): string {
  const wanted = name.toLowerCase()
  const repo = sources.repos.find(
    (entry) =>
      entry.displayName.toLowerCase() === wanted || basename(entry.path).toLowerCase() === wanted
  )
  return (repo ? sources.projectOfRepo.get(repo.id) : undefined) ?? name
}

/** Where a record belongs: by its workspace, its session's, its folder, its project, its channel. */
export function hqPlaceOf(sources: HqRoomSources, ref: HqRoomRef): HqPlace {
  const workspaceId =
    ref.worktreeId || (ref.sessionId ? sources.sessionWorkspace(ref.sessionId) : null)
  const found =
    (workspaceId ? placeOfWorkspace(sources, workspaceId) : null) ??
    (ref.cwd ? placeOfCwd(sources, ref.cwd) : null)
  const project = found?.project ?? (ref.project ? projectSlug(sources, ref.project) : null)
  if (found?.room || found?.hq) {
    return { room: found.room ?? HQ_JOURNAL_UNASSIGNED, project, hq: found.hq, firm: found.firm }
  }
  const byProject = project ? roomOfProject(sources, null, project) : null
  if (byProject?.room) {
    return { room: byProject.room, project, hq: false, firm: byProject.firm }
  }
  const byChannel = ref.channel
    ? sources.spaces.filter(
        (space) => space.messenger === ref.channel || space.tasks === ref.channel
      )
    : []
  const room = byChannel.length === 1 ? byChannel[0].slug : HQ_JOURNAL_UNASSIGNED
  return { room, project, hq: false, firm: false }
}

export type HqCaller = {
  sessionId?: string | null
  worktreeId?: string | null
  cwd?: string | null
}

export type HqCallerScope =
  | { kind: 'overview'; sessionId: string | null; worktreeId: string | null }
  | {
      kind: 'room'
      room: string
      project: string | null
      sessionId: string | null
      worktreeId: string | null
    }

/**
 * The room a caller may read. Its own chat decides first, so a chat that changes directory into
 * HQ still reads only its room; a caller with no chat and no project reads the unassigned room.
 */
export function hqCallerScope(sources: HqRoomSources, caller: HqCaller): HqCallerScope {
  const sessionId = caller.sessionId || null
  const worktreeId =
    caller.worktreeId || (sessionId ? sources.sessionWorkspace(sessionId) : null) || null
  const found =
    (worktreeId ? placeOfWorkspace(sources, worktreeId) : null) ??
    (caller.cwd ? placeOfCwd(sources, caller.cwd) : null)
  if (found?.hq) {
    return { kind: 'overview', sessionId, worktreeId }
  }
  return {
    kind: 'room',
    room: found?.room ?? HQ_JOURNAL_UNASSIGNED,
    project: found?.project ?? null,
    sessionId,
    worktreeId
  }
}
