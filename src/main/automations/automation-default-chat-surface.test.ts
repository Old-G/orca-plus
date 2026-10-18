import { describe, expect, it } from 'vitest'
import {
  automationDispatchSurface,
  withAutomationDispatchSurface
} from './automation-default-chat-surface'

const fresh = { agentId: 'claude', reuseSession: false } as const

describe('automation dispatch surface (custom build)', () => {
  it('runs as a chat when the agent opens as a chat', () => {
    expect(automationDispatchSurface(fresh, { agentDefaultSurface: 'chat' })).toBe('chat')
    expect(
      automationDispatchSurface({ ...fresh, agentId: 'codex' }, { nativeChatProviders: { codex: true } })
    ).toBe('chat')
  })

  it('keeps the terminal when the agent opens in the terminal', () => {
    expect(automationDispatchSurface(fresh, { agentDefaultSurface: 'terminal' })).toBeUndefined()
    expect(
      automationDispatchSurface(fresh, {
        agentDefaultSurface: 'chat',
        nativeChatProviders: { claude: false }
      })
    ).toBeUndefined()
  })

  it('keeps the surface an automation chose for itself', () => {
    expect(
      automationDispatchSurface({ ...fresh, surface: 'terminal' }, { agentDefaultSurface: 'chat' })
    ).toBe('terminal')
  })

  it('keeps the terminal for reuse, extra CLI arguments and other agents', () => {
    const chat = { agentDefaultSurface: 'chat' } as const
    expect(automationDispatchSurface({ ...fresh, reuseSession: true }, chat)).toBeUndefined()
    expect(automationDispatchSurface({ ...fresh, extraAgentArgs: '--x' }, chat)).toBeUndefined()
    expect(automationDispatchSurface({ ...fresh, agentId: 'gemini' }, chat)).toBeUndefined()
  })

  it('copies the automation only when the surface changes', () => {
    const automation = { ...fresh, id: 'a1' }
    expect(withAutomationDispatchSurface(automation, {})).toBe(automation)
    expect(
      withAutomationDispatchSurface(automation, {
        getSettings: () => ({ agentDefaultSurface: 'chat' })
      })
    ).toEqual({ ...automation, surface: 'chat' })
    expect(automation).not.toHaveProperty('surface')
  })
})
