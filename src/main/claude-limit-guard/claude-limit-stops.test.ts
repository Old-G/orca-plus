import { describe, expect, it, vi } from 'vitest'
import {
  createClaudeLimitStops,
  isClaudeAuthStopFrame,
  isClaudeLimitStopFrame
} from './claude-limit-stops'
import type { ProviderRateLimits } from '../../shared/agent-usage/rate-limits/rate-limit-types'
import type { ClaudeLimitStoppedAgent } from '../../shared/claude-limit-guard'

const PANE = 'tab-1:leaf-1'

function setup(
  active: { id: string | null } = { id: 'lh' },
  handedOff: (stop: ClaudeLimitStoppedAgent) => boolean = () => false,
  subscriptionOf: (sessionId: string) => string | null = () => null
) {
  let now = 1_000_000
  const resumeTerminal = vi.fn(async () => true)
  const resumeNativeChat = vi.fn(async () => true)
  const onChanged = vi.fn()
  const checkHandoff = vi.fn(async (stop: ClaudeLimitStoppedAgent) => handedOff(stop))
  const stops = createClaudeLimitStops({
    now: () => now,
    activeAccountId: () => active.id,
    resumeTerminal,
    resumeNativeChat,
    onChanged,
    checkHandoff,
    nativeChatSubscription: subscriptionOf
  })
  return {
    stops,
    resumeTerminal,
    resumeNativeChat,
    onChanged,
    checkHandoff,
    advance: (ms: number) => {
      now += ms
    }
  }
}

function usage(session: number, weekly = 10): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent: session, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: { usedPercent: weekly, windowMinutes: 10080, resetsAt: null, resetDescription: null },
    updatedAt: 0,
    error: null,
    status: 'ok'
  }
}

const limitStop = {
  paneKey: PANE,
  source: 'claude',
  worktreeId: 'repo::/wt',
  hookEventName: 'StopFailure',
  stopFailureError: 'rate_limit'
}

