import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BRACKETED_PASTE_BEGIN, BRACKETED_PASTE_END } from '@/lib/agent-paste-draft'
import type { HqPlusChatTarget } from './hq-plus-actions'

const callRuntimeRpc = vi.fn()
const hqPlusCall = vi.fn()

vi.mock('@/runtime/runtime-rpc-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callRuntimeRpc: (...args: unknown[]) => callRuntimeRpc(...args)
}))
vi.mock('./use-hq-plus-data', () => ({
  hqPlusCall: (...args: unknown[]) => hqPlusCall(...args)
}))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ terminalLayoutsByTabId: {} }) }
}))

const { sendIntoHqPlusChat } = await import('./hq-plus-actions')

const PANE_KEY = 'tab-run:11111111-1111-4111-8111-111111111111'
const target: HqPlusChatTarget = {
  address: null,
  sessionId: null,
  replyTo: null,
  about: null,
  pane: { paneKey: PANE_KEY, tabId: null, worktreeId: null }
}

function runtimeSees(running: boolean): void {
  callRuntimeRpc.mockImplementation(async (_target: unknown, method: string) => {
    if (method === 'terminal.agentStatus') {
      return { agentStatus: { isRunningAgent: running, status: running ? 'idle' : null } }
    }
    if (method === 'terminal.send') {
      // Like the runtime: a guarded send to a terminal with no agent is refused, nothing written.
      return running
        ? { send: { handle: 'term-1', accepted: true, bytesWritten: 1 } }
        : {
            send: { handle: 'term-1', accepted: false, bytesWritten: 0, refusedReason: 'no-agent' }
          }
    }
    throw new Error(`unexpected ${method}`)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  callRuntimeRpc.mockReset()
  hqPlusCall.mockReset()
  hqPlusCall.mockImplementation(async (method: string) =>
    method === 'terminal.list'
      ? { ok: true, result: { terminals: [{ handle: 'term-1', recordedPaneKey: PANE_KEY }] } }
      : { ok: false, message: `unexpected ${method}` }
  )
})

/** Sends that would reach the terminal without the runtime's agent check. */
const unguardedSends = (): number =>
  callRuntimeRpc.mock.calls.filter(
    ([, method, params]) => method === 'terminal.send' && params?.requireAgentStatus !== 'sendable'
  ).length + hqPlusCall.mock.calls.filter(([method]) => method === 'terminal.send').length

describe('an answer into an automation run held by the runtime', () => {
  it('sends nothing to a terminal whose agent has exited — the shell would run the words', async () => {
    runtimeSees(false)
    const result = await sendIntoHqPlusChat(target, 'line one\ngit push', null)
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/exited/) })
    expect(unguardedSends()).toBe(0)
  })

  it('pastes into a running agent behind the agent guard, then submits separately', async () => {
    runtimeSees(true)
    expect(await sendIntoHqPlusChat(target, 'line one\nline two', null)).toEqual({ ok: true })
    const sent = callRuntimeRpc.mock.calls
      .filter(([, method]) => method === 'terminal.send')
      .map(([, , params]) => params)
    expect(sent).toEqual([
      expect.objectContaining({ terminal: 'term-1', requireAgentStatus: 'sendable' }),
      expect.objectContaining({ terminal: 'term-1', enter: true, requireAgentStatus: 'sendable' })
    ])
    const pasted = String(sent[0].text)
    expect(pasted.startsWith(BRACKETED_PASTE_BEGIN) && pasted.endsWith(BRACKETED_PASTE_END)).toBe(
      true
    )
    expect(pasted).toContain('line two')
    expect(sent[0].enter).toBeUndefined()
    expect(unguardedSends()).toBe(0)
  })
})
