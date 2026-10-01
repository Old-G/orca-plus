import { describe, expect, it, vi } from 'vitest'
import {
  BASE_CLAUDE_SUBSCRIPTION_ID,
  CLAUDE_SUBSCRIPTION_ENV,
  readClaudeSubscriptionFromEnv,
  resolveClaudeSubscriptionConfigDir
} from './claude-subscriptions'

// Why: these cover the feature itself, which ships switched off (see the switch module).
vi.mock('./claude-subscriptions-switch', () => ({ CLAUDE_SUBSCRIPTIONS_ENABLED: true }))

const settings = {
  claudeSubscriptions: [{ id: 'lh', label: 'Lev Haolam', configDir: '/Users/me/.claude-lh' }],
  defaultClaudeSubscriptionId: 'lh'
}

describe('resolveClaudeSubscriptionConfigDir', () => {
  it('uses the default subscription when the launch names none', () => {
    expect(resolveClaudeSubscriptionConfigDir(settings, undefined)).toBe('/Users/me/.claude-lh')
  })

  it('lets a launch pick the base sign-in over the default', () => {
    expect(resolveClaudeSubscriptionConfigDir(settings, BASE_CLAUDE_SUBSCRIPTION_ID)).toBeNull()
  })

  it('falls back to the base sign-in for a removed subscription', () => {
    expect(resolveClaudeSubscriptionConfigDir(settings, 'gone')).toBeNull()
  })

  it('pins nothing without subscriptions', () => {
    expect(resolveClaudeSubscriptionConfigDir({}, undefined)).toBeNull()
    expect(resolveClaudeSubscriptionConfigDir(null, 'lh')).toBeNull()
  })
})

describe('readClaudeSubscriptionFromEnv', () => {
  it('reads the launch marker', () => {
    expect(readClaudeSubscriptionFromEnv({ [CLAUDE_SUBSCRIPTION_ENV]: ' lh ' })).toBe('lh')
    expect(readClaudeSubscriptionFromEnv({})).toBeNull()
  })
})
