import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_BACKGROUND_PAUSE_SKIP,
  owesClaudeBackgroundCatchUp,
  skipForClaudeBackgroundPause
} from './claude-background-pause-skip'
import {
  provideClaudeBackgroundGate,
  type ClaudeBackgroundGate
} from '../../claude-limit-guard/claude-background-gate'
import type { Automation } from '../../../shared/automations/automation-definition'
import type { AutomationRunWriter } from '../run-history/run-writer'
import type { AutomationRun } from '../../../shared/automations/history/automation-run'

function gate(paused: boolean): ClaudeBackgroundGate {
  return {
    current: () => null,
    evaluate: () => null,
    allows: () => !paused,
    admits: async () => !paused,
    refresh: () => {},
    note: () => {}
  }
}

function runs(repeated: boolean) {
  return {
    repeatSkip: vi.fn(async () => (repeated ? ({ id: 'old' } as never) : null)),
    createRun: vi.fn(async () => ({ id: 'run-1', status: 'pending' }) as never),
    updateRun: vi.fn(async () => ({}) as never)
  }
}

const automation = {
  id: 'a1',
  name: 'Итоги дня',
  agentId: 'claude',
  workspaceId: 'w1'
} as Automation

afterEach(() => provideClaudeBackgroundGate(null))

describe('skipForClaudeBackgroundPause', () => {
  it('runs a Claude automation while the gate lets it', async () => {
    provideClaudeBackgroundGate(gate(false))
    const writer = runs(false)
    expect(
      await skipForClaudeBackgroundPause({
        runs: writer as unknown as AutomationRunWriter,
        automation,
        scheduledFor: 1,
        isActive: () => true
      })
    ).toBe(false)
    expect(writer.createRun).not.toHaveBeenCalled()
  })

  it('skips a Claude automation in a pause and records one skipped run', async () => {
    provideClaudeBackgroundGate(gate(true))
    const writer = runs(false)
    expect(
      await skipForClaudeBackgroundPause({
        runs: writer as unknown as AutomationRunWriter,
        automation,
        scheduledFor: 1,
        isActive: () => true
      })
    ).toBe(true)
    expect(writer.updateRun).toHaveBeenCalledWith({
      runId: 'run-1',
      status: 'skipped_unavailable',
      workspaceId: 'w1',
      error: CLAUDE_BACKGROUND_PAUSE_SKIP
    })
  })

  it('folds a repeated skip into the earlier row', async () => {
    provideClaudeBackgroundGate(gate(true))
    const writer = runs(true)
    await skipForClaudeBackgroundPause({
      runs: writer as unknown as AutomationRunWriter,
      automation,
      scheduledFor: 2,
      isActive: () => true
    })
    expect(writer.createRun).not.toHaveBeenCalled()
  })

  it('leaves automations of other agents alone', async () => {
    provideClaudeBackgroundGate(gate(true))
    const writer = runs(false)
    expect(
      await skipForClaudeBackgroundPause({
        runs: writer as unknown as AutomationRunWriter,
        automation: { ...automation, agentId: 'codex' } as Automation,
        scheduledFor: 1,
        isActive: () => true
      })
    ).toBe(false)
  })

  it('gives up without writing when the scheduler stopped while the gate waited', async () => {
    provideClaudeBackgroundGate(gate(true))
    const writer = runs(false)
    await expect(
      skipForClaudeBackgroundPause({
        runs: writer as unknown as AutomationRunWriter,
        automation,
        scheduledFor: 1,
        isActive: () => false
      })
    ).rejects.toThrow()
    expect(writer.createRun).not.toHaveBeenCalled()
  })
})

describe('owesClaudeBackgroundCatchUp', () => {
  const due = { ...automation, enabled: true, nextRunAt: 10 * 60 * 60_000 } as Automation
  const row = (status: AutomationRun['status'], createdAt: number, error: string | null = null) =>
    ({
      id: `${status}-${createdAt}`,
      status,
      trigger: 'scheduled',
      createdAt,
      error
    }) as AutomationRun
  const skip = row('skipped_unavailable', 100, CLAUDE_BACKGROUND_PAUSE_SKIP)

  it('owes one run after the pause skip, still after a missed slot or a refusal', () => {
    expect(owesClaudeBackgroundCatchUp(due, () => [skip], 0)).toBe(true)
    expect(
      owesClaudeBackgroundCatchUp(
        due,
        () => [skip, row('skipped_missed', 200), row('skipped_unavailable', 300, 'No window')],
        0
      )
    ).toBe(true)
  })

  it('is settled by any run that started after the skip, also in the same millisecond', () => {
    expect(owesClaudeBackgroundCatchUp(due, () => [skip, row('dispatched', 100)], 0)).toBe(false)
    expect(owesClaudeBackgroundCatchUp(due, () => [skip, row('dispatch_failed', 200)], 0)).toBe(
      false
    )
  })

  it('leaves it to the own schedule when that is within 15 minutes', () => {
    expect(owesClaudeBackgroundCatchUp(due, () => [skip], due.nextRunAt - 10 * 60_000)).toBe(false)
  })
})
