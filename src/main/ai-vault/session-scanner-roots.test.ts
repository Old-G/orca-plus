import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_VAULT_AGENT_SOURCES } from './session-scanner-agent-sources'
import { ompSessionsRootDirs } from './session-scanner-roots'

describe('claude session roots', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps an explicit root as the only host root', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/opt/claude-home')

    expect(
      AI_VAULT_AGENT_SOURCES.claude.rootDirs(
        { claudeProjectsDir: '/scan/projects', claudeProfileProjectsDirs: [] },
        []
      )
    ).toEqual(['/scan/projects'])
  })
})

describe('ompSessionsRootDirs', () => {
  it('drops a degenerate root that would resolve to the process cwd', () => {
    // A normalized empty root resolves to cwd and would allowlist arbitrary renderer-supplied paths.
    expect(ompSessionsRootDirs({ ompSessionsDir: '' })).toEqual([])
    expect(ompSessionsRootDirs({ ompSessionsDir: '   ' })).toEqual([])
  })
})

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
