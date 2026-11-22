import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { claudeBackgroundAdmits } from './claude-background-gate'
import { installClaudeBackgroundGate } from './claude-background-gate-host'
import type { ProviderRateLimits } from '../../shared/agent-usage/rate-limits/rate-limit-types'

function reading(weekly: number): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: {
      usedPercent: weekly,
      windowMinutes: 10080,
      resetsAt: Date.now() + 30 * 60_000,
      resetDescription: null
    },
    updatedAt: Date.now(),
    error: null,
    status: 'ok'
  }
}

function install(initial: ProviderRateLimits) {
  let current = initial
  const listeners = new Set<() => void>()
  const installed = installClaudeBackgroundGate({
    store: { getSettings: () => ({}) as never },
    rateLimits: {
      usageReading: () => current,
      inactiveClaudeAccountsNow: () => [],
      requestUsageReading: () => false,
      onStateChange: (listener) => {
        const wrapped = (): void => listener({} as never)
        listeners.add(wrapped)
        return () => listeners.delete(wrapped)
      }
    },
    userDataPath: mkdtempSync(join(tmpdir(), 'bg-gate-host-')),
    isPackaged: true
  })
  return {
    installed,
    setReading: (next: ProviderRateLimits) => {
      current = next
      for (const listener of listeners) {
        listener()
      }
    }
  }
}

vi.mock('../claude-accounts/selection/runtime-selection', () => ({
  normalizeClaudeRuntimeSelection: () => ({ host: null })
}))

let stop: (() => void) | null = null
afterEach(() => {
  stop?.()
  stop = null
})

describe('installClaudeBackgroundGate', () => {
  it('makes the shared admission check hold schedules at 95% on any host that installs it', async () => {
    const t = install(reading(96))
    stop = t.installed.stop
    expect(await claudeBackgroundAdmits('automation «Итоги дня»')).toBe(false)
    t.setReading(reading(40))
    expect(await claudeBackgroundAdmits('automation «Итоги дня»')).toBe(true)
  })

  it('removes the gate on stop, as before it was installed', async () => {
    const t = install(reading(99))
    t.installed.stop()
    expect(await claudeBackgroundAdmits('automation «Итоги дня»')).toBe(true)
  })
})
