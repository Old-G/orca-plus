// Custom build (hq-spaces): workspaces above projects — a company or a venture of the owner's
// own (a side project, a personal one) — each a folder under the global HQ, `workspaces/<slug>/`, with a
// `workspace.yaml` naming its colour and which project groups and projects belong to it. HQ shows
// one of them or all; skills read the same file. Called «space» in code: Orca's «workspace» is a
// worktree.
import { z } from 'zod'

export const HQ_SPACES_DIR = 'workspaces'
export const HQ_SPACE_FILE = 'workspace.yaml'

export const HQ_SPACE_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/
const SLUG = HQ_SPACE_SLUG
const COLOR = /^#[0-9a-fA-F]{6}$/
const FALLBACK_COLOR = '#737373'

export const HqSpaceSchema = z.object({
  /** The folder name under `workspaces/`. */
  slug: z.string().regex(SLUG),
  name: z.string().min(1).max(80),
  color: z.string().regex(COLOR),
  /** Orca repo ids of its projects. */
  repoIds: z.array(z.string().max(200)).max(500),
  /** HQ project slugs, as pulse records and the feed name them. */
  projects: z.array(z.string().max(200)).max(500),
  /** Where its people write (`slack`, `telegram`…) and its tasks live (`clickup`, `jira`…); null = none. */
  messenger: z.string().max(40).nullable().optional(),
  tasks: z.string().max(40).nullable().optional(),
  /** Custom build (hq-space-git): the commit author its projects use; null = the global one. */
  git: z
    .object({ name: z.string().max(100), email: z.string().max(200) })
    .nullable()
    .optional(),
  /** Custom build (hq-plus-room-mcp): MCP servers its chats start without (`mcp: { deny: [...] }`). */
  mcpDeny: z.array(z.string().max(100)).max(64).optional(),
  /** Custom build (hq-rooms): the Orca sidebar group this room is; its name and colour are the group's. */
  groupId: z.string().max(200).nullable().optional(),
  /** Custom build (hq-rooms): the room projects in no group belong to. */
  isDefault: z.boolean().optional()
})
export type HqSpace = z.infer<typeof HqSpaceSchema>

export type HqSpacesResult = { ok: true; spaces: HqSpace[] } | { ok: false; error: string }

export function readHqSpaces(value: unknown): HqSpace[] {
  const parsed = z.object({ spaces: z.array(HqSpaceSchema) }).safeParse(value)
  return parsed.success ? parsed.data.spaces : []
}

export type HqSpaceFile = {
  name: string
  color: string
  /** Orca project-group names whose projects belong here. */
  groups: string[]
  /** HQ project slugs that belong here besides the groups'. */
  projects: string[]
  order: number
  messenger: string | null
  tasks: string | null
  git: HqSpaceGitAuthor | null
  /** Custom build (hq-plus-journal): `default: true` — where HQ projects no workspace claims belong. */
  isDefault: boolean
  /** Custom build (hq-plus-room-mcp): `mcp: { deny: [...] }`, as written. */
  mcpDeny: string[]
  /** Custom build (hq-rooms): `group_id:` — the Orca sidebar group this room is. */
  groupId: string | null
}

export type HqSpaceGitAuthor = { name: string; email: string }

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

/** `git: { name, email }`; anything that would not make a sane `user.name` / `user.email` is none. */
function readGitAuthor(value: unknown): HqSpaceGitAuthor | null {
  const name = value && typeof value === 'object' ? Reflect.get(value, 'name') : null
  const email = value && typeof value === 'object' ? Reflect.get(value, 'email') : null
  return typeof name === 'string' &&
    /^[^\n\r<>]{1,100}$/.test(name.trim()) &&
    typeof email === 'string' &&
    email.length <= 200 &&
    EMAIL.test(email.trim())
    ? { name: name.trim(), email: email.trim() }
    : null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : []
}

function readMcpDeny(value: unknown): string[] {
  const deny = value && typeof value === 'object' ? Reflect.get(value, 'deny') : undefined
  return stringList(deny)
    .map((entry) => entry.trim().slice(0, 100))
    .slice(0, 64)
}

/** A parsed `workspace.yaml`; anything malformed falls back field by field. */
export function readHqSpaceFile(slug: string, data: unknown): HqSpaceFile | null {
  if (!SLUG.test(slug)) {
    return null
  }
  const field = (key: string): unknown =>
    data && typeof data === 'object' ? Reflect.get(data, key) : undefined
  const name = field('name')
  const color = field('color')
  const order = field('order')
  const source = (key: string): string | null => {
    const value = field(key)
    return typeof value === 'string' && value.trim()
      ? value.trim().toLowerCase().slice(0, 40)
      : null
  }
  return {
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : slug,
    color: typeof color === 'string' && COLOR.test(color) ? color : FALLBACK_COLOR,
    groups: stringList(field('groups')),
    projects: stringList(field('projects')),
    order: typeof order === 'number' ? order : 100,
    messenger: source('messenger'),
    tasks: source('tasks'),
    git: readGitAuthor(field('git')),
    isDefault: field('default') === true,
    mcpDeny: readMcpDeny(field('mcp')),
    groupId: (() => {
      const value = field('group_id')
      return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null
    })()
  }
}

export type HqSpaceProject = {
  repoId: string
  slug: string
  group: string | null
  /** Custom build (hq-rooms): the repo's Orca group and the groups above it, nearest first. */
  groupIds?: readonly string[]
}

/** Custom build (hq-rooms): an Orca sidebar group as rooms read it. */
export type HqSpaceGroup = { id: string; name: string; color: string | null }

