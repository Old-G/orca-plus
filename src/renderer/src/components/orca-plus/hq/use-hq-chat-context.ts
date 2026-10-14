// Custom build (hq-chats): what the context panel beside an HQ chat shows about its workspace —
// the branch, the uncommitted changes, the linked review with its checks, the linked task — read
// from the stores the sidebar and Source Control already fill. The workspace's git status is
// refreshed while the panel shows it, since status polling follows only the active workspace.
import { useEffect, useMemo } from 'react'
import type { GitStatusEntry } from '../../../../../shared/git-status-types'
import type { CheckStatus } from '../../../../../shared/github/pull-request-types'
import type { HqTriageDecisions } from '../../../../../shared/hq-triage'
import { isGitRepoKind } from '../../../../../shared/repo-kind'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { getConnectionId } from '@/lib/connection-context'
import { getWorktreeGitIdentityDisplay } from '../../../../../shared/worktree/git-identity-display'
import { useAppStore } from '@/store'
import { getHostedReviewCacheKey } from '@/store/slices/hosted-review-cache-identity'
import { getWorktreeGitOwnerTarget } from '../../right-sidebar/worktree-git-owner-target'
import { refreshGitStatusForWorktree } from '../../right-sidebar/git-status-refresh'
import { getWorktreeCardJiraIssueDisplay } from '../../sidebar/worktree-card-jira-issue-display'

const STATUS_REFRESH_MS = 30_000
const NO_CHANGES: GitStatusEntry[] = []

export type HqChatReview = {
  label: 'PR' | 'MR'
  number: number
  title: string
  url: string
  state: 'open' | 'closed' | 'merged' | 'draft'
  status: CheckStatus
}

export type HqChatTask = { label: string; title: string | null; url: string }

export type HqChatContext = {
  worktree: Worktree | null
  repo: Repo | null
  branch: string | null
  changes: GitStatusEntry[]
  review: HqChatReview | null
  task: HqChatTask | null
}

/** The task a workspace was made for: its own link, else the ClickUp task HQ's «Take» started it
 *  from (that flow records the link only in HQ's decisions). */
export function hqChatTask(
  worktree: Pick<Worktree, 'id' | 'linkedWorkItem'>,
  decisions: HqTriageDecisions | undefined
): HqChatTask | null {
  const linked = getWorktreeCardJiraIssueDisplay(worktree)
  if (linked) {
    return { label: linked.identifier, title: linked.title, url: linked.url }
  }
  const taken = Object.entries(decisions ?? {}).find(
    ([, decision]) => decision.decision === 'taken' && decision.worktreeId === worktree.id
  )
  return taken
    ? {
        label: `ClickUp ${taken[0]}`,
        title: null,
        url: `https://app.clickup.com/t/${encodeURIComponent(taken[0])}`
      }
    : null
}

export function useHqChatContext(worktreeId: string): HqChatContext {
  const worktree = useAppStore((state) => state.getKnownWorktreeById(worktreeId) ?? null)
  const repo = useAppStore((state) =>
    worktree ? (state.repos.find((candidate) => candidate.id === worktree.repoId) ?? null) : null
  )
  const settings = useAppStore((state) => state.settings)
  const changes = useAppStore((state) => state.gitStatusByWorktree[worktreeId] ?? NO_CHANGES)
  const identity = worktree ? getWorktreeGitIdentityDisplay(worktree) : null
  const branch = identity?.kind === 'branch' ? identity.branchName : null
  const reviewKey =
    repo && branch
      ? getHostedReviewCacheKey(
          repo.path,
          branch,
          settings,
          repo.id,
          repo.connectionId,
          repo.executionHostId,
          true
        )
      : null
  const reviewInfo = useAppStore((state) =>
    reviewKey ? (state.hostedReviewCache[reviewKey]?.data ?? null) : null
  )
  const isGit = Boolean(repo && isGitRepoKind(repo))
  const worktreePath = worktree?.path ?? null

  useEffect(() => {
    if (!isGit || !worktreePath) {
      return
    }
    const controller = new AbortController()
    const refresh = (): void => {
      const store = useAppStore.getState()
      // Why: git status routes by the workspace's owner host; none resolved means nothing to read yet.
      const target = getWorktreeGitOwnerTarget(worktreeId)
      if (!target) {
        return
      }
      void refreshGitStatusForWorktree({
        target,
        worktreeId,
        worktreePath,
        connectionId: getConnectionId(worktreeId) ?? undefined,
        deps: {
          setGitStatus: store.setGitStatus,
          updateWorktreeGitIdentity: store.updateWorktreeGitIdentity,
          setUpstreamStatus: store.setUpstreamStatus,
          fetchUpstreamStatus: store.fetchUpstreamStatus
        },
        request: { admissionTier: 'background', signal: controller.signal }
      }).catch(() => undefined)
    }
    refresh()
    const timer = setInterval(refresh, STATUS_REFRESH_MS)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [isGit, worktreeId, worktreePath])

  const review = useMemo<HqChatReview | null>(
    () =>
      reviewInfo
        ? {
            label: reviewInfo.provider === 'gitlab' ? 'MR' : 'PR',
            number: reviewInfo.number,
            title: reviewInfo.title,
            url: reviewInfo.url,
            state: reviewInfo.state,
            status: reviewInfo.status
          }
        : null,
    [reviewInfo]
  )
  const decisions = settings?.hqTriageDecisions
  const task = useMemo(
    () => (worktree ? hqChatTask(worktree, decisions) : null),
    [worktree, decisions]
  )
  return { worktree, repo, branch, changes, review, task }
}
