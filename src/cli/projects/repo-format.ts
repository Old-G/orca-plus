import { branchRefLabels } from '../../shared/git/refs/branch-ref-label'
import type {
  RuntimeRepoList,
  RuntimeRepoSearchRefs
} from '../../shared/runtime-worktree-contracts'
import type { ProjectGroup } from '../../shared/project-group-types'

export function formatRepoList(result: RuntimeRepoList): string {
  if (result.repos.length === 0) {
    return 'No repos found.'
  }
  return result.repos
    .map(
      (repo) =>
        `${repo.id}  ${repo.displayName}  ${repo.path}${typeof repo.hiddenAt === 'number' ? '  (hidden)' : ''}`
    )
    .join('\n')
}

export function formatProjectGroupList(result: { groups: ProjectGroup[] }): string {
  if (result.groups.length === 0) {
    return 'No project groups found.'
  }
  return result.groups
    .map((group) => [group.id, group.name, group.parentPath].filter(Boolean).join('  '))
    .join('\n')
}

export function formatRepoShow(result: { repo: Record<string, unknown> }): string {
  return Object.entries(result.repo)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
    )
    .join('\n')
}

export function formatRepoRefs(result: RuntimeRepoSearchRefs): string {
  if (result.refs.length === 0) {
    return 'No refs found.'
  }
  const labels = branchRefLabels(result.refs)
  const text = result.refs.map((ref) => labels.get(ref) ?? ref).join('\n')
  return result.truncated ? `${text}\n\ntruncated: yes` : text
}
