import { describe, expect, it } from 'vitest'
import { hqWorktreeOfBranch } from './hq-mr-chat'

describe('hqWorktreeOfBranch', () => {
  it('finds the worktree on the MR branch, and nothing for a branch no worktree has', () => {
    const listed = [
      'worktree /Users/me/acme',
      'HEAD abc',
      'branch refs/heads/main',
      '',
      'worktree /Users/me/orca/workspaces/acme/fix-import',
      'HEAD def',
      'branch refs/heads/fix-import',
      ''
    ].join('\n')
    expect(hqWorktreeOfBranch(listed, 'fix-import')).toBe(
      '/Users/me/orca/workspaces/acme/fix-import'
    )
    expect(hqWorktreeOfBranch(listed, 'fix')).toBeNull()
  })
})
