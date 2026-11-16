import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { catchUpHeldLaunchdJobs } from './claude-background-launchd-catch-up'

let heldDir = ''

function hold(job: string, label: unknown): void {
  writeFileSync(join(heldDir, job), JSON.stringify({ label }))
}

describe('catchUpHeldLaunchdJobs', () => {
  beforeEach(() => {
    heldDir = join(mkdtempSync(join(tmpdir(), 'claude-held-')), 'held')
    mkdirSync(heldDir)
  })

  afterEach(() => {
    rmSync(join(heldDir, '..'), { recursive: true, force: true })
  })

  it('starts each held launchd job once and only those', async () => {
    hold('tone-rollup', 'com.example.tone-rollup')
    hold('triage-rollup', 'com.example.triage-rollup')
    const kick = vi.fn(async (_label: string) => {})
    const log = vi.fn()

    await catchUpHeldLaunchdJobs({ heldDir, kick, log })
    await catchUpHeldLaunchdJobs({ heldDir, kick, log })

    expect(kick.mock.calls.map(([label]) => label).sort()).toEqual([
      'com.example.tone-rollup',
      'com.example.triage-rollup'
    ])
    expect(existsSync(join(heldDir, 'tone-rollup'))).toBe(false)
    expect(log).toHaveBeenCalledWith(
      'catch up tone-rollup: one run for what the pause skipped (launchd com.example.tone-rollup)'
    )
  })

  it('runs one pass when two triggers arrive together', async () => {
    hold('tone-rollup', 'com.example.tone-rollup')
    const kick = vi.fn(async () => {})
    await Promise.all([
      catchUpHeldLaunchdJobs({ heldDir, kick, log: () => {} }),
      catchUpHeldLaunchdJobs({ heldDir, kick, log: () => {} })
    ])
    expect(kick).toHaveBeenCalledTimes(1)
  })

  it('leaves a job held by hand or by cron to its own next run', async () => {
    hold('slack-scout', null)
    hold('odd', 'not a label; rm -rf')
    const kick = vi.fn(async () => {})

    await catchUpHeldLaunchdJobs({ heldDir, kick, log: () => {} })

    expect(kick).not.toHaveBeenCalled()
    expect(existsSync(join(heldDir, 'slack-scout'))).toBe(true)
  })

  it('logs a job launchd would not start and does not retry it', async () => {
    hold('tone-rollup', 'com.example.gone')
    const kick = vi.fn(async () => {
      throw new Error('Could not find service')
    })
    const log = vi.fn()

    await catchUpHeldLaunchdJobs({ heldDir, kick, log })
    await catchUpHeldLaunchdJobs({ heldDir, kick, log })

    expect(kick).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toMatch(
      /^catch up tone-rollup: launchd com\.example\.gone did not start/
    )
  })

  it('does nothing without a held folder', async () => {
    const kick = vi.fn(async () => {})
    await catchUpHeldLaunchdJobs({ heldDir: join(heldDir, 'missing'), kick, log: () => {} })
    expect(kick).not.toHaveBeenCalled()
  })
})
