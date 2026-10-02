// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardWorkspace } from '../../../../../shared/dashboard-snapshot'
import type { HostedReviewInfo } from '../../../../../shared/hosted-review'

type ActionsProps = {
  review: HostedReviewInfo
  onRefreshReview: () => Promise<void>
}

const mocks = vi.hoisted(() => ({
  actions: new Array<ActionsProps>(),
  resolved: new Map<string, { review: HostedReviewInfo; githubPR: null }>(),
  reveal: vi.fn(),
  fetchPRForBranch: vi.fn(async () => ({ number: 7 })),
  fetchHostedReviewForBranch: vi.fn(async () => null)
}))

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorkspace: mocks.reveal }))
vi.mock('@/store', () => {
  const state = () => ({
    repos: [{ id: 'shop', path: '/shop' }],
    worktreesByRepo: {
      shop: ['gh', 'gl', 'bb', 'none'].map((id) => ({
        id,
        branch: `refs/heads/${id}`,
        linkedPR: null,
        linkedGitLabMR: null,
        linkedBitbucketPR: null,
        linkedAzureDevOpsPR: null,
        linkedGiteaPR: null
      }))
    },
    hostedReviewCache: {},
    prCache: {},
    settings: null,
    fetchPRForBranch: mocks.fetchPRForBranch,
    fetchHostedReviewForBranch: mocks.fetchHostedReviewForBranch
  })
  const useAppStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state())
  useAppStore.getState = state
  return { useAppStore }
})
vi.mock('../../dashboard/dashboard-card-context', () => ({
  resolveDashboardHostedReview: (_state: unknown, _repo: unknown, worktree: { id: string }) =>
    mocks.resolved.get(worktree.id)
}))
vi.mock('../../right-sidebar/HostedReviewActions', () => ({
  default: (props: ActionsProps) => {
    mocks.actions.push(props)
    return <div>merge actions #{props.review.number}</div>
  }
}))

import { HqTodayReviews } from './HqTodayWorkspaceReviews'

function workspace(worktreeId: string, number: number): DashboardWorkspace {
  return {
    repoId: 'shop',
    worktreeId,
    repoName: 'shop',
    worktreeName: worktreeId,
    hostKind: 'local',
    executionHostId: 'local',
    workspaceKind: 'worktree',
    review: { number, state: 'open' }
  }
}

function review(provider: HostedReviewInfo['provider'], number: number): HostedReviewInfo {
  return {
    provider,
    number,
    title: `Review ${number}`,
    state: 'open',
    url: '',
    status: 'success',
    updatedAt: '',
    mergeable: 'MERGEABLE'
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.actions.length = 0
  mocks.resolved.clear()
})

describe('HqTodayReviews', () => {
  it('offers merge actions for GitHub and GitLab reviews only', () => {
    mocks.resolved.set('gh', { review: review('github', 7), githubPR: null })
    mocks.resolved.set('gl', { review: review('gitlab', 8), githubPR: null })
    mocks.resolved.set('bb', { review: review('bitbucket', 9), githubPR: null })
    render(
      <HqTodayReviews
        workspaces={[
          workspace('gh', 7),
          workspace('gl', 8),
          workspace('bb', 9),
          workspace('none', 10)
        ]}
      />
    )
    expect(screen.getByText('merge actions #7')).toBeTruthy()
    expect(screen.getByText('merge actions #8')).toBeTruthy()
    expect(screen.queryByText('merge actions #9')).toBeNull()
    expect(screen.queryByText('merge actions #10')).toBeNull()
    expect(screen.getByText('Review 7')).toBeTruthy()

    fireEvent.click(screen.getByText('shop · none'))
    expect(mocks.reveal).toHaveBeenCalledWith('none')
  })

  it('re-reads a GitHub review through the PR and the hosted review after an action', async () => {
    mocks.resolved.set('gh', { review: review('github', 7), githubPR: null })
    render(<HqTodayReviews workspaces={[workspace('gh', 7)]} />)
    await mocks.actions[0].onRefreshReview()
    expect(mocks.fetchPRForBranch).toHaveBeenCalledWith(
      '/shop',
      'gh',
      expect.objectContaining({ force: true, fallbackPRNumber: 7 })
    )
    expect(mocks.fetchHostedReviewForBranch).toHaveBeenCalledWith(
      '/shop',
      'gh',
      expect.objectContaining({ force: true, fallbackGitHubPR: 7 })
    )
  })

  it('re-reads a GitLab review without asking GitHub', async () => {
    mocks.resolved.set('gl', { review: review('gitlab', 8), githubPR: null })
    render(<HqTodayReviews workspaces={[workspace('gl', 8)]} />)
    await mocks.actions[0].onRefreshReview()
    expect(mocks.fetchPRForBranch).not.toHaveBeenCalled()
    expect(mocks.fetchHostedReviewForBranch).toHaveBeenCalledWith(
      '/shop',
      'gl',
      expect.objectContaining({ force: true })
    )
  })
})
