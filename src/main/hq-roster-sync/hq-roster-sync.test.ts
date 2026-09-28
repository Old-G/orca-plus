import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createHqRosterSync,
  hqRosterCommitMessage,
  type HqCommandResult,
  type HqRosterSyncDeps
} from './hq-roster-sync'

const ok = (stdout = ''): HqCommandResult => ({ code: 0, stdout, stderr: '' })
const report = (fields: Record<string, unknown>): string =>
  `${JSON.stringify({ added: [], removed: [], changed: false, ...fields })}\n`

type Responder = (program: string, args: readonly string[]) => HqCommandResult

function setup(respond: Responder, overrides: Partial<HqRosterSyncDeps> = {}) {
  const calls: string[] = []
  const run = vi.fn(async (program: string, args: readonly string[]) => {
    calls.push([program, ...args.map((a) => a.replace(/^\/hq\/scripts\//, ''))].join(' '))
    return respond(program, args)
  })
  const sync = createHqRosterSync({
    hqPath: () => '/hq',
    fileExists: () => true,
    run,
    platform: 'darwin',
    log: vi.fn(),
    debounceMs: 10,
    ...overrides
  })
  return { sync, calls, run }
}

function respondWith(registryStdout: string, gitStatus = ''): Responder {
  return (program, args) => {
    if (program === 'git' && args[0] === 'status') {
      return ok(gitStatus)
    }
    if (args[0]?.endsWith('hq_registry.py')) {
      return ok(registryStdout)
    }
    return ok()
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createHqRosterSync', () => {
  it('does nothing without an HQ path', async () => {
    const { sync, run } = setup(respondWith(report({})), { hqPath: () => '  ' })
    expect(await sync.runOnce()).toBe('off')
    expect(run).not.toHaveBeenCalled()
  })

  it('skips an HQ folder without its scripts', async () => {
    const { sync, run } = setup(respondWith(report({})), { fileExists: () => false })
    expect(await sync.runOnce()).toBe('no-scripts')
    expect(run).not.toHaveBeenCalled()
  })

  it('stops after the registry when nothing changed', async () => {
    const { sync, calls } = setup(respondWith(report({ changed: false })))
    expect(await sync.runOnce()).toBe('unchanged')
    expect(calls).toEqual(['git status --porcelain', 'python3 hq_registry.py --hq /hq'])
  })

  it('syncs pages and commits when HQ was clean', async () => {
    const { sync, calls } = setup(respondWith(report({ changed: true, added: ['demo'] })))
    expect(await sync.runOnce()).toBe('committed')
    expect(calls).toEqual([
      'git status --porcelain',
      'python3 hq_registry.py --hq /hq',
      'python3 hq_sync.py --hq /hq',
      'git add -A',
      'git commit -q -m chore(registry): Orca projects added demo'
    ])
  })

  it("leaves the owner's uncommitted work alone", async () => {
    const { sync, calls } = setup(
      respondWith(report({ changed: true, removed: ['old'] }), ' M wiki/log.md\n')
    )
    expect(await sync.runOnce()).toBe('left-uncommitted')
    expect(calls).not.toContain('git add -A')
    expect(calls).toContain('python3 hq_sync.py --hq /hq')
  })

  it('keeps pages as they are when the project list could not be read', async () => {
    const { sync, calls } = setup((_program, args) =>
      args[0]?.endsWith('hq_registry.py')
        ? { code: 2, stdout: '', stderr: 'source not readable' }
        : ok()
    )
    expect(await sync.runOnce()).toBe('failed')
    expect(calls).not.toContain('python3 hq_sync.py --hq /hq')
  })

  it('uses python on Windows', async () => {
    const { sync, calls } = setup(respondWith(report({})), { platform: 'win32' })
    await sync.runOnce()
    expect(calls[1]?.startsWith('python ')).toBe(true)
  })

  it('runs once for a burst of changes', async () => {
    vi.useFakeTimers()
    const { sync, run } = setup(respondWith(report({})))
    sync.schedule()
    sync.schedule()
    sync.schedule()
    await vi.advanceTimersByTimeAsync(20)
    await sync.idle()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('runs again when a change lands during a sync', async () => {
    vi.useFakeTimers()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let registryRuns = 0
    const { sync } = setup(respondWith(report({})), {
      run: async (_program, args) => {
        if (args[0]?.endsWith('hq_registry.py')) {
          registryRuns += 1
          if (registryRuns === 1) {
            await gate
          }
          return ok(report({}))
        }
        return ok()
      }
    })
    sync.schedule()
    await vi.advanceTimersByTimeAsync(20)
    sync.schedule()
    await vi.advanceTimersByTimeAsync(20)
    release()
    await sync.idle()
    expect(registryRuns).toBe(2)
  })
})

describe('hqRosterCommitMessage', () => {
  it('names what was added and archived', () => {
    expect(hqRosterCommitMessage({ added: ['a', 'b'], removed: ['c'], changed: true })).toBe(
      'chore(registry): Orca projects added a, b; archived c'
    )
  })
})
