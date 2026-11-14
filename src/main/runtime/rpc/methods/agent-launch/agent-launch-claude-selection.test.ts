import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HQ_CHAT_ROLE_SESSION_OPTION } from '../../../../../shared/hq-chat-role'
import { DESKTOP_RPC_CALLER, LOCAL_CLI_RPC_CALLER } from '../../callers/rpc-caller-identity'
import type { RpcContext } from '../../core'
import { agentLaunchClaudeSelection } from './agent-launch-claude-selection'

const created = vi.hoisted(() => vi.fn())
vi.mock('../structured-sessions/creation/structured-agent-session-create', () => ({
  createStructuredAgentSessionForWorktree: created
}))

const { agentLaunchSurfaceFactory } = await import('./agent-launch-surfaces')

const PHONE = { kind: 'paired-device', deviceId: 'phone-1' } as const

function pick(
  caller: RpcContext['caller'],
  named: Record<string, string> = {},
  launchOptions: Record<string, unknown> = named,
  agent = 'claude'
) {
  return agentLaunchClaudeSelection({ agent, caller, named, launchOptions })
}

describe('a Claude chat an agent or Orca+ starts (chat-default-model)', () => {
  it('runs Opus when `orca agent launch` names no model, whatever the window last picked', () => {
    expect(pick(LOCAL_CLI_RPC_CALLER)).toEqual({
      options: { model: 'opus' },
      replacesSavedSelection: true
    })
  })

  it('runs Opus for a launch Orca+ makes itself: a handoff, the dispatcher', () => {
    expect(pick(undefined)).toEqual({ options: { model: 'opus' }, replacesSavedSelection: true })
  })

  it("starts a lead, a sub-lead and a reviewer at their role's effort, a worker at the CLI's own", () => {
    for (const role of ['lead', 'sublead', 'review']) {
      expect(
        pick(LOCAL_CLI_RPC_CALLER, {}, { [HQ_CHAT_ROLE_SESSION_OPTION]: role }).options
      ).toEqual({ model: 'opus', effort: 'medium' })
    }
    expect(
      pick(LOCAL_CLI_RPC_CALLER, {}, { [HQ_CHAT_ROLE_SESSION_OPTION]: 'worker' }).options
    ).toEqual({ model: 'opus' })
  })

  it('keeps the effort named for the launch over the role, on Opus', () => {
    expect(
      pick(
        LOCAL_CLI_RPC_CALLER,
        { effort: 'high' },
        { effort: 'high', [HQ_CHAT_ROLE_SESSION_OPTION]: 'lead' }
      )
    ).toEqual({ options: { model: 'opus', effort: 'high' }, replacesSavedSelection: true })
  })

  it('runs the model named for the launch, Fable too, with nothing added from the window or the role', () => {
    expect(
      pick(LOCAL_CLI_RPC_CALLER, { model: 'fable' }, { [HQ_CHAT_ROLE_SESSION_OPTION]: 'lead' })
    ).toEqual({ options: { model: 'fable' }, replacesSavedSelection: true })
    expect(pick(LOCAL_CLI_RPC_CALLER, { model: 'fable', effort: 'xhigh' }).options).toEqual({
      model: 'fable',
      effort: 'xhigh'
    })
  })

  it('leaves a person at a window or a phone, and every other agent, as they were', () => {
    const named = {}
    for (const caller of [DESKTOP_RPC_CALLER, PHONE]) {
      expect(pick(caller, named)).toEqual({ options: named, replacesSavedSelection: false })
    }
    expect(pick(LOCAL_CLI_RPC_CALLER, named, named, 'codex')).toEqual({
      options: named,
      replacesSavedSelection: false
    })
  })
})

describe('the chat create a launch asks for (chat-default-model)', () => {
  beforeEach(() => {
    created.mockReset()
    created.mockResolvedValue({
      ok: true,
      value: { sessionId: 'claude_1', fence: { runtimeId: 'r', epoch: 1 } }
    })
  })

  function context(caller: RpcContext['caller']): RpcContext {
    const runtime = { pulseChats: () => ({ setRole: vi.fn() }) }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the create is mocked, so only the role store is reached.
    return { runtime, ...(caller ? { caller } : {}) } as unknown as RpcContext
  }

  async function createWith(
    caller: RpcContext['caller'],
    extra: { options?: Record<string, unknown>; chatOptions?: Record<string, string> } = {}
  ) {
    await agentLaunchSurfaceFactory(context(caller)).createStructuredSession({
      worktreeId: 'wt-1',
      agent: 'claude',
      ...extra
    })
    return created.mock.calls[0]?.[0] as { options?: unknown; optionsMode?: unknown }
  }

  it('asks for Opus in place of the saved selection when the CLI names no model', async () => {
    const asked = await createWith(LOCAL_CLI_RPC_CALLER)
    expect(asked.options).toEqual({ model: 'opus' })
    expect(asked.optionsMode).toBe('replace-model-selection')
  })

  it('asks for Opus at medium for a lead, and keeps the role out of the chat options', async () => {
    const asked = await createWith(LOCAL_CLI_RPC_CALLER, {
      options: { [HQ_CHAT_ROLE_SESSION_OPTION]: 'lead' }
    })
    expect(asked.options).toEqual({ model: 'opus', effort: 'medium' })
    expect(asked.optionsMode).toBe('replace-model-selection')
  })

  it('asks for Fable when `--model fable` names it', async () => {
    const asked = await createWith(LOCAL_CLI_RPC_CALLER, {
      options: { model: 'fable', effort: 'high' }
    })
    expect(asked.options).toEqual({ model: 'fable', effort: 'high' })
    expect(asked.optionsMode).toBe('replace-model-selection')
  })

  it("asks for nothing of its own from a window, so the window's selection seeds the chat", async () => {
    const asked = await createWith(DESKTOP_RPC_CALLER)
    expect(asked).not.toHaveProperty('options')
    expect(asked).not.toHaveProperty('optionsMode')
  })

  it('passes chat options a caller set for the chat (an automation) through untouched', async () => {
    const asked = await createWith(undefined, { chatOptions: { effort: 'low' } })
    expect(asked.options).toEqual({ effort: 'low' })
    expect(asked).not.toHaveProperty('optionsMode')
  })
})
