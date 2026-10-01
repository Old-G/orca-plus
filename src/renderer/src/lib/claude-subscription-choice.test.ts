import { describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_SUBSCRIPTION_ENV,
  withClaudeSubscriptionLaunchEnv
} from '../../../shared/claude-subscriptions'
import { listClaudeSubscriptionChoices } from './claude-subscription-choice'

// Why: these cover the feature itself, which ships switched off (see the switch module).
vi.mock('../../../shared/claude-subscriptions-switch', () => ({
  CLAUDE_SUBSCRIPTIONS_ENABLED: true
}))

const settings = {
  claudeSubscriptions: [{ id: 'lh', label: 'Lev Haolam', configDir: '/Users/me/.claude-lh' }],
  defaultClaudeSubscriptionId: 'lh'
}

describe('listClaudeSubscriptionChoices', () => {
  it('offers the default first and the main sign-in as the other choice', () => {
    expect(listClaudeSubscriptionChoices(settings, 'Main sign-in')).toEqual({
      defaultChoice: { id: 'lh', label: 'Lev Haolam' },
      others: [{ id: 'base', label: 'Main sign-in' }]
    })
  })

  it('offers nothing without subscriptions', () => {
    expect(listClaudeSubscriptionChoices({}, 'Main sign-in')).toBeNull()
  })
})

describe('withClaudeSubscriptionLaunchEnv', () => {
  it('stamps the picked subscription, else the default, on Claude launches', () => {
    expect(withClaudeSubscriptionLaunchEnv('claude', {}, settings, 'base')).toEqual({
      [CLAUDE_SUBSCRIPTION_ENV]: 'base'
    })
    expect(withClaudeSubscriptionLaunchEnv('claude', { A: '1' }, settings, undefined)).toEqual({
      A: '1',
      [CLAUDE_SUBSCRIPTION_ENV]: 'lh'
    })
  })

  it('leaves other agents, explicit config dirs and setups without subscriptions alone', () => {
    expect(withClaudeSubscriptionLaunchEnv('codex', {}, settings, undefined)).toEqual({})
    expect(
      withClaudeSubscriptionLaunchEnv('claude', { CLAUDE_CONFIG_DIR: '/x' }, settings, undefined)
    ).toEqual({ CLAUDE_CONFIG_DIR: '/x' })
    expect(withClaudeSubscriptionLaunchEnv('claude', {}, {}, undefined)).toEqual({})
  })
})
