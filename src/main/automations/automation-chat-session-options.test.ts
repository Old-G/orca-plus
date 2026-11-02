import { describe, expect, it, vi } from 'vitest'

vi.mock('../runtime/rpc/methods/agent-launch/agent-launch', () => ({ launchAgentOnHost: vi.fn() }))

import { chatSessionOptions } from './automation-chat-agent-launch'

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
