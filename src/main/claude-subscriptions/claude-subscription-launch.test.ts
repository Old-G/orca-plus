import { describe, expect, it, vi } from 'vitest'
import { CLAUDE_SUBSCRIPTION_ENV } from '../../shared/claude-subscriptions'
import {
  resolveClaudeSubscriptionLaunchConfigDir,
  withClaudeSubscriptionConfigDir
} from './claude-subscription-launch'
import { UnsafeClaudeSubscriptionDirError } from './claude-subscription-home'

// Why: these cover the feature itself, which ships switched off (see the switch module).
vi.mock('../../shared/claude-subscriptions-switch', () => ({ CLAUDE_SUBSCRIPTIONS_ENABLED: true }))

const settings = {
  claudeSubscriptions: [
    { id: 'lh', label: 'Lev Haolam', configDir: '/Users/me/.claude-lh' },
    { id: 'side', label: 'Side', configDir: '/Users/me/.claude-side' }
  ],
  defaultClaudeSubscriptionId: 'lh'
}

function resolve(
  overrides: Partial<Parameters<typeof resolveClaudeSubscriptionLaunchConfigDir>[0]>
) {
  const prepareHome = vi.fn()
  const configDir = resolveClaudeSubscriptionLaunchConfigDir({
    settings,
    env: {},
    runtime: 'host',
    prepareHome,
    ...overrides
  })
  return { configDir, prepareHome }
}

describe('resolveClaudeSubscriptionLaunchConfigDir', () => {
  it('puts an unmarked host launch on the default subscription and prepares its dir', () => {
    const { configDir, prepareHome } = resolve({})
    expect(configDir).toBe('/Users/me/.claude-lh')
    expect(prepareHome).toHaveBeenCalledWith('/Users/me/.claude-lh')
  })

  it('follows the env marker, so a resumed pane keeps its subscription', () => {
    expect(resolve({ env: { [CLAUDE_SUBSCRIPTION_ENV]: 'side' } }).configDir).toBe(
      '/Users/me/.claude-side'
    )
    expect(resolve({ env: { [CLAUDE_SUBSCRIPTION_ENV]: 'base' } }).configDir).toBeNull()
  })

  it('lets an explicit subscription id beat the marker', () => {
    expect(
      resolve({ env: { [CLAUDE_SUBSCRIPTION_ENV]: 'side' }, subscriptionId: 'lh' }).configDir
    ).toBe('/Users/me/.claude-lh')
  })

  it('leaves an explicit CLAUDE_CONFIG_DIR and WSL launches alone', () => {
    expect(resolve({ env: { CLAUDE_CONFIG_DIR: '/custom' } }).configDir).toBeNull()
    const wsl = resolve({ runtime: 'wsl' })
    expect(wsl.configDir).toBeNull()
    expect(wsl.prepareHome).not.toHaveBeenCalled()
  })

  it('stays on the base sign-in when the dir is not safe to use', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { configDir } = resolve({
      prepareHome: () => {
        throw new UnsafeClaudeSubscriptionDirError('/Users/me', 'the home folder')
      }
    })
    expect(configDir).toBeNull()
    warn.mockRestore()
  })

  it('still pins the sign-in when preparing the dir fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { configDir } = resolve({
      prepareHome: () => {
        throw new Error('EACCES')
      }
    })
    expect(configDir).toBe('/Users/me/.claude-lh')
    warn.mockRestore()
  })
})

describe('withClaudeSubscriptionConfigDir', () => {
  const auth = {
    configDir: '/Users/me/.claude',
    envPatch: {},
    stripAuthEnv: false,
    provenance: 'system'
  }

  it('pins the subscription dir in the auth env patch', () => {
    expect(withClaudeSubscriptionConfigDir(auth, '/Users/me/.claude-lh')).toEqual({
      ...auth,
      configDir: '/Users/me/.claude-lh',
      stripAuthEnv: true,
      envPatch: { CLAUDE_CONFIG_DIR: '/Users/me/.claude-lh' }
    })
  })

  it('returns the preparation untouched without a subscription', () => {
    expect(withClaudeSubscriptionConfigDir(auth, null)).toBe(auth)
  })
})
