import { describe, expect, it, vi } from 'vitest'
import { hqMrChatOfBranch } from './hq-mr-chat'
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

vi.mock('../hq-project-pages/hq-project-pages', () => ({
  listHqProjectPages: async () => [{ slug: 'acme', repoId: 'repo-1' }]
}))

function setup(worktrees: { id: string; repoId: string; branch: string }[]) {
  const store = {
    getSettings: () => ({ hqPath: '/Users/me/HQ' }),
    // An SSH-hosted repo: its path exists only on the remote host, never on this desktop.
    getRepo: (id: string) =>
      id === 'repo-1'
        ? { id, path: '/home/me/acme', connectionId: 'ssh-box', executionHostId: 'ssh:ssh-box' }
        : undefined
  }
  const runtime = {
    listManagedWorktrees: vi.fn(async () => ({
      worktrees,
      totalCount: worktrees.length,
      truncated: false
    })),
    pulseListRecentSessions: () => [
      { sessionId: 'old', worktreeId: 'repo-1::/home/me/acme/fix-import', lastActivityAt: 1 },
      { sessionId: 'new', worktreeId: 'repo-1::/home/me/acme/fix-import', lastActivityAt: 2 },
      { sessionId: 'other', worktreeId: 'repo-1::/home/me/acme', lastActivityAt: 3 }
    ],
    pulseLiveSessionOf: (sessionId: string) => `${sessionId}-live`
  }
  // SAFETY: the lookup reads only the members stubbed above.
  return hqMrChatOfBranch(store as unknown as Store, runtime as unknown as OrcaRuntimeService)
}

describe('hqMrChatOfBranch', () => {
  it('finds the chat of an SSH-hosted repo through the worktrees its host lists', async () => {
    const chatOf = setup([
      { id: 'repo-1::/home/me/acme', repoId: 'repo-1', branch: 'refs/heads/main' },
      {
        id: 'repo-1::/home/me/acme/fix-import',
        repoId: 'repo-1',
        branch: 'refs/heads/fix-import'
      },
      { id: 'repo-2::/Users/me/other', repoId: 'repo-2', branch: 'refs/heads/fix-import' }
    ])
    expect(await chatOf('acme', 'fix-import')).toBe('new-live')
  })

  it('has no chat for a branch no worktree holds, or a project with no page', async () => {
    const chatOf = setup([
      { id: 'repo-1::/home/me/acme', repoId: 'repo-1', branch: 'refs/heads/main' }
    ])
    expect(await chatOf('acme', 'fix')).toBeNull()
    expect(await chatOf('unknown', 'main')).toBeNull()
  })
})
