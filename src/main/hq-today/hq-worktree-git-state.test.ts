import { describe, expect, it, vi } from 'vitest'
import { createHqWorktreeGitStateReader, readHqWorktreeGitState } from './hq-worktree-git-state'

describe('workspace git state', () => {
  it('counts changes and commits ahead of the upstream', () => {
    expect(
      readHqWorktreeGitState('## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n')
    ).toEqual({ changes: 2, ahead: 2 })
    expect(readHqWorktreeGitState('## main...origin/main [behind 3]\n')).toEqual({
      changes: 0,
      ahead: 0
    })
    expect(readHqWorktreeGitState('## feature\n')).toEqual({ changes: 0, ahead: 0 })
  })

  it('reads each path once a minute and reports an unreadable one as null', async () => {
    let now = 0
    const status = vi.fn(async (path: string) => {
      if (path === '/gone') {
        throw new Error('not a git repository')
      }
      return '## main...origin/main [ahead 1]\n'
    })
    const read = createHqWorktreeGitStateReader({ status, now: () => now })
    expect(await read(['/a', '/gone', '/a'])).toEqual({
      '/a': { changes: 0, ahead: 1 },
      '/gone': null
    })
    await read(['/a'])
    expect(status).toHaveBeenCalledTimes(2)
    now = 61_000
    await read(['/a'])
    expect(status).toHaveBeenCalledTimes(3)
  })
})
