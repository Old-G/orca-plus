import { describe, expect, it, vi } from 'vitest'
import { createClaudeLimitStops, isClaudeLimitStopFrame } from './claude-limit-stops'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
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
