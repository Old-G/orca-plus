// Custom build (hq-mr-watch): the repos of the GitLab groups HQ's config names (`gitlab_groups`),
// every page of each group, kept for an hour only when every group was listed.
import type { HqMrRepoListing } from '../../shared/hq-mr-watch'
import { parseHqScoutConfigValues } from '../../shared/hq-slack-scout'

const PER_PAGE = 100
// Why: a guard against a listing that never ends, far above any group HQ follows.
const MAX_PAGES = 50
const KEEP_MS = 60 * 60_000

export type HqGitLabReposDeps = {
  /** HQ's scout config text; empty when there is none. */
  readConfig: () => Promise<string>
  glabJson: (path: string) => Promise<unknown>
  now: () => number
  warn: (message: string, error: unknown) => void
}

function pathOf(project: unknown): string | null {
  const path =
    project && typeof project === 'object' ? Reflect.get(project, 'path_with_namespace') : null
  return typeof path === 'string' && path ? path : null
}

export function createHqGitLabRepos(deps: HqGitLabReposDeps): () => Promise<HqMrRepoListing> {
  let cached: { at: number; repos: string[] } | null = null
  const listGroup = async (group: string): Promise<string[]> => {
    const repos: string[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const listed = await deps.glabJson(
        `groups/${encodeURIComponent(group)}/projects?per_page=${PER_PAGE}&page=${page}&include_subgroups=true&simple=true`
      )
      const projects = Array.isArray(listed) ? listed : []
      repos.push(...projects.flatMap((project) => pathOf(project) ?? []))
      if (projects.length < PER_PAGE) {
        break
      }
    }
    return repos
  }
  return async () => {
    if (cached && deps.now() - cached.at < KEEP_MS) {
      return { repos: cached.repos, complete: true }
    }
    const groups = [
      ...(parseHqScoutConfigValues(await deps.readConfig()).get('gitlab_groups') ?? '').matchAll(
        /[\w./-]+/g
      )
    ].map((match) => match[0])
    const repos: string[] = []
    let complete = true
    for (const group of groups) {
      try {
        repos.push(...(await listGroup(group)))
      } catch (error) {
        complete = false
        deps.warn(`[hq-mr-watch] could not list the GitLab group ${group}:`, error)
      }
    }
    // Why: a group that failed (glab not on PATH yet at startup, GitLab down) is asked again next pass.
    cached = complete && repos.length > 0 ? { at: deps.now(), repos } : null
    return { repos, complete: complete && repos.length > 0 }
  }
}
