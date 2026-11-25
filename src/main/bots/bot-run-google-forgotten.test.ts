// Custom build (google-send-again-memory-30d): Send again never replays a Google event run history forgot.
import { describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '../../shared/automations/history/automation-run'
import type { PersistedState } from '../../shared/orca-profiles/persisted-state-types'
import {
  forgetAutomationRunGoogleEvents,
  GOOGLE_RUN_EVENT_KEEP_MS
} from '../persistence/scheduling-automations/automation-run-google-forget'
import { sendRunAgain } from '../runtime/rpc/methods/bots-run-send-again'
import { RUN_GOOGLE_EVENT_FORGOTTEN, runGoogleEventForgotten } from './bot-run-google-forgotten'

const NOW = Date.parse('2026-11-25T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const ACCOUNT = 'ann@acme.example'

function storedRun(occurredAt: number, source: 'gmail' | 'slack' = 'gmail'): AutomationRun {
  return {
    id: 'run-1',
    automationId: 'auto',
    title: 'Mail run',
    scheduledFor: occurredAt,
    status: 'failed',
    trigger: 'event',
    workspaceId: null,
    sessionKind: 'chat',
    chatSessionId: null,
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    outputSnapshot: null,
    precheckResult: null,
    usage: null,
    error: 'Bot was busy',
    startedAt: null,
    dispatchedAt: null,
    createdAt: occurredAt,
    event: {
      triggerId: 'rule',
      source,
      event: source === 'gmail' ? 'new_email' : 'message',
      key: `${source}:run-1`,
      occurredAt,
      actor: 'Bob <bob@acme.example>',
      text: 'Subject: Invoice\nPlease pay',
      ...(source === 'gmail' ? { google: { account: ACCOUNT, ref: 'gmail:thread:1' } } : {})
    },
    triggeredBy: { source, event: source === 'gmail' ? 'new_email' : 'message' }
  } as AutomationRun
}

/** The not-started card Send again reads, made from the run as it was delivered. */
function card(run: AutomationRun) {
  return {
    kind: 'automation-run-not-started',
    run: {
      runId: run.id,
      automation: { id: run.automationId, name: 'Mail helper', bot: { botId: 'bot-1' } },
      trigger: 'event',
      instructionsLength: 0,
      event: {
        source: run.event!.source,
        event: run.event!.event,
        occurredAt: run.event!.occurredAt,
        text: run.event!.text
      }
    },
    actsFor: [],
    error: 'Bot was busy',
    text: 'Subject: Invoice\nPlease pay',
    at: run.createdAt
  }
}

function resend(history: AutomationRun[], body: ReturnType<typeof card>) {
  const claim = vi.fn(() => true)
  const send = vi.fn(async () => ({ sessionId: 'chat-1' }))
  const host = {
    conversation: async () => ({
      journal: {
        reads: { runMentions: async () => ({ items: [{ body }], sent: [] }) },
        queuedMessages: { list: async () => [] }
      }
    })
  }
  const result = sendRunAgain(
    {
      host: host as never,
      claim,
      send,
      googleEventForgotten: (run) =>
        runGoogleEventForgotten(
          run,
          history.find((entry) => entry.id === run.runId),
          NOW
        )
    },
    { botId: 'bot-1', sessionId: 'chat-1', runId: 'run-1' }
  )
  return { result, claim, send }
}

function forget(run: AutomationRun, how: Parameters<typeof forgetAutomationRunGoogleEvents>[1]) {
  const operations = {
    state: { automationRuns: [run] } as unknown as PersistedState,
    flush: vi.fn()
  }
  forgetAutomationRunGoogleEvents(operations, how)
  return operations.state.automationRuns ?? []
}

describe('Send again on a Google run', () => {
  it('sends a fresh Gmail run again', async () => {
    const run = storedRun(NOW - DAY)
    const { result, send } = resend([run], card(run))
    await expect(result).resolves.toEqual({ sessionId: 'chat-1' })
    expect(send).toHaveBeenCalledOnce()
  })

  it('refuses, without the mail and without spending the run, once its account was disconnected', async () => {
    const run = storedRun(NOW - DAY)
    const history = forget(run, { account: ACCOUNT, occurredBefore: NOW })
    const { result, claim, send } = resend(history, card(run))
    await expect(result).rejects.toThrow(RUN_GOOGLE_EVENT_FORGOTTEN)
    expect(RUN_GOOGLE_EVENT_FORGOTTEN).not.toContain('Invoice')
    expect(claim).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses an unfinished run whose meeting place went at a disconnect', async () => {
    const run = { ...storedRun(NOW - DAY), status: 'running' } as AutomationRun
    const { text: _text, ...event } = run.event!
    const quiet = forget(
      { ...run, event: { ...event, place: 'Room 4' } },
      {
        account: ACCOUNT,
        occurredBefore: NOW
      }
    )
    const body = card(run)
    const { text: _cardText, ...cardEvent } = body.run.event
    const { result, send } = resend(quiet, {
      ...body,
      run: { ...body.run, event: { ...cardEvent, place: 'Room 4' } }
    } as ReturnType<typeof card>)
    await expect(result).rejects.toThrow(RUN_GOOGLE_EVENT_FORGOTTEN)
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses a Gmail run past 30 days, swept or not yet', async () => {
    const run = storedRun(NOW - GOOGLE_RUN_EVENT_KEEP_MS - 1)
    const swept = forget(run, { before: NOW - GOOGLE_RUN_EVENT_KEEP_MS })
    for (const history of [swept, [run]]) {
      const { result, send } = resend(history, card(run))
      await expect(result).rejects.toThrow(RUN_GOOGLE_EVENT_FORGOTTEN)
      expect(send).not.toHaveBeenCalled()
    }
  })

  it('leaves other sources as they were', async () => {
    const run = storedRun(NOW - 60 * DAY, 'slack')
    const { result, send } = resend([], card(run))
    await expect(result).resolves.toEqual({ sessionId: 'chat-1' })
    expect(send).toHaveBeenCalledOnce()
  })
})
