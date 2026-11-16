import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_BACKGROUND_PAUSE_SKIP,
  skipForClaudeBackgroundPause
} from './claude-background-pause-skip'
import {
  provideClaudeBackgroundGate,
  type ClaudeBackgroundGate
} from '../../claude-limit-guard/claude-background-gate'
import type { Automation } from '../../../shared/automations/automation-definition'
import type { AutomationRunWriter } from '../run-history/run-writer'

function gate(paused: boolean): ClaudeBackgroundGate {
  return {
    current: () => null,
    evaluate: () => null,
    allows: () => !paused,
    admits: async () => !paused,
    refresh: () => {}
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