describe('claude limit stops', () => {
  it('records only lead-agent rate-limit stops from Claude hooks', () => {
    const { stops } = setup()
    stops.onHookStatus({ ...limitStop, stopFailureError: 'server_error' })
    stops.onHookStatus({ ...limitStop, toolAgentId: 'child' })
    stops.onHookStatus({ ...limitStop, isReplay: true })
    stops.onHookStatus({ ...limitStop, source: 'codex' })
    expect(stops.list()).toEqual([])
    stops.onHookStatus(limitStop)
    expect(stops.list()).toEqual([
      expect.objectContaining({
        kind: 'terminal',
        key: PANE,
        accountId: 'lh',
        worktreeId: 'repo::/wt'
      })
    ])
  })

  it('forgets a pane the user resumed by hand', () => {
    const { stops } = setup()
    stops.onHookStatus(limitStop)
    stops.onHookStatus({ paneKey: PANE, source: 'claude', hookEventName: 'UserPromptSubmit' })
    expect(stops.list()).toEqual([])
  })

  it('nudges only agents stopped on another account after a switch', async () => {
    const active: { id: string | null } = { id: 'lh' }
    const { stops, resumeTerminal, resumeNativeChat } = setup(active)
    stops.onHookStatus(limitStop)
    stops.onNativeFrame('session-1', 'repo::/wt', { type: 'assistant', error: 'rate_limit' })
    active.id = 'personal'
    stops.onHookStatus({ ...limitStop, paneKey: 'tab-2:leaf-1' })

    await stops.onAccountChanged('personal')

    expect(resumeTerminal).toHaveBeenCalledTimes(1)
    expect(resumeTerminal).toHaveBeenCalledWith(PANE)
    expect(resumeNativeChat).toHaveBeenCalledWith('session-1')
    expect(stops.list().map((stop) => stop.key)).toEqual(['tab-2:leaf-1'])
  })

  it('nudges agents on the same account once its usage drops, at most once per cooldown', async () => {
    const { stops, resumeTerminal, advance } = setup()
    stops.onHookStatus(limitStop)
    await stops.onActiveUsage('lh', usage(100))
    advance(2 * 60_000)
    await stops.onActiveUsage('lh', usage(95))
    expect(resumeTerminal).not.toHaveBeenCalled()

    await stops.onActiveUsage('lh', usage(3))
    expect(resumeTerminal).toHaveBeenCalledTimes(1)

    stops.onHookStatus(limitStop)
    advance(2 * 60_000)
    await stops.onActiveUsage('lh', usage(3))
    expect(resumeTerminal).toHaveBeenCalledTimes(1)
    advance(15 * 60_000)
    await stops.onActiveUsage('lh', usage(3))
    expect(resumeTerminal).toHaveBeenCalledTimes(2)
  })

  it('ignores usage readings for another account', async () => {
    const { stops, resumeTerminal, advance } = setup()
    stops.onHookStatus(limitStop)
    advance(2 * 60_000)
    await stops.onActiveUsage('personal', usage(3))
    expect(resumeTerminal).not.toHaveBeenCalled()
  })

  it('reads native-chat stops from assistant errors and 429 results, not subagents', () => {
    expect(isClaudeLimitStopFrame({ type: 'assistant', error: 'rate_limit' })).toBe(true)
    expect(isClaudeLimitStopFrame({ type: 'result', is_error: true, api_error_status: 429 })).toBe(
      true
    )
    expect(
      isClaudeLimitStopFrame({ type: 'assistant', error: 'rate_limit', parent_tool_use_id: 'tu' })
    ).toBe(false)
    expect(isClaudeLimitStopFrame({ type: 'assistant', error: 'server_error' })).toBe(false)
  })

  it('records the subscription a chat ran on and leaves it out of managed-account nudges', async () => {
    const active: { id: string | null } = { id: 'lh' }
    const { stops, resumeNativeChat } = setup(
      active,
      () => false,
      (sessionId) => (sessionId === 'on-work' ? 'work' : null)
    )
    stops.onNativeFrame('on-work', null, { type: 'assistant', error: 'rate_limit' })
    stops.onNativeFrame('on-base', null, { type: 'assistant', error: 'rate_limit' })
    expect(stops.list().map((stop) => [stop.key, stop.subscriptionId])).toEqual([
      ['on-work', 'work'],
      ['on-base', null]
    ])
    active.id = 'personal'
    await stops.onAccountChanged('personal')
    expect(resumeNativeChat.mock.calls).toEqual([['on-base']])
  })

  it('continues a chat whose child spawned on another account, though the stop names the selected one', async () => {
    const onOther = vi.fn(async (sessionId: string) => sessionId === 'spawned-elsewhere')
    const resumeNativeChat = vi.fn(async () => true)
    const stops = createClaudeLimitStops({
      now: () => 1_000_000,
      activeAccountId: () => 'lh',
      resumeTerminal: vi.fn(async () => true),
      resumeNativeChat,
      onChanged: vi.fn(),
      nativeChatOnOtherAccount: onOther
    })
    stops.onNativeFrame('spawned-elsewhere', null, { type: 'assistant', error: 'rate_limit' })
    stops.onNativeFrame('on-lh', null, { type: 'assistant', error: 'rate_limit' })

    await stops.onAccountChanged('lh')

    expect(resumeNativeChat.mock.calls).toEqual([['spawned-elsewhere']])
  })

  it("records a chat's stop on the account its child spends, not the one selected since", () => {
    const stops = createClaudeLimitStops({
      now: () => 1_000_000,
      activeAccountId: () => 'personal',
      resumeTerminal: vi.fn(async () => true),
      resumeNativeChat: vi.fn(async () => true),
      onChanged: vi.fn(),
      nativeChatAccountId: (sessionId) =>
        sessionId === 'on-lh' ? 'lh' : sessionId === 'on-base' ? null : undefined
    })
    stops.onNativeFrame('on-lh', null, { type: 'assistant', error: 'rate_limit' })
    stops.onNativeFrame('on-base', null, { type: 'assistant', error: 'rate_limit' })
    stops.onNativeFrame('unknown', null, { type: 'assistant', error: 'rate_limit' })
    expect(stops.list().map((stop) => [stop.key, stop.accountId])).toEqual([
      ['on-lh', 'lh'],
      ['on-base', null],
      ['unknown', 'personal']
    ])
  })

  it('forgets a native chat that produces output again', () => {
    const { stops, onChanged } = setup()
    stops.onNativeFrame('session-1', null, { type: 'assistant', error: 'rate_limit' })
    stops.onNativeFrame('session-1', null, {
      type: 'result',
      is_error: true,
      api_error_status: 429
    })
    expect(stops.list()).toHaveLength(1)
    stops.onNativeFrame('session-1', null, { type: 'assistant', message: {} })
    expect(stops.list()).toEqual([])
    expect(onChanged).toHaveBeenLastCalledWith([])
  })

  it('checks for a handoff as soon as a stop is recorded, with the session id', async () => {
    const { stops, checkHandoff } = setup()
    stops.onHookStatus({ ...limitStop, providerSession: { key: 'session_id', id: 'sess-1' } })
    stops.onNativeFrame('chat-1', 'repo::/wt', { type: 'assistant', error: 'rate_limit' })
    await Promise.resolve()
    expect(checkHandoff.mock.calls.map(([stop]) => [stop.kind, stop.sessionId])).toEqual([
      ['terminal', 'sess-1'],
      ['native-chat', 'chat-1']
    ])
  })

  it('never nudges a session whose stopped turn had handed off, and drops its stop', async () => {
    const active = { id: 'lh' }
    const { stops, resumeNativeChat, resumeTerminal } = setup(
      active,
      (stop) => stop.kind === 'native-chat'
    )
    stops.onNativeFrame('chat-1', 'repo::/wt', { type: 'assistant', error: 'rate_limit' })
    stops.onHookStatus(limitStop)
    active.id = 'personal'
    await stops.onAccountChanged('personal')
    expect(resumeNativeChat).not.toHaveBeenCalled()
    expect(resumeTerminal).toHaveBeenCalledWith(PANE)
    expect(stops.list()).toEqual([])
  })
})

