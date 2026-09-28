import { describe, expect, it, vi } from 'vitest'
import { readStrataStatus, type StrataStatusProbeDeps } from './strata-status-probe'

function enoent(): Error {
  return Object.assign(new Error('missing'), { code: 'ENOENT' })
}

function localDeps(present: string[]): StrataStatusProbeDeps {
  return {
    getSshFilesystem: () => undefined,
    statLocal: async (path) => {
      if (!present.some((file) => path.endsWith(file))) {
        throw enoent()
      }
    }
  }
}

const LOCAL_REPO = { path: '/work/app', connectionId: null, executionHostId: null }
const SSH_REPO = { path: '/srv/app', connectionId: 'box', executionHostId: 'ssh:box' as const }

describe('readStrataStatus', () => {
  it('reads the three files from the local project root', async () => {
    const deps = localDeps(['/work/app/WIKI.md', '/work/app/wiki/index.md'])
    expect(await readStrataStatus(LOCAL_REPO, deps)).toBe('full')
    expect(await readStrataStatus(LOCAL_REPO, localDeps(['/work/app/CLAUDE.md']))).toBe('claude-md')
    expect(await readStrataStatus(LOCAL_REPO, localDeps([]))).toBe('none')
  })

  it('treats a local read error other than ENOENT as unknown', async () => {
    const deps: StrataStatusProbeDeps = {
      getSshFilesystem: () => undefined,
      statLocal: async () => {
        throw Object.assign(new Error('denied'), { code: 'EPERM' })
      }
    }
    expect(await readStrataStatus(LOCAL_REPO, deps)).toBe('unknown')
  })

  it('asks the SSH host in one batch', async () => {
    const pathsExist = vi.fn(async (paths: string[]) =>
      paths.map((path) => ({ exists: path.endsWith('CLAUDE.md') }))
    )
    const deps: StrataStatusProbeDeps = {
      getSshFilesystem: () => ({ pathsExist, stat: vi.fn() }),
      statLocal: vi.fn()
    }
    expect(await readStrataStatus(SSH_REPO, deps)).toBe('claude-md')
    expect(pathsExist).toHaveBeenCalledWith([
      '/srv/app/WIKI.md',
      '/srv/app/wiki/index.md',
      '/srv/app/CLAUDE.md'
    ])
    expect(deps.statLocal).not.toHaveBeenCalled()
  })

  it('is unknown, never none, while the SSH host is not connected', async () => {
    const deps: StrataStatusProbeDeps = { getSshFilesystem: () => undefined, statLocal: vi.fn() }
    expect(await readStrataStatus(SSH_REPO, deps)).toBe('unknown')
    expect(deps.statLocal).not.toHaveBeenCalled()
  })

  it('is unknown when the SSH batch fails', async () => {
    const deps: StrataStatusProbeDeps = {
      getSshFilesystem: () => ({
        pathsExist: async () => {
          throw new Error('channel closed')
        },
        stat: vi.fn()
      }),
      statLocal: vi.fn()
    }
    expect(await readStrataStatus(SSH_REPO, deps)).toBe('unknown')
  })

  it('leaves a runtime-host project to that host', async () => {
    const deps = localDeps(['WIKI.md', 'wiki/index.md'])
    const repo = {
      path: '/remote/app',
      connectionId: null,
      executionHostId: 'runtime:env' as const
    }
    expect(await readStrataStatus(repo, deps)).toBe('unknown')
  })
})
