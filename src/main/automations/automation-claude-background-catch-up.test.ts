import { closeTestStores, createStore, testState } from '../persistence/persistence-test-harness'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startedAutomationService, tickAt } from './testing/automation-service-tick.test-fixture'
import {
  provideClaudeBackgroundGate,
  type ClaudeBackgroundGate
} from '../claude-limit-guard/claude-background-gate'
import { CLAUDE_BACKGROUND_PAUSE_SKIP } from './dispatch/claude-background-pause-skip'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

const LAUNCHED = { workspaceId: 'wt1', terminalSessionId: 'tab-1' }

const daily = (name: string, hour: number) => ({
  name,
  prompt: 'Summarise the day',
  agentId: 'claude' as const,
  projectId: 'r1',
  workspaceMode: 'existing' as const,
  workspaceId: 'wt1',
  timezone: 'UTC',
  rrule: `FREQ=DAILY;BYHOUR=${hour};BYMINUTE=0`,
  dtstart: new Date('2026-05-12T00:00:00').getTime()
})

let paused = false
const notes: string[] = []
const gate: ClaudeBackgroundGate = {
  current: () => null,
  evaluate: () => null,
  allows: () => !paused,
  admits: async () => !paused,
  refresh: () => {},
  note: (line) => notes.push(line)
}

async function setup() {
  const store = await createStore()
  store.addRepo({ id: 'r1', path: '/repo', displayName: 'test', badgeColor: '#fff', addedAt: 1 })
  const launch = vi.fn(async () => LAUNCHED)
  return { store, launch }
}

describe('catch-up after the Claude background pause', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-automations-catch-up-'))
    vi.useFakeTimers()
    paused = false
    notes.length = 0
    provideClaudeBackgroundGate(gate)
  })

  afterEach(async () => {
    provideClaudeBackgroundGate(null)
    await closeTestStores()
    vi.useRealTimers()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('runs an automation skipped on several days once after the pause, and nothing it did not skip', async () => {
    vi.setSystemTime(new Date('2026-05-13T08:00:00'))
    const { store, launch } = await setup()
    const skipped = store.createAutomation(daily('Evening summary', 9))
    const service = startedAutomationService(store, launch)

    paused = true
    await tickAt('2026-05-13T09:01:00')
    await tickAt('2026-05-14T09:01:00')
    const skips = store.listAutomationRuns(skipped.id)
    expect(skips).toHaveLength(1)
    expect(skips[0]).toMatchObject({
      status: 'skipped_unavailable',
      error: CLAUDE_BACKGROUND_PAUSE_SKIP,
      occurrenceCount: 2
    })
    expect(launch).not.toHaveBeenCalled()

    paused = false
    const untouched = store.createAutomation(daily('Late summary', 22))
    await tickAt('2026-05-14T12:00:00')
    await tickAt('2026-05-14T12:01:00')
    await tickAt('2026-05-14T12:02:00')
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
    expect(store.listAutomationRuns(skipped.id)).toHaveLength(2)
    expect(store.listAutomationRuns(untouched.id)).toHaveLength(0)
    expect(notes).toEqual([
      'catch up automation «Evening summary»: one run for what the pause skipped'
    ])
    service.stop()
  })

  it('stays owed while the pause holds and leaves the catch-up to a run due within 15 minutes', async () => {
    vi.setSystemTime(new Date('2026-05-13T08:00:00'))
    const { store, launch } = await setup()
    const automation = store.createAutomation(daily('Morning digest', 9))
    const service = startedAutomationService(store, launch)

    paused = true
    await tickAt('2026-05-13T09:01:00')
    await tickAt('2026-05-13T15:00:00')
    expect(launch).not.toHaveBeenCalled()

    // The pause ends at 08:50 next day: the 09:00 run is the one catch-up.
    paused = false
    await tickAt('2026-05-14T08:50:00')
    expect(launch).not.toHaveBeenCalled()
    await tickAt('2026-05-14T09:01:00')
    await tickAt('2026-05-14T09:02:00')
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
    expect(store.listAutomationRuns(automation.id)).toHaveLength(2)
    expect(notes).toEqual([])
    service.stop()
  })

  it('takes a manual run after the skip as the catch-up', async () => {
    vi.setSystemTime(new Date('2026-05-13T08:00:00'))
    const { store, launch } = await setup()
    const automation = store.createAutomation(daily('Weekly report', 9))
    const service = startedAutomationService(store, launch)

    paused = true
    await tickAt('2026-05-13T09:01:00')
    paused = false
    await service.runNow(automation.id)
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
    await tickAt('2026-05-13T12:00:00')
    await tickAt('2026-05-13T12:01:00')
    expect(launch).toHaveBeenCalledTimes(1)
    service.stop()
  })
})
