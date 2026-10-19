import { describe, expect, it } from 'vitest'

// Custom build (ai-vault-linked-roots): an account folder links its `projects` to the shared tree.
describe('uniqueDirs', () => {
  it('reads a tree reached through a link once, under its first spelling', async () => {
    const { mkdtemp, mkdir, rm, symlink } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { uniqueDirs } = await import('./session-scanner-roots')
    const root = await mkdtemp(join(tmpdir(), 'orca-roots-'))
    try {
      const shared = join(root, 'claude', 'projects')
      const account = join(root, 'account')
      await mkdir(shared, { recursive: true })
      await mkdir(account, { recursive: true })
      await symlink(shared, join(account, 'projects'))
      expect(
        uniqueDirs([
          join(account, 'projects'),
          shared,
          join(root, 'missing'),
          join(root, 'missing')
        ])
      ).toEqual([join(account, 'projects'), join(root, 'missing')])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
