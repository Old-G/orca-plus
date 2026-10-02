import { describe, expect, it } from 'vitest'
import type { HostedReviewInfo } from '../../../../shared/source-control/hosted-review/hosted-review-contracts'
import type { PRInfo } from '../../../../shared/github/pull-requests/pull-request-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { getGitHubPRCacheKey } from '../../../../shared/github/cache/github-cache-key'
import { getHostedReviewCacheKey } from '@/store/slices/hosted-review/hosted-review-cache-identity'
import {
  resolveDashboardHostedReview
} from './dashboard-card-context'

const repo: Repo = {
  id: 'repo-1',
  path: '/repo',
  displayName: 'Repo',
  badgeColor: '#fff',
  addedAt: 1,
  kind: 'git'
}

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'worktree-1',
    repoId: repo.id,
    path: '/repo/worktree',
    head: 'current-head',
    branch: 'refs/heads/feature',
    isBare: false,
    isMainWorktree: false,
    displayName: 'feature',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

function review(overrides: Partial<HostedReviewInfo> = {}): HostedReviewInfo {
  return {
    provider: 'bitbucket',
    number: 77,
    title: 'Review',
    state: 'open',
    url: 'https://example.test/review/77',
    status: 'success',
    updatedAt: '2026-01-01T00:00:00.000Z',
    mergeable: 'MERGEABLE',
    ...overrides
  }
}

// Custom build (hq): kept apart from the dashboard-card-context suite upstream removed (#38113).
describe('resolveDashboardHostedReview', () => {
  const pr: PRInfo = {
    number: 42,
    title: 'GitHub review',
    state: 'open',
    url: 'https://example.test/pull/42',
    checksStatus: 'success',
    updatedAt: '2026-01-01T00:00:00.000Z',
    mergeable: 'MERGEABLE'
  }
  const prKey = getGitHubPRCacheKey(repo.path, repo.id, 'feature', null, null, null, true)
  const reviewKey = getHostedReviewCacheKey(repo.path, 'feature', null, repo.id, null, null, true)

  it('returns the cached GitHub review with the PR behind it', () => {
    const cached = review({ provider: 'github', number: 42 })
    expect(
      resolveDashboardHostedReview(
        {
          settings: null,
          hostedReviewCache: {
            [reviewKey]: { data: cached, fetchedAt: 2, linkedReviewHintKey: 'github:42' }
          },
          prCache: { [prKey]: { data: pr, fetchedAt: 1 } }
        },
        repo,
        worktree({ linkedPR: 42 })
      )
    ).toEqual({ review: cached, githubPR: pr })
  })

  it('never pairs a GitLab review with a GitHub PR', () => {
    const cached = review({ provider: 'gitlab', number: 42 })
    expect(
      resolveDashboardHostedReview(
        {
          settings: null,
          hostedReviewCache: {
            [reviewKey]: { data: cached, fetchedAt: 2, linkedReviewHintKey: 'gitlab:42' }
          },
          prCache: { [prKey]: { data: pr, fetchedAt: 1 } }
        },
        repo,
        worktree({ linkedGitLabMR: 42 })
      )
    ).toEqual({ review: cached, githubPR: null })
  })

  it('builds the review from the GitHub PR cache when no hosted review is cached', () => {
    expect(
      resolveDashboardHostedReview(
        { settings: null, hostedReviewCache: {}, prCache: { [prKey]: { data: pr, fetchedAt: 1 } } },
        repo,
        worktree({ linkedPR: 42 })
      )
    ).toMatchObject({
      review: { provider: 'github', number: 42, mergeable: 'MERGEABLE' },
      githubPR: pr
    })
  })
})
