// Custom build (hq): what HQ's projects/<slug>.md pages say about each Orca project. A page's
// frontmatter `id` is the Orca repo id, so the renderer joins pages to repos without the registry.
export type HqProjectPage = {
  repoId: string
  /** HQ project slug — what pulse records name in `project`. */
  slug: string
  /** The page's first `# ` heading. */
  title: string | null
  /** Frontmatter `status`, e.g. `active`. */
  status: string | null
  /** Frontmatter `group`: the Orca project group the page was synced from. */
  group: string | null
  /** Frontmatter `relations`: slugs of projects this one calls or is called by. */
  relations: string[]
}

/** `pages` is empty when no HQ folder is set. */
export type HqProjectPagesResult =
  | { ok: true; pages: HqProjectPage[] }
  | { ok: false; error: string }

/** HQ's all-projects diagram: the Archify page itself, rendered from wiki/diagrams/. */
export type HqProjectMapResult =
  | { ok: true; html: string; projects: number; relations: number }
  | { ok: false; reason: 'off' | 'archify-missing' | 'failed'; error?: string }

/** One markdown page of the HQ folder, by its path relative to the folder. */
export type HqWikiEntry = { path: string; title: string }

export type HqWikiTreeResult = { ok: true; entries: HqWikiEntry[] } | { ok: false; error: string }

export type HqWikiPageResult = { ok: true; markdown: string } | { ok: false; error: string }

/** A project's own Archify diagram from its Strata `wiki/diagrams/`; `name` is the file shown. */
export type HqProjectDiagramResult =
  | { ok: true; html: string; name: string }
  | { ok: false; reason: 'none' | 'remote' | 'failed'; error?: string }

/** A pull or merge request someone asked the user to review. */
export type HqReview = {
  provider: 'github' | 'gitlab'
  /** `owner/repo#12` or `group/project!34`. */
  ref: string
  title: string
  url: string
  author: string | null
  draft: boolean
  updatedAt: number | null
}

/** Every source answers on its own; one failing does not hide the others. */
export type HqReviewsResult = { reviews: HqReview[]; errors: string[] }

/** What a workspace still holds that an agent may have left unfinished. */
export type HqWorktreeGitState = { changes: number; ahead: number }

/** By worktree path; null where the path could not be read (gone, not git, or remote). */
export type HqWorktreeGitStates = Record<string, HqWorktreeGitState | null>
