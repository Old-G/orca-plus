import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../runtime-client', () => ({
  RuntimeClientError: class RuntimeClientError extends Error {
    readonly code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }
}))

vi.mock('../selectors', () => ({
  getRequiredWorktreeSelector: vi.fn(async (flags: Map<string, string | boolean>) => {
    const value = flags.get('worktree')
    if (typeof value !== 'string') {
      throw new Error('Missing required --worktree')
    }
    return value === 'active' ? 'id:repo-1::/repo' : value
  })
}))

import { AGENT_LAUNCH_HANDLERS, formatAgentLaunch } from './agent-launch'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'
import type { AgentLaunchResult } from '../../shared/agent-launch-intent'

const structuredResult: AgentLaunchResult = {
  outcome: { kind: 'structured', sessionId: 'claude-session-1', handle: 'chat_1' },
  worktreeId: 'repo-1::/repo',
  receipt: {
    mode: 'structured',
    preferred: 'structured',
    reason: 'user_default',
    detail: 'Opened as a chat, your default.'
  },
  prompt: { delivery: 'submit', outcome: 'journaled', messageId: 'm1' }
}

const callMock = vi.fn()
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only calls `call`.
const client = { call: callMock } as unknown as RuntimeClient

function run(flags: Record<string, string | boolean>, json = false): Promise<void> {
  return AGENT_LAUNCH_HANDLERS['agent launch']({
    flags: new Map(Object.entries(flags)),
    client,
    cwd: '/repo',
    json
  })
}

describe('orca agent launch', () => {
  beforeEach(() => {
    callMock.mockReset()
    logSpy.mockClear()
  })

  it('sends agent.launch for an existing worktree and submits the prompt', async () => {
    callMock.mockResolvedValue({ ok: true, result: structuredResult })

    await run({ worktree: 'active', agent: 'claude', prompt: 'Continue' })

    expect(callMock).toHaveBeenCalledWith(
      'agent.launch',
      {
        agent: 'claude',
        target: { kind: 'existing', worktree: 'id:repo-1::/repo' },
        prompt: { text: 'Continue', delivery: 'submit' }
      },
      { timeoutMs: 120_000 }
    )
    expect(logSpy.mock.calls[0]?.[0]).toContain('native chat (session claude-session-1)')
  })

  it('names no mode and omits the prompt when none is given', async () => {
    callMock.mockResolvedValue({ ok: true, result: structuredResult })

    await run({ worktree: 'id:repo-1::/repo', agent: 'claude' })

    const params = callMock.mock.calls[0]?.[1]
    expect(params).not.toHaveProperty('prompt')
    expect(Object.keys(params)).toEqual(['agent', 'target'])
  })

  it('refuses an unknown agent before calling the runtime', async () => {
    await expect(run({ worktree: 'active', agent: 'not-an-agent' })).rejects.toThrow(
      'Unknown agent'
    )
    expect(callMock).not.toHaveBeenCalled()
  })

  it('warns that a timed-out launch may already be running', async () => {
    callMock.mockRejectedValue(new RuntimeClientError('runtime_timeout', 'timed out'))

    await expect(run({ worktree: 'active', agent: 'claude' })).rejects.toThrow(
      'the agent may already be running'
    )
  })

  it('says why a launch fell back to a terminal', () => {
    const text = formatAgentLaunch({
      outcome: { kind: 'terminal', handle: 'term_1', paneKey: 'tab:leaf' },
      worktreeId: 'repo-1::/repo',
      receipt: {
        mode: 'terminal',
        preferred: 'structured',
        reason: 'remote_execution_host',
        detail: 'Chats run only on this computer.'
      }
    })
    expect(text).toContain('Started terminal term_1')
    expect(text).toContain('Mode: terminal (default structured, remote_execution_host)')
  })
})
