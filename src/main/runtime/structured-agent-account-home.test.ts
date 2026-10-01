import { describe, expect, it } from 'vitest'
import { resolveStructuredClaudeAccountHomePath } from './structured-agent-account-home'

describe('resolveStructuredClaudeAccountHomePath', () => {
  const getClaudeConfigDirectory = () => '/Users/me/.claude'

  it('pins a native chat to its subscription dir', () => {
    expect(
      resolveStructuredClaudeAccountHomePath({
        launchEnv: {},
        wslDistro: null,
        subscriptionConfigDir: '/Users/me/.claude-lh',
        getClaudeConfigDirectory
      })
    ).toBe('/Users/me/.claude-lh')
  })

  it('keeps an explicit CLAUDE_CONFIG_DIR above the subscription', () => {
    expect(
      resolveStructuredClaudeAccountHomePath({
        launchEnv: { CLAUDE_CONFIG_DIR: '/custom' },
        wslDistro: null,
        subscriptionConfigDir: '/Users/me/.claude-lh',
        getClaudeConfigDirectory
      })
    ).toBe('/custom')
  })

  it('falls back to the account dir without a subscription', () => {
    expect(
      resolveStructuredClaudeAccountHomePath({
        launchEnv: {},
        wslDistro: null,
        subscriptionConfigDir: null,
        getClaudeConfigDirectory
      })
    ).toBe('/Users/me/.claude')
  })
})
