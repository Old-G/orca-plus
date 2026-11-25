import { describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '../../../shared/automations/history/automation-run'
import type { PersistedState } from '../../../shared/orca-profiles/persisted-state-types'
import {
  forgetAutomationRunGoogleEvents,
  GOOGLE_RUN_EVENT_KEEP_MS
} from './automation-run-google-forget'

const NOW = Date.parse('2026-11-25T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function run(
  id: string,
  status: AutomationRun['status'],
  account: string | null,
  occurredAt: number
): AutomationRun {
  return {
    id,
    automationId: 'auto',
    title: `Mail run ${id}`,
    scheduledFor: occurredAt,
    status,
    trigger: 'event',
    workspaceId: null,
    sessionKind: 'chat',
    chatSessionId: `chat-${id}`,
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    outputSnapshot: {
      format: 'plain_text',
      content: 'Reply sent',
      capturedAt: occurredAt,
      truncated: false
    },
    precheckResult: null,
    usage: null,
    error: null,
    startedAt: occurredAt,
    dispatchedAt: occurredAt,
    createdAt: occurredAt,
    event: {
      triggerId: 'rule',
      source: account ? 'gmail' : 'slack',
      event: account ? 'new_email' : 'message',
      key: account ? `gmail:${account}:${id}` : `slack:${id}`,
      occurredAt,
      actor: 'Ann <ann@acme.example>',
      place: account ? `Gmail (${account})` : '#general',
      url: 'https://mail.example/thread',
      text: 'Subject: Invoice\nPlease pay',
      ...(account ? { google: { account, ref: `gmail:thread:${id}` } } : {})
    },
    eventKeys: [`gmail:${account}:earlier`],
    triggeredBy: {
      source: account ? 'gmail' : 'slack',
      event: account ? 'new_email' : 'message',
      actor: 'Ann <ann@acme.example>',
      place: 'Gmail'
    }
  }
}

function operations(runs: AutomationRun[]) {
  return {
    state: { automationRuns: runs } as unknown as PersistedState,
    flush: vi.fn(),
    recordAutomationRunsMutation: vi.fn()
  }
}

const words = (value: unknown) => JSON.stringify(value)

describe('forgetAutomationRunGoogleEvents', () => {
  it("drops a disconnected account's mail from finished runs and the words from unfinished ones", () => {
    const ops = operations([
      run('done', 'completed', 'ann@acme.example', NOW - DAY),
      run('live', 'dispatched', 'Ann@acme.example', NOW),
      run('other', 'completed', 'bob@acme.example', NOW - DAY),
      run('slack', 'completed', null, NOW - DAY)
    ])
    expect(forgetAutomationRunGoogleEvents(ops, { account: 'ANN@acme.example' })).toBe(2)
    const [done, live, other, slack] = ops.state.automationRuns ?? []

    expect(done.event).toBeUndefined()
    expect(done.eventKeys).toBeUndefined()
    expect(done.outputSnapshot).toBeNull()
    expect(done.triggeredBy).toEqual({ source: 'gmail', event: 'new_email' })
    expect(done).toMatchObject({ id: 'done', status: 'completed', createdAt: NOW - DAY })

    // Still folds and dedupes by its key, with nothing of the mail's words left.
    expect(live.event).toEqual({
      triggerId: 'rule',
      source: 'gmail',
      event: 'new_email',
      key: 'gmail:Ann@acme.example:live',
      occurredAt: NOW,
      google: { account: 'Ann@acme.example', ref: 'gmail:thread:live' }
    })
    expect(live.triggeredBy).toEqual({ source: 'gmail', event: 'new_email' })
    expect(words(live)).not.toContain('Invoice')

    expect(other.event?.text).toContain('Invoice')
    expect(slack.event?.text).toContain('Invoice')
    expect(ops.recordAutomationRunsMutation).toHaveBeenCalledTimes(1)
    expect(ops.flush).toHaveBeenCalledTimes(1)
  })

  it('drops Google events older than 30 days from finished runs on any account', () => {
    const before = NOW - GOOGLE_RUN_EVENT_KEEP_MS
    const ops = operations([
      run('old', 'completed', 'bob@acme.example', before - 1),
      run('recent', 'completed', 'bob@acme.example', before),
      run('old-live', 'pending', 'bob@acme.example', before - DAY),
      run('old-slack', 'completed', null, before - DAY)
    ])
    expect(forgetAutomationRunGoogleEvents(ops, { before })).toBe(1)
    const [old, recent, oldLive, oldSlack] = ops.state.automationRuns ?? []
    expect(old.event).toBeUndefined()
    expect(words(old)).not.toContain('Invoice')
    expect(recent.event?.text).toContain('Invoice')
    expect(oldLive.event?.text).toContain('Invoice')
    expect(oldSlack.event?.text).toContain('Invoice')
  })

  it('forgets a run that settles after the disconnect and keeps the runs of the address back again', () => {
    const forget = { account: 'ann@acme.example', occurredBefore: NOW }
    const ops = operations([
      run('live', 'dispatched', 'ann@acme.example', NOW - 60_000),
      run('back', 'completed', 'ann@acme.example', NOW + 60_000)
    ])
    expect(forgetAutomationRunGoogleEvents(ops, forget)).toBe(1)
    // Asked again while it still runs: nothing is written.
    expect(forgetAutomationRunGoogleEvents(ops, forget)).toBe(0)
    expect(ops.flush).toHaveBeenCalledTimes(1)

    // It finishes with the mail in its output; the next ask drops the event and the output.
    const [live, back] = ops.state.automationRuns ?? []
    ops.state.automationRuns = [
      {
        ...live,
        status: 'completed',
        outputSnapshot: {
          format: 'plain_text',
          content: 'Paid the Invoice',
          capturedAt: NOW,
          truncated: false
        }
      },
      back
    ]
    expect(forgetAutomationRunGoogleEvents(ops, forget)).toBe(1)
    const [done, kept] = ops.state.automationRuns ?? []
    expect(done.event).toBeUndefined()
    expect(words(done)).not.toContain('Invoice')
    expect(kept.event?.text).toContain('Invoice')
  })

  it('writes nothing when no run matches', () => {
    const runs = [run('slack', 'completed', null, NOW - 90 * DAY)]
    const ops = operations(runs)
    expect(forgetAutomationRunGoogleEvents(ops, { before: NOW })).toBe(0)
    expect(ops.state.automationRuns).toBe(runs)
    expect(ops.flush).not.toHaveBeenCalled()
  })
})
