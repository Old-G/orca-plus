import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claudeBackgroundAdmits,
  claudeBackgroundAllows,
  createClaudeBackgroundGate,
  provideClaudeBackgroundGate,
  type ClaudeBackgroundGateDeps
} from './claude-background-gate'
import type { ProviderRateLimits } from '../../shared/agent-usage/rate-limits/rate-limit-types'

const NOW = 1_790_590_000_000
const MIN = 60_000
const RESET = NOW + 30 * 60 * MIN

function reading(
  weekly: number,
  updatedAt = NOW,
  resetsAt: number | null = RESET
): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: { usedPercent: weekly, windowMinutes: 10080, resetsAt, resetDescription: null },
    updatedAt,
    error: null,
    status: 'ok'
  }
}

function setup(initial: ProviderRateLimits | null, dir = mkdtempSync(join(tmpdir(), 'bg-gate-'))) {
  let current = initial
  let now = NOW
  const listeners = new Set<() => void>()
  const requestReading = vi.fn((_notWithinMs: number) => false)
  const deps: ClaudeBackgroundGateDeps = {
    reading: () => current,
    inactive: () => [],
    activeAccountId: () => null,
    requestReading,
    onReadingChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    now: () => now,
    statePath: join(dir, 'claude-background-pause.json'),
    logPath: join(dir, 'claude-background-pause.log'),
    testReadingPath: join(dir, 'claude-background-pause-test.json')
  }
  return {
    dir,
    deps,
    requestReading,
    gate: createClaudeBackgroundGate(deps),
    setReading: (next: ProviderRateLimits | null) => {
      current = next
      for (const listener of listeners) {
        listener()
      }
    },
    setNow: (next: number) => (now = next),
    state: () => JSON.parse(readFileSync(deps.statePath, 'utf8')),
    log: () => (existsSync(deps.logPath) ? readFileSync(deps.logPath, 'utf8') : '')
  }
}

afterEach(() => provideClaudeBackgroundGate(null))

describe('claude background gate', () => {
  it('lets jobs run under 95% and writes an unpaused state file', async () => {
    const t = setup(reading(80))
    expect(await t.gate.admits('automation «Итоги дня»')).toBe(true)
    expect(t.state()).toMatchObject({ paused: false, resumesAt: null })
    expect(t.log()).toBe('')
  })

  it('holds jobs at 95% and lets them run by themselves after the reset', async () => {
    const t = setup(reading(96))
    expect(await t.gate.admits('automation «Итоги дня»')).toBe(false)
    expect(t.gate.allows('Slack intake')).toBe(false)
    expect(t.state()).toMatchObject({ paused: true, weeklyPercent: 96, resumesAt: RESET })
    expect(t.log()).toContain('skip automation «Итоги дня»: paused 95% (weekly 96%')
    // A second skip of the same job in the same pause is not logged again.
    t.gate.allows('Slack intake')
    expect(t.log().match(/skip Slack intake/g)).toHaveLength(1)

    // No new reading: the reset time alone ends the pause.
    t.setNow(RESET + 1)
    expect(t.gate.allows('Slack intake')).toBe(true)
    expect(await t.gate.admits('automation «Итоги дня»')).toBe(true)
    expect(t.state()).toMatchObject({ paused: false })
    expect(t.log()).toContain('run Slack intake: background on again')
    expect(t.log()).toContain('run automation «Итоги дня»: background on again')
  })

  it('lets jobs run again when a fresh reading is under the line', () => {
    const t = setup(reading(97))
    expect(t.gate.allows('ClickUp triage')).toBe(false)
    t.setReading(reading(10))
    expect(t.gate.evaluate()).toBeNull()
    expect(t.gate.allows('ClickUp triage')).toBe(true)
  })

  it('asks for a new reading when the one at hand is old and decides on it', async () => {
    const t = setup(reading(50, NOW - 3 * 60 * MIN))
    t.requestReading.mockImplementation(() => {
      // The service first republishes the old numbers as «fetching», then the new reading.
      setTimeout(() => t.setReading({ ...reading(50, NOW - 3 * 60 * MIN), status: 'fetching' }), 0)
      setTimeout(() => t.setReading(reading(98)), 5)
      return true
    })
    expect(await t.gate.admits('automation «Кого ждём 18:00»')).toBe(false)
    expect(t.requestReading).toHaveBeenCalledOnce()
  })

  it('keeps a pause written before a restart until the first reading comes', () => {
    const first = setup(reading(96))
    first.gate.allows('mail intake')
    const restarted = setup(null, first.dir)
    expect(restarted.gate.allows('mail intake')).toBe(false)
    restarted.setNow(RESET + 1)
    expect(restarted.gate.allows('mail intake')).toBe(true)
  })

  it('takes the test reading file in place of the real one', () => {
    const t = setup(reading(10))
    writeFileSync(t.deps.testReadingPath!, JSON.stringify({ weeklyPercent: 96, resetsAt: RESET }))
    expect(t.gate.allows('feed posts')).toBe(false)
    writeFileSync(t.deps.testReadingPath!, JSON.stringify({ weeklyPercent: 10, resetsAt: RESET }))
    expect(t.gate.allows('feed posts')).toBe(true)
  })

  it('lets everything run before the gate is set up', async () => {
    expect(await claudeBackgroundAdmits('x')).toBe(true)
    expect(claudeBackgroundAllows('x')).toBe(true)
    const t = setup(reading(99))
    provideClaudeBackgroundGate(t.gate)
    expect(await claudeBackgroundAdmits('x')).toBe(false)
    expect(claudeBackgroundAllows('y')).toBe(false)
  })
})
