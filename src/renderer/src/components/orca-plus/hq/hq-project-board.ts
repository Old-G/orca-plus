// Custom build (hq): the HQ «Projects» board — project groups as sections, one card per project
// with its agents, open reviews, waitings and last activity, all from data the window already has.
import type { HqAutonomyLevel } from '../../../../../shared/hq-autonomy'
import type { DashboardSnapshot } from '../../../../../shared/dashboard-snapshot'
import type { HqProjectPage } from '../../../../../shared/hq-project-pages'
import type { ProjectGroup } from '../../../../../shared/project-group-types'
import { getEffectiveProjectGroupManualRank } from '../../../../../shared/project-groups'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import type { HqWaiting } from './hq-pulse-snapshot'

export type HqProjectCard = {
  repoId: string
  name: string
  /** From the HQ page heading, without the leading project name. */
  summary: string | null
  status: string | null
  worktreeCount: number
  lastActivityAt: number | null
  agentsWorking: number
  /** Agents blocked on or waiting for the user. */
  agentsNeedYou: number
  openReviews: number
  /** Open pulse waitings naming this project's HQ slug. */
  openWaitings: number
  /** The worktree a click opens: the primary checkout, else the most recently active one. */
  openWorktreeId: string | null
  /** Custom build (hq-autonomy): null when the host predates autonomy.yaml or HQ has no page. */
  autonomy: HqAutonomyLevel | null
}

export type HqProjectSection = {
  /** A project group id, or `ungrouped`. */
  id: string
  /** Nested groups read `Parent / Child`; null for the ungrouped section. */
  name: string | null
  projects: HqProjectCard[]
}

export type HqProjectBoardInput = {
  repos: readonly Repo[]
  projectGroups: readonly ProjectGroup[]
  worktreesByRepo: Readonly<Record<string, readonly Worktree[] | undefined>>
  snapshot: Pick<DashboardSnapshot, 'cards' | 'workspaces'>
  waitings: readonly HqWaiting[]
  pages: readonly HqProjectPage[]
}

export const HQ_UNGROUPED_SECTION_ID = 'ungrouped'

function pageSummary(page: HqProjectPage | undefined, name: string): string | null {
  const title = page?.title
  if (!title) {
    return null
  }
  const dash = title.indexOf(' — ')
  const summary = dash !== -1 ? title.slice(dash + 3).trim() : title
  // Why: a page HQ has not filled in yet still carries its template's `<…>` placeholder.
  const placeholder = summary.startsWith('<') && summary.endsWith('>')
  return summary && summary !== name && !placeholder ? summary : null
}

function buildCard(
  repo: Repo,
  input: HqProjectBoardInput,
  page: HqProjectPage | undefined
): HqProjectCard {
  const worktrees = (input.worktreesByRepo[repo.id] ?? []).filter(
    (worktree) => !worktree.isArchived
  )
  const byActivity = [...worktrees].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  const lastActivityAt = byActivity[0]?.lastActivityAt || null
  const primary = worktrees.find((worktree) => worktree.isMainWorktree)
  const cards = input.snapshot.cards.filter((card) => card.repoId === repo.id)
  // Why: one review linked from several worktrees still counts once.
  const reviews = new Set(
    (input.snapshot.workspaces ?? []).flatMap((workspace) =>
      workspace.repoId === repo.id &&
      (workspace.review?.state === 'open' || workspace.review?.state === 'draft')
        ? [workspace.review.number]
        : []
    )
  )
  return {
    repoId: repo.id,
    name: repo.displayName,
    summary: pageSummary(page, repo.displayName),
    status: page?.status ?? null,
    autonomy: page?.autonomy ?? null,
    worktreeCount: worktrees.length,
    lastActivityAt,
    agentsWorking: cards.filter((entry) => entry.bucket === 'working').length,
    agentsNeedYou: cards.filter((entry) => entry.bucket === 'attention').length,
    openReviews: reviews.size,
    openWaitings: page
      ? input.waitings.filter((waiting) => waiting.project === page.slug).length
      : 0,
    openWorktreeId: (primary ?? byActivity[0])?.id ?? null
  }
}

/** Groups in sidebar order (nested ones right after their parent), then the ungrouped projects. */
export function buildHqProjectBoard(input: HqProjectBoardInput): HqProjectSection[] {
  const pagesByRepoId = new Map(input.pages.map((page) => [page.repoId, page]))
  const repoRank = new Map(input.repos.map((repo, index) => [repo.id, index]))
  const groupIds = new Set(input.projectGroups.map((group) => group.id))
  const reposByGroupId = new Map<string, Repo[]>()
  for (const repo of input.repos) {
    const groupId =
      repo.projectGroupId && groupIds.has(repo.projectGroupId)
        ? repo.projectGroupId
        : HQ_UNGROUPED_SECTION_ID
    reposByGroupId.set(groupId, [...(reposByGroupId.get(groupId) ?? []), repo])
  }
  const childrenByParentId = new Map<string | null, ProjectGroup[]>()
  for (const group of input.projectGroups) {
    const parentId =
      group.parentGroupId && groupIds.has(group.parentGroupId) ? group.parentGroupId : null
    childrenByParentId.set(parentId, [...(childrenByParentId.get(parentId) ?? []), group])
  }

  const sections: HqProjectSection[] = []
  const pushSection = (id: string, name: string | null): void => {
    const repos = [...(reposByGroupId.get(id) ?? [])].sort(
      (a, b) =>
        getEffectiveProjectGroupManualRank(a, repoRank) -
          getEffectiveProjectGroupManualRank(b, repoRank) ||
        a.displayName.localeCompare(b.displayName)
    )
    if (repos.length > 0) {
      sections.push({
        id,
        name,
        projects: repos.map((repo) => buildCard(repo, input, pagesByRepoId.get(repo.id)))
      })
    }
  }
  const visited = new Set<string>()
  const visit = (parentId: string | null, prefix: string): void => {
    const groups = [...(childrenByParentId.get(parentId) ?? [])].sort(
      (a, b) => a.tabOrder - b.tabOrder || a.name.localeCompare(b.name)
    )
    for (const group of groups) {
      if (visited.has(group.id)) {
        continue
      }
      visited.add(group.id)
      const name = prefix ? `${prefix} / ${group.name}` : group.name
      pushSection(group.id, name)
      visit(group.id, name)
    }
  }
  visit(null, '')
  // Why: a parent cycle hides groups from the walk; their projects must still show.
  for (const group of input.projectGroups) {
    if (!visited.has(group.id)) {
      visited.add(group.id)
      pushSection(group.id, group.name)
    }
  }
  pushSection(HQ_UNGROUPED_SECTION_ID, null)
  return sections
}
