import { describe, expect, it, vi } from 'vitest'

vi.mock('../runtime/rpc/methods/agent-launch/agent-launch', () => ({ launchAgentOnHost: vi.fn() }))

import { chatSessionOptions } from './launch/automation-chat-agent-launch'

// Custom build (automations-chat-model, owner 02.11).
describe('an automation chat keeps the model its terminal runs named', () => {
  it('takes --model and --effort, in either spelling, and nothing else', () => {
    expect(chatSessionOptions('--model sonnet')).toEqual({ sessionOptions: { model: 'sonnet' } })
    expect(chatSessionOptions('--effort=high --model=opus')).toEqual({
      sessionOptions: { model: 'opus', effort: 'high' }
    })
    expect(chatSessionOptions('--no-chrome')).toEqual({})
    expect(chatSessionOptions(undefined)).toEqual({})
  })
})

// Custom build (automation-narrow-tools, Codex 03.11): a chat cannot keep the terminal's tool limits.
describe('a tool-narrowed automation stays in the terminal', () => {
  it('refuses the chat surface while the extras take tools away', async () => {
    const { assertAutomationExtraAgentArgs, narrowsAutomationTools } =
      await import('../../shared/automations/launch/automation-extra-agent-args-record')
    const narrows = (extraAgentArgs: string) =>
      narrowsAutomationTools({ agentId: 'claude', extraAgentArgs })
    expect(narrows('--model sonnet --no-chrome')).toBe(true)
    expect(narrows('--disallowedTools=mcp__acme')).toBe(true)
    expect(narrows('--strict-mcp-config')).toBe(true)
    // Why (Codex 03.11): the parser accepts a quoted flag.
    expect(narrows("--model sonnet '--no-chrome'")).toBe(true)
    expect(narrows('--model sonnet')).toBe(false)
    expect(() =>
      assertAutomationExtraAgentArgs({
        agentId: 'claude',
        extraAgentArgs: '--model sonnet --no-chrome',
        reuseSession: false,
        surface: 'chat'
      })
    ).toThrow(/terminal/)
    expect(() =>
      assertAutomationExtraAgentArgs({
        agentId: 'claude',
        extraAgentArgs: '--model sonnet',
        reuseSession: false,
        surface: 'chat'
      })
    ).not.toThrow()
  })
})
