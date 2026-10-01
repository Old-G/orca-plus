import { describe, expect, it } from 'vitest'
import { resolveStructuredClaudeAccountHomePath } from './agent-session/environment/structured-agent-account-home'

describe('resolveStructuredClaudeAccountHomePath', () => {
  const getClaudeConfigDirectory = () => '/Users/me/.claude'

  it('pins a native chat to its subscription dir', async () => {
    await expect(
      resolveStructuredClaudeAccountHomePath({
        launchEnv: {},
        wslDistro: null,
        subscriptionConfigDir: '/Users/me/.claude-lh',
        getClaudeConfigDirectory
      })
    ).resolves.toBe('/Users/me/.claude-lh')
  })

  it('keeps an explicit CLAUDE_CONFIG_DIR above the subscription', async () => {
    await expect(
      resolveStructuredClaudeAccountHomePath({
        launchEnv: { CLAUDE_CONFIG_DIR: '/custom' },
        wslDistro: null,
        subscriptionConfigDir: '/Users/me/.claude-lh',
        getClaudeConfigDirectory
      })
    ).resolves.toBe('/custom')
  })

  it('falls back to the account dir without a subscription', async () => {
    await expect(
      resolveStructuredClaudeAccountHomePath({
        launchEnv: {},
        wslDistro: null,
        subscriptionConfigDir: null,
        getClaudeConfigDirectory
      })
    ).resolves.toBe('/Users/me/.claude')
  })
})
