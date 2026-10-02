import { branchName } from '@/lib/git-utils'
import { getHostedReviewCacheKey } from '@/store/slices/hosted-review-cache-identity'
import type { AppState } from '@/store/types'
import type { DashboardCardReview } from '../../../../shared/dashboard-snapshot'
import { hostedReviewInfoFromGitHubPRInfo } from '../../../../shared/hosted-review-github'
import {
  isPositiveHostedReviewNumber,
  type HostedReviewInfo
} from '../../../../shared/hosted-review'
import type { PRInfo } from '../../../../shared/github/pull-request-types'
import type { Repo } from '../../../../shared/repo-types'
import type { WorkspaceStatusDefinition, Worktree } from '../../../../shared/worktree/types'
import {
  DEFAULT_WORKSPACE_STATUSES,
  getWorkspaceStatus
} from '../../../../shared/workspace-statuses'
import {
  canUseParentPrChecksGitHubPRCacheEntry,
  getParentPrChecksGitHubPRCacheEntry
} from '../right-sidebar/parent-pr-checks-github-pr-cache'
import { canUseParentPrChecksHostedReviewCacheEntry } from '../right-sidebar/parent-pr-checks-hosted-review-cache'

export type DashboardCardContextState = Partial<
  Pick<AppState, 'hostedReviewCache' | 'prCache' | 'settings' | 'workspaceStatuses'>
>

export type DashboardCardContext = {
  workspaceStatus: WorkspaceStatusDefinition
  hasReview: boolean
  review?: DashboardCardReview
}

function hasLinkedReview(worktree: Worktree): boolean {
  return [
    worktree.linkedPR,
    worktree.linkedGitLabMR,
    worktree.linkedBitbucketPR,
    worktree.linkedAzureDevOpsPR,
    worktree.linkedGiteaPR
  ].some(isPositiveHostedReviewNumber)
}

/** The worktree's cached review in full, with the GitHub PR behind it when there is one. */
export type DashboardHostedReview = { review: HostedReviewInfo; githubPR: PRInfo | null }

// Custom build (hq): exported in full so HQ can offer the Checks panel's merge actions.
export function resolveDashboardHostedReview(
  state: DashboardCardContextState,
  repo: Repo | null,
  worktree: Worktree
): DashboardHostedReview | undefined {
  if (!repo || !state.hostedReviewCache || !state.prCache || repo.kind === 'folder') {
    return undefined
  }
  const branch = branchName(worktree.branch)
  const hostedReviewEntry =
    state.hostedReviewCache[
      getHostedReviewCacheKey(
        repo.path,
        branch,
        state.settings,
        repo.id,
        repo.connectionId,
        repo.executionHostId,
        true
      )
    ]
  const hostedReview = hostedReviewEntry?.data
  const prEntry = getParentPrChecksGitHubPRCacheEntry({
    prCache: state.prCache,
    repo,
    branch,
    settings: state.settings ?? null
  })
  const githubPR = canUseParentPrChecksGitHubPRCacheEntry(worktree, prEntry, hostedReviewEntry)
    ? prEntry.data
    : null
  if (
    hostedReview &&
    canUseParentPrChecksHostedReviewCacheEntry(worktree, hostedReview, hostedReviewEntry)
  ) {
    return {
      review: hostedReview,
      githubPR:
        hostedReview.provider === 'github' && githubPR?.number === hostedReview.number
          ? githubPR
          : null
    }
  }
  return githubPR ? { review: hostedReviewInfoFromGitHubPRInfo(githubPR), githubPR } : undefined
}

function resolveReview(
  state: DashboardCardContextState,
  repo: Repo | null,
  worktree: Worktree
): DashboardCardReview | undefined {
  const resolved = resolveDashboardHostedReview(state, repo, worktree)
  return resolved ? { number: resolved.review.number, state: resolved.review.state } : undefined
}

export function resolveDashboardCardContext(
  state: DashboardCardContextState,
  repo: Repo | null,
  worktree: Worktree
): DashboardCardContext {
  const statuses =
    state.workspaceStatuses && state.workspaceStatuses.length > 0
      ? state.workspaceStatuses
      : DEFAULT_WORKSPACE_STATUSES
  const workspaceStatusId = getWorkspaceStatus(worktree, statuses)
  const review = resolveReview(state, repo, worktree)
  return {
    workspaceStatus:
      statuses.find((status) => status.id === workspaceStatusId) ?? DEFAULT_WORKSPACE_STATUSES[0],
    review,
    hasReview: hasLinkedReview(worktree) || review !== undefined
  }
}
