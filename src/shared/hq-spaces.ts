// Custom build (hq-spaces): workspaces above projects — a company (Acme) or a venture of its
// own (Hobby, OG News, personal) — each a folder under the global HQ, `workspaces/<slug>/`, with a
// `workspace.yaml` naming its colour and which project groups and projects belong to it. HQ shows
// one of them or all; skills read the same file. Called «space» in code: Orca's «workspace» is a
// worktree.
import { z } from 'zod'

export const HQ_SPACES_DIR = 'workspaces'
export const HQ_SPACE_FILE = 'workspace.yaml'

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/
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
  projects: z.array(z.string().max(200)).max(500)
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
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : []
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
  return {
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : slug,
    color: typeof color === 'string' && COLOR.test(color) ? color : FALLBACK_COLOR,
    groups: stringList(field('groups')),
    projects: stringList(field('projects')),
    order: typeof order === 'number' ? order : 100
  }
}

export type HqSpaceProject = { repoId: string; slug: string; group: string | null }

/** Each space with the projects it holds; a project claimed twice stays with the first space. */
export function resolveHqSpaces(
  files: readonly { slug: string; file: HqSpaceFile }[],
  projects: readonly HqSpaceProject[]
): HqSpace[] {
  const claimed = new Set<string>()
  return [...files]
    .sort((a, b) => a.file.order - b.file.order || a.slug.localeCompare(b.slug))
    .map(({ slug, file }) => {
      const mine = projects.filter(
        (project) =>
          !claimed.has(project.slug) &&
          (file.projects.includes(project.slug) ||
            (project.group !== null && file.groups.includes(project.group)))
      )
      for (const project of mine) {
        claimed.add(project.slug)
      }
      return {
        slug,
        name: file.name,
        color: file.color,
        repoIds: mine.map((project) => project.repoId),
        projects: [...new Set([...mine.map((project) => project.slug), ...file.projects])].sort()
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
