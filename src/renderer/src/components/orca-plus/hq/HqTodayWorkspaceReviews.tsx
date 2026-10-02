// Custom build (hq): the Today tab's open reviews in the user's workspaces, each with the Checks
// panel's own merge actions so a ready pull or merge request lands from HQ.
import { useCallback, useMemo } from 'react'
import type { DashboardWorkspace } from '../../../../../shared/dashboard-snapshot'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { translate } from '@/i18n/i18n'
import { branchName } from '@/lib/git-utils'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import { refreshHostedReviewCard } from '@/store/slices/hosted-review-card-refresh'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import {
  resolveDashboardHostedReview,
  type DashboardHostedReview
} from '../../dashboard/dashboard-card-context'
import HostedReviewActions from '../../right-sidebar/HostedReviewActions'
import { ColumnHeader } from './hq-waiting-parts'

type ResolvedWorkspaceReview = DashboardHostedReview & { repo: Repo; worktree: Worktree }

function useWorkspaceReview(workspace: DashboardWorkspace): ResolvedWorkspaceReview | null {
  const repos = useAppStore((s) => s.repos)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const hostedReviewCache = useAppStore((s) => s.hostedReviewCache)
  const prCache = useAppStore((s) => s.prCache)
  const settings = useAppStore((s) => s.settings)
  return useMemo(() => {
    const repo = repos.find((entry) => entry.id === workspace.repoId)
    const worktree = findWorktreeById(worktreesByRepo, workspace.worktreeId)
    if (!repo || !worktree) {
      return null
    }
    const resolved = resolveDashboardHostedReview(
      { hostedReviewCache, prCache, settings },
      repo,
      worktree
    )
    return resolved ? { ...resolved, repo, worktree } : null
  }, [hostedReviewCache, prCache, repos, settings, workspace, worktreesByRepo])
}

/** Re-reads the review after a merge or state change, the way the Checks panel does. */
async function refreshWorkspaceReview({ repo, worktree, review }: ResolvedWorkspaceReview) {
  const { fetchHostedReviewForBranch, fetchPRForBranch } = useAppStore.getState()
  const branch = branchName(worktree.branch)
  const refreshedPR =
    review.provider === 'github'
      ? await fetchPRForBranch(repo.path, branch, {
          force: true,
          repoId: repo.id,
          worktreeId: worktree.id,
          linkedPRNumber: worktree.linkedPR,
          fallbackPRNumber: review.number
        })
      : null
  await refreshHostedReviewCard(fetchHostedReviewForBranch, {
    repoPath: repo.path,
    repoId: repo.id,
    branch,
    linkedGitHubPR: worktree.linkedPR,
    fallbackGitHubPR: refreshedPR?.number ?? null,
    linkedGitLabMR: worktree.linkedGitLabMR,
    linkedBitbucketPR: worktree.linkedBitbucketPR,
    linkedAzureDevOpsPR: worktree.linkedAzureDevOpsPR,
    linkedGiteaPR: worktree.linkedGiteaPR
  })
}

function WorkspaceReviewRow({ workspace }: { workspace: DashboardWorkspace }): React.JSX.Element {
  const resolved = useWorkspaceReview(workspace)
  const onRefreshReview = useCallback(
    () => (resolved ? refreshWorkspaceReview(resolved) : Promise.resolve()),
    [resolved]
  )
  const place = `${workspace.repoName} · ${workspace.worktreeName}`
  return (
    <li className="flex items-center gap-2 border-b border-border py-1 last:border-b-0 @max-md/hq:flex-col @max-md/hq:items-stretch">
      <button
        type="button"
        onClick={() => activateAndRevealWorkspace(workspace.worktreeId)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="w-14 shrink-0 font-mono text-[11px] text-muted-foreground">
          #{workspace.review?.number}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px]">
          {resolved?.review.title || place}
        </span>
        {resolved?.review.title ? (
          <span className="max-w-40 shrink-0 truncate text-[11px] text-muted-foreground">
            {place}
          </span>
        ) : null}
        {workspace.review?.state === 'draft' ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {translate('auto.hq.today.draft', 'draft')}
          </span>
        ) : null}
      </button>
      {/* Why: the GitHub and GitLab paths only; other providers keep the jump to the workspace. */}
      {resolved &&
      (resolved.review.provider === 'github' || resolved.review.provider === 'gitlab') ? (
        <div className="w-56 shrink-0 @max-md/hq:w-full">
          <HostedReviewActions
            review={resolved.review}
            githubPR={resolved.githubPR}
            repo={resolved.repo}
            worktree={resolved.worktree}
            onRefreshReview={onRefreshReview}
          />
        </div>
      ) : null}
    </li>
  )
}

export function HqTodayReviews({
  workspaces
}: {
  workspaces: readonly DashboardWorkspace[]
}): React.JSX.Element {
  const open = workspaces.filter(
    (workspace) => workspace.review?.state === 'open' || workspace.review?.state === 'draft'
  )
  const title = translate('auto.hq.today.reviews', 'Open reviews in your workspaces')
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <ColumnHeader title={title} count={open.length} />
      {open.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.today.noReviews', 'No open pull or merge requests.')}
        </p>
      ) : (
        <ul className="flex flex-col">
          {open.map((workspace) => (
            <WorkspaceReviewRow key={workspace.worktreeId} workspace={workspace} />
          ))}
        </ul>
      )}
    </section>
  )
}
