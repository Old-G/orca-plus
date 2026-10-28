import { describe, expect, it, vi } from 'vitest'
import { createHqGitLabRepos } from './hq-gitlab-repos'

const CONFIG = 'gitlab_groups: acme, bob\n'

function projects(group: string, from: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({ path_with_namespace: `${group}/r${from + i}` }))
}

function setup(answer: (path: string) => unknown) {
  let now = 0
  const glabJson = vi.fn(async (path: string) => {
    const result = answer(path)
    if (result instanceof Error) {
      throw result
    }
    return result
  })
  const list = createHqGitLabRepos({
    readConfig: async () => CONFIG,
    glabJson,
    now: () => now,
    warn: () => {}
  })
  return { list, glabJson, tick: (ms: number) => (now += ms) }
}

describe('GitLab repos of HQ groups', () => {
  it('reads every page of a group with more than a hundred projects', async () => {
    const { list } = setup((path) => {
      const page = Number(/[?&]page=(\d+)/.exec(path)?.[1])
      if (path.startsWith('groups/acme/')) {
        return page === 1 ? projects('acme', 0, 100) : page === 2 ? projects('acme', 100, 3) : []
      }
      return projects('bob', 0, 1)
    })
    const listing = await list()
    expect(listing.complete).toBe(true)
    expect(listing.repos).toHaveLength(104)
    expect(listing.repos).toContain('acme/r102')
  })

  it('does not keep a listing one group failed in, and says it is incomplete', async () => {
    let bobDown = true
    const { list, glabJson } = setup((path) =>
      path.startsWith('groups/bob/')
        ? bobDown
          ? new Error('502')
          : projects('bob', 0, 1)
        : projects('acme', 0, 1)
    )
    expect(await list()).toEqual({ repos: ['acme/r0'], complete: false })
    bobDown = false
    expect(await list()).toEqual({ repos: ['acme/r0', 'bob/r0'], complete: true })
    const calls = glabJson.mock.calls.length
    // Why: a whole listing is kept for an hour.
    await list()
    expect(glabJson.mock.calls.length).toBe(calls)
  })

  it('asks again after an hour', async () => {
    const { list, glabJson, tick } = setup((path) =>
      projects(path.startsWith('groups/acme/') ? 'acme' : 'bob', 0, 1)
    )
    await list()
    const calls = glabJson.mock.calls.length
    tick(60 * 60_000)
    await list()
    expect(glabJson.mock.calls.length).toBe(calls * 2)
  })
})