/**
 * Each space with the projects it holds. Custom build (hq-rooms): a room that is an Orca group
 * (`group_id`) takes every project inside that group, nested groups too, before any name or list
 * claims; then the `groups` names and `projects` lists, first room by order; what is left goes to
 * the `default: true` room. A room that is a group shows the group's name and colour.
 */
export function resolveHqSpaces(
  files: readonly { slug: string; file: HqSpaceFile }[],
  projects: readonly HqSpaceProject[],
  groups: readonly HqSpaceGroup[] = []
): HqSpace[] {
  const sorted = [...files].sort(
    (a, b) => a.file.order - b.file.order || a.slug.localeCompare(b.slug)
  )
  const owner = new Map<string, string>()
  const claim = (slug: string, wants: (project: HqSpaceProject) => boolean): void => {
    for (const project of projects) {
      if (!owner.has(project.slug) && wants(project)) {
        owner.set(project.slug, slug)
      }
    }
  }
  for (const { slug, file } of sorted) {
    const groupId = file.groupId
    if (groupId) {
      claim(slug, (project) => project.groupIds?.includes(groupId) ?? false)
    }
  }
  for (const { slug, file } of sorted) {
    claim(
      slug,
      (project) =>
        file.projects.includes(project.slug) ||
        (project.group !== null && file.groups.includes(project.group))
    )
  }
  const fallback = sorted.find(({ file }) => file.isDefault)
  if (fallback) {
    claim(fallback.slug, () => true)
  }
  const groupById = new Map(groups.map((group) => [group.id, group]))
  return sorted.map(({ slug, file }) => {
    const mine = projects.filter((project) => owner.get(project.slug) === slug)
    const group = file.groupId ? groupById.get(file.groupId) : undefined
    return {
      slug,
      name: group?.name.trim() ? group.name.trim().slice(0, 80) : file.name,
      color: group?.color && COLOR.test(group.color) ? group.color : file.color,
      repoIds: mine.map((project) => project.repoId),
      projects: [
        ...new Set([
          ...mine.map((project) => project.slug),
          // Why: a listed slug another room's group took is not this room's any more.
          ...file.projects.filter((listed) => (owner.get(listed) ?? slug) === slug)
        ])
      ].sort(),
      messenger: file.messenger,
      tasks: file.tasks,
      git: file.git,
      ...(file.mcpDeny.length ? { mcpDeny: file.mcpDeny } : {}),
      groupId: file.groupId,
      ...(file.isDefault ? { isDefault: true } : {})
    }
  })
}

/** Where a record belongs: by its repo, or by its HQ project slug. */
export type HqSpaceRef = { repoId?: string | null; project?: string | null }

export function hqSpaceOf(spaces: readonly HqSpace[], ref: HqSpaceRef): HqSpace | null {
  // Why: some records name the project by its folder («Billing») rather than its slug.
  const project = ref.project?.toLowerCase()
  return (
    spaces.find(
      (space) =>
        (ref.repoId ? space.repoIds.includes(ref.repoId) : false) ||
        (project ? space.projects.some((slug) => slug.toLowerCase() === project) : false)
    ) ?? null
  )
}

/** Whether HQ shows a record while `active` is chosen; one no workspace claims shows everywhere. */
export function hqSpaceShows(
  spaces: readonly HqSpace[],
  active: string | null | undefined,
  ref: HqSpaceRef
): boolean {
  if (!active || !spaces.some((space) => space.slug === active)) {
    return true
  }
  const owner = hqSpaceOf(spaces, ref)
  return owner === null || owner.slug === active
}

/** Whether HQ shows what came from `source` (`slack`, `clickup`) with no project to place it by:
 *  only in a workspace that uses it, and with all shown. */
export function hqSpaceUsesSource(
  spaces: readonly HqSpace[],
  active: string | null | undefined,
  source: string
): boolean {
  const space = active ? spaces.find((entry) => entry.slug === active) : undefined
  return !space || space.messenger === source || space.tasks === source
}

/** `group/acme-api!34`, `owner/repo#12` → `acme-api`, `repo`: a review's project, by its repo name. */
export function hqReviewProject(ref: string): string | null {
  return /([^/#!]+)[#!]\d+$/.exec(ref)?.[1] ?? null
}

/** The workspace a message goes out from, when it names neither this messenger nor this tracker —
 *  e.g. a side project's chat writing through the company's Slack; null when nothing is wrong or unknown. */
export function hqSpaceWrongChannel(
  spaces: readonly HqSpace[],
  project: string | null,
  channel: string | null
): HqSpace | null {
  const space = project && channel ? hqSpaceOf(spaces, { project }) : null
  return space && space.messenger !== channel && space.tasks !== channel ? space : null
}

/** Custom build (hq-space-keys): the tokens a workspace may keep of its own, one per kind. */
export const HQ_SPACE_KEY_KINDS = [
  'slack',
  'telegram',
  'clickup',
  'jira',
  'trello',
  'asana'
] as const
export type HqSpaceKeyKind = (typeof HQ_SPACE_KEY_KINDS)[number]

/** Which kinds each workspace has a saved key for, by slug; never the keys themselves. */
export type HqSpaceKeysResult = { keys: Record<string, HqSpaceKeyKind[]> }

export function readHqSpaceKeys(value: unknown): Record<string, HqSpaceKeyKind[]> {
  const parsed = z
    .object({ keys: z.record(z.string(), z.array(z.enum(HQ_SPACE_KEY_KINDS))) })
    .safeParse(value)
  return parsed.success ? parsed.data.keys : {}
}
