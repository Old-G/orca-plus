// Custom build (hq-screen): pull and merge requests waiting on the user's review, for HQ's Today
// tab — one GitHub search and one GitLab query per known host, instead of a call per repo.
import type { HqReview, HqReviewsResult } from '../../shared/hq-project-pages'

const LIMIT = 50

export type HqReviewsDeps = {
  gh: (args: string[]) => Promise<string>
  glab: (args: string[]) => Promise<string>
  gitlabHosts: () => Promise<readonly string[]>
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.split('\n')[0]?.trim() || text
}

function text(record: object, key: string): string | null {
  const value: unknown = Reflect.get(record, key)
  return typeof value === 'string' && value ? value : null
}

function nested(record: object, key: string, inner: string): string | null {
  const value: unknown = Reflect.get(record, key)
  return typeof value === 'object' && value !== null ? text(value, inner) : null
}

function time(value: string | null): number | null {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(parsed) ? null : parsed
}

function records(stdout: string): object[] {
  const parsed: unknown = JSON.parse(stdout)
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is object => typeof entry === 'object' && entry !== null)
    : []
}

/** `gh search prs --json number,title,url,repository,author,isDraft,updatedAt`. */
export function readGithubReviews(stdout: string): HqReview[] {
  return records(stdout).flatMap((pr): HqReview[] => {
    const number: unknown = Reflect.get(pr, 'number')
    const title = text(pr, 'title')
    const url = text(pr, 'url')
    const repo = nested(pr, 'repository', 'nameWithOwner')
    if (typeof number !== 'number' || !title || !url || !repo) {
      return []
    }
    return [
      {
        provider: 'github',
        ref: `${repo}#${number}`,
        title,
        url,
        author: nested(pr, 'author', 'login'),
        draft: Reflect.get(pr, 'isDraft') === true,
        updatedAt: time(text(pr, 'updatedAt'))
      }
    ]
  })
}

/** GitLab `GET /merge_requests` records. */
export function readGitlabReviews(stdout: string): HqReview[] {
  return records(stdout).flatMap((mr): HqReview[] => {
    const title = text(mr, 'title')
    const url = text(mr, 'web_url')
    const ref = nested(mr, 'references', 'full')
    if (!title || !url || !ref) {
      return []
    }
    return [
      {
        provider: 'gitlab',
        ref,
        title,
        url,
        author: nested(mr, 'author', 'username'),
        draft: Reflect.get(mr, 'draft') === true,
        updatedAt: time(text(mr, 'updated_at'))
      }
    ]
  })
}

async function githubReviews(deps: HqReviewsDeps): Promise<HqReview[]> {
  return readGithubReviews(
    await deps.gh([
      'search',
      'prs',
      '--review-requested=@me',
      '--state=open',
      '--limit',
      String(LIMIT),
      '--json',
      'number,title,url,repository,author,isDraft,updatedAt'
    ])
  )
}

async function gitlabReviews(deps: HqReviewsDeps, host: string): Promise<HqReview[]> {
  const user: unknown = JSON.parse(await deps.glab(['api', '--hostname', host, 'user']))
  const username = typeof user === 'object' && user !== null ? text(user, 'username') : null
  if (!username) {
    throw new Error(`${host}: no signed-in user`)
  }
  const query = new URLSearchParams({
    scope: 'all',
    state: 'opened',
    reviewer_username: username,
    per_page: String(LIMIT)
  })
  return readGitlabReviews(
    await deps.glab(['api', '--hostname', host, `merge_requests?${query.toString()}`])
  )
}

export async function listHqReviews(deps: HqReviewsDeps): Promise<HqReviewsResult> {
  const hosts = await deps.gitlabHosts().catch(() => [])
  const sources: { label: string; read: () => Promise<HqReview[]> }[] = [
    { label: 'GitHub', read: () => githubReviews(deps) },
    ...hosts.map((host) => ({ label: `GitLab ${host}`, read: () => gitlabReviews(deps, host) }))
  ]
  const settled = await Promise.allSettled(sources.map((source) => source.read()))
  const reviews: HqReview[] = []
  const errors: string[] = []
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      reviews.push(...outcome.value)
    } else {
      errors.push(`${sources[index].label}: ${errorText(outcome.reason)}`)
    }
  })
  reviews.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return { reviews, errors }
}
