import { describe, expect, it, vi } from 'vitest'
import { listHqReviews, readGithubReviews, readGitlabReviews } from './hq-reviews'

const GH = JSON.stringify([
  {
    number: 12,
    title: 'Fix cart',
    url: 'https://github.com/acme/shop/pull/12',
    repository: { nameWithOwner: 'acme/shop' },
    author: { login: 'ann' },
    isDraft: false,
    updatedAt: '2026-10-02T10:00:00Z'
  },
  { number: 'x', title: 'broken' }
])

const GL = JSON.stringify([
  {
    title: 'Add route',
    web_url: 'https://gitlab.com/team/api/-/merge_requests/34',
    references: { full: 'team/api!34' },
    author: { username: 'bob' },
    draft: true,
    updated_at: '2026-10-03T08:00:00Z'
  }
])

describe('HQ reviews', () => {
  it('reads GitHub and GitLab answers, dropping records that do not fit', () => {
    expect(readGithubReviews(GH)).toEqual([
      {
        provider: 'github',
        ref: 'acme/shop#12',
        title: 'Fix cart',
        url: 'https://github.com/acme/shop/pull/12',
        author: 'ann',
        draft: false,
        updatedAt: Date.parse('2026-10-02T10:00:00Z')
      }
    ])
    expect(readGitlabReviews(GL)).toEqual([
      expect.objectContaining({
        provider: 'gitlab',
        ref: 'team/api!34',
        author: 'bob',
        draft: true
      })
    ])
  })

  it('asks GitHub once and each GitLab host for its reviewer, newest first', async () => {
    const glab = vi.fn(async (args: string[]) =>
      args.at(-1) === 'user' ? JSON.stringify({ username: 'gleb' }) : GL
    )
    const gh = vi.fn(async (_args: string[]) => GH)
    const result = await listHqReviews({ gh, glab, gitlabHosts: async () => ['gitlab.com'] })
    expect(result.reviews.map((review) => review.ref)).toEqual(['team/api!34', 'acme/shop#12'])
    expect(result.errors).toEqual([])
    expect(gh.mock.calls[0][0]).toContain('--review-requested=@me')
    expect(glab.mock.calls[1][0].at(-1)).toContain('reviewer_username=gleb')
    expect(glab.mock.calls[1][0]).toContain('--hostname')
  })

  it('keeps one source’s reviews when another fails', async () => {
    const result = await listHqReviews({
      gh: async () => {
        throw new Error('gh: not logged in\nmore')
      },
      glab: async (args) => (args.at(-1) === 'user' ? JSON.stringify({ username: 'g' }) : GL),
      gitlabHosts: async () => ['gitlab.com']
    })
    expect(result.reviews.map((review) => review.ref)).toEqual(['team/api!34'])
    expect(result.errors).toEqual(['GitHub: gh: not logged in'])
  })
})