describe('claude sign-in stops', () => {
  // Captured 29.09 (acme-hub): "Please run /login · API Error: 403 Request not allowed".
  const authFrame = {
    type: 'assistant',
    error: 'authentication_failed',
    isApiErrorMessage: true,
    parent_tool_use_id: null
  }

  it('recognizes a rejected sign-in, not a limit', () => {
    expect(isClaudeAuthStopFrame(authFrame)).toBe(true)
    expect(isClaudeLimitStopFrame(authFrame)).toBe(false)
    expect(isClaudeAuthStopFrame({ type: 'result', is_error: true, api_error_status: 403 })).toBe(
      true
    )
    expect(isClaudeAuthStopFrame({ type: 'result', is_error: true, api_error_status: 429 })).toBe(
      false
    )
    expect(isClaudeAuthStopFrame({ ...authFrame, parent_tool_use_id: 'tool-1' })).toBe(false)
  })

  it('records terminal and native-chat stops with the auth reason and raises the handoff check', async () => {
    const { stops, checkHandoff } = setup()
    stops.onHookStatus({ ...limitStop, stopFailureError: 'authentication_failed' })
    stops.onNativeFrame('chat-1', 'repo::/wt', authFrame)
    expect(stops.list()).toEqual([
      expect.objectContaining({ kind: 'terminal', key: PANE, reason: 'auth' }),
      expect.objectContaining({ kind: 'native-chat', key: 'chat-1', reason: 'auth' })
    ])
    await vi.waitFor(() => expect(checkHandoff).toHaveBeenCalledTimes(2))
  })

  it('is not lifted by usage readings, only by Continue or an account switch', async () => {
    const { stops, resumeTerminal, resumeNativeChat, advance } = setup()
    stops.onHookStatus({ ...limitStop, stopFailureError: 'authentication_failed' })
    advance(30 * 60_000)
    await stops.onActiveUsage('lh', usage(5))
    expect(resumeTerminal).not.toHaveBeenCalled()

    stops.onNativeFrame('chat-1', null, authFrame)
    expect(await stops.resumeAuthStops()).toBe(2)
    expect(resumeTerminal).toHaveBeenCalledWith(PANE)
    expect(resumeNativeChat).toHaveBeenCalledWith('chat-1')
    expect(stops.list()).toEqual([])
  })

  it('Continue leaves limit stops alone', async () => {
    const { stops, resumeTerminal } = setup()
    stops.onHookStatus(limitStop)
    expect(await stops.resumeAuthStops()).toBe(0)
    expect(resumeTerminal).not.toHaveBeenCalled()
    expect(stops.list()).toHaveLength(1)
  })

  it('an account switch nudges sign-in stops too', async () => {
    const { stops, resumeNativeChat } = setup()
    stops.onNativeFrame('chat-1', null, authFrame)
    await stops.onAccountChanged('personal')
    expect(resumeNativeChat).toHaveBeenCalledWith('chat-1')
  })

  describe('network stops (claude-network-continue, auto-continue A10)', () => {
    const netFrame = {
      type: 'assistant',
      error: 'server_error',
      isApiErrorMessage: true,
      parent_tool_use_id: null
    }
    const workFrame = { type: 'assistant', parent_tool_use_id: null }

    function netSetup(enabled: { on: boolean } = { on: true }) {
      let now = 1_000_000
      const scheduled: number[] = []
      const resumeTerminal = vi.fn(async (_key: string, _prompt?: string) => true)
      const resumeNativeChat = vi.fn(async (_key: string, _prompt?: string) => true)
      const onChanged = vi.fn()
      const stops = createClaudeLimitStops({
        now: () => now,
        activeAccountId: () => 'lh',
        resumeTerminal,
        resumeNativeChat,
        onChanged,
        checkHandoff: async (stop) => stop.key === 'handed-off',
        networkContinueEnabled: () => enabled.on,
        scheduleNetworkTick: (ms) => scheduled.push(ms)
      })
      return {
        stops,
        resumeTerminal,
        resumeNativeChat,
        onChanged,
        scheduled,
        advance: (ms: number) => {
          now += ms
        }
      }
    }

    it('continues a cut chat after a pause, as Orca+, never as a limit card', async () => {
      const { stops, resumeNativeChat, onChanged, scheduled, advance } = netSetup()
      stops.onNativeFrame('chat-1', 'repo::/wt', netFrame)
      stops.onNativeFrame('chat-2', 'repo::/wt', { ...netFrame, parent_tool_use_id: 'sub' })
      expect(stops.list()).toEqual([])
      expect(onChanged).not.toHaveBeenCalled()
      expect(scheduled).toEqual([60_000])
      advance(59_000)
      await stops.onNetworkTick()
      expect(resumeNativeChat).not.toHaveBeenCalled()
      advance(1_000)
      await stops.onNetworkTick()
      expect(resumeNativeChat).toHaveBeenCalledTimes(1)
      expect(resumeNativeChat.mock.calls[0][0]).toBe('chat-1')
      expect(resumeNativeChat.mock.calls[0][1]).toMatch(/^Orca\+ · .*попытка 1 из 3/)
      // The stop is answered: a second tick sends nothing.
      await stops.onNetworkTick()
      expect(resumeNativeChat).toHaveBeenCalledTimes(1)
    })

    it('a usage reading no longer nudges; only the schedule does', async () => {
      const { stops, resumeNativeChat, advance } = netSetup()
      stops.onNativeFrame('chat-1', null, netFrame)
      advance(30_000)
      await stops.onActiveUsage('lh', usage(10))
      expect(resumeNativeChat).not.toHaveBeenCalled()
    })

    it('stops after 3 nudges in a row with growing pauses; output starts the count over', async () => {
      const { stops, resumeNativeChat, scheduled, advance } = netSetup()
      for (const pause of [60_000, 3 * 60_000, 10 * 60_000]) {
        stops.onNativeFrame('chat-1', null, netFrame)
        advance(pause)
        await stops.onNetworkTick()
      }
      expect(scheduled).toEqual([60_000, 180_000, 600_000])
      expect(resumeNativeChat.mock.calls.map((call) => call[1])).toEqual([
        expect.stringContaining('попытка 1 из 3'),
        expect.stringContaining('попытка 2 из 3'),
        expect.stringContaining('попытка 3 из 3')
      ])
      // A fourth stop in a row is left to the owner.
      stops.onNativeFrame('chat-1', null, netFrame)
      advance(60 * 60_000)
      await stops.onNetworkTick()
      expect(resumeNativeChat).toHaveBeenCalledTimes(3)
      expect(scheduled).toHaveLength(3)
      // The agent got through again: the next cut is a new incident.
      stops.onNativeFrame('chat-1', null, workFrame)
      stops.onNativeFrame('chat-1', null, netFrame)
      advance(60_000)
      await stops.onNetworkTick()
      expect(resumeNativeChat).toHaveBeenCalledTimes(4)
      expect(resumeNativeChat.mock.calls[3][1]).toContain('попытка 1 из 3')
    })

    it('off: nothing is recorded or sent; switched off while waiting drops the waiting stops', async () => {
      const enabled = { on: false }
      const { stops, resumeNativeChat, scheduled, advance } = netSetup(enabled)
      stops.onNativeFrame('chat-1', null, netFrame)
      expect(scheduled).toEqual([])
      enabled.on = true
      stops.onNativeFrame('chat-2', null, netFrame)
      enabled.on = false
      advance(60_000)
      await stops.onNetworkTick()
      enabled.on = true
      await stops.onNetworkTick()
      expect(resumeNativeChat).not.toHaveBeenCalled()
    })

    it('limit and auth stops are not network stops', async () => {
      const { stops, resumeNativeChat, scheduled, advance } = netSetup()
      stops.onNativeFrame('chat-1', null, {
        type: 'assistant',
        error: 'rate_limit',
        parent_tool_use_id: null
      })
      stops.onNativeFrame('chat-2', null, { type: 'result', is_error: true, api_error_status: 429 })
      stops.onNativeFrame('chat-3', null, {
        type: 'assistant',
        error: 'authentication_failed',
        parent_tool_use_id: null
      })
      expect(scheduled).toEqual([])
      advance(60 * 60_000)
      await stops.onNetworkTick()
      expect(resumeNativeChat).not.toHaveBeenCalled()
      expect(stops.list()).toHaveLength(3)
    })

    it('never nudges a chat that handed off', async () => {
      const { stops, resumeNativeChat, advance } = netSetup()
      stops.onNativeFrame('handed-off', 'repo::/wt', netFrame)
      advance(60_000)
      await stops.onNetworkTick()
      expect(resumeNativeChat).not.toHaveBeenCalled()
    })

    it('drops the stop when the agent works again or the owner writes first; terminals too', async () => {
      const { stops, resumeNativeChat, resumeTerminal, advance } = netSetup()
      stops.onNativeFrame('chat-1', null, netFrame)
      stops.onNativeFrame('chat-1', null, workFrame)
      stops.onHookStatus({ ...limitStop, stopFailureError: 'server_error' })
      stops.onHookStatus({ ...limitStop, hookEventName: 'UserPromptSubmit' })
      stops.onHookStatus({ ...limitStop, paneKey: 'tab-2:leaf', stopFailureError: 'server_error' })
      advance(60_000)
      await stops.onNetworkTick()
      expect(resumeNativeChat).not.toHaveBeenCalled()
      expect(resumeTerminal).toHaveBeenCalledTimes(1)
      expect(resumeTerminal.mock.calls[0][0]).toBe('tab-2:leaf')
      expect(resumeTerminal.mock.calls[0][1]).toContain('попытка 1 из 3')
    })

    it("a terminal's own nudge prompt does not reset its count; a tool call does", async () => {
      const { stops, resumeTerminal, advance } = netSetup()
      const cut = { ...limitStop, stopFailureError: 'server_error' }
      stops.onHookStatus(cut)
      advance(60_000)
      await stops.onNetworkTick()
      stops.onHookStatus({ ...limitStop, hookEventName: 'UserPromptSubmit' })
      stops.onHookStatus(cut)
      advance(3 * 60_000)
      await stops.onNetworkTick()
      expect(resumeTerminal.mock.calls[1][1]).toContain('попытка 2 из 3')
      stops.onHookStatus({ ...limitStop, hookEventName: 'PostToolUse' })
      stops.onHookStatus(cut)
      advance(60_000)
      await stops.onNetworkTick()
      expect(resumeTerminal.mock.calls[2][1]).toContain('попытка 1 из 3')
    })
  })
})
