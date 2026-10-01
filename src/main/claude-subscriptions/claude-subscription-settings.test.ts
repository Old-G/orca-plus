import { describe, expect, it } from 'vitest'
import {
  normalizeClaudeSubscriptionConfigDir,
  normalizeClaudeSubscriptions,
  normalizeDefaultClaudeSubscriptionId
} from './claude-subscription-settings'

const home = '/Users/me'

describe('normalizeClaudeSubscriptionConfigDir', () => {
  it('expands ~ and drops a trailing slash so the keychain item stays the same', () => {
    expect(normalizeClaudeSubscriptionConfigDir('~/.claude-lh/', home)).toBe('/Users/me/.claude-lh')
    expect(normalizeClaudeSubscriptionConfigDir('/Users/me/.claude-lh', home)).toBe(
      '/Users/me/.claude-lh'
    )
  })

  it('refuses relative paths, the base ~/.claude in any case, and the home folder', () => {
    expect(normalizeClaudeSubscriptionConfigDir('claude-lh', home)).toBeNull()
    expect(normalizeClaudeSubscriptionConfigDir('~/.claude/', home)).toBeNull()
    expect(normalizeClaudeSubscriptionConfigDir('~/.Claude', home)).toBeNull()
    expect(normalizeClaudeSubscriptionConfigDir('~', home)).toBeNull()
    expect(normalizeClaudeSubscriptionConfigDir('  ', home)).toBeNull()
  })
})

describe('normalizeClaudeSubscriptions', () => {
  it('keeps valid rows and drops malformed, base-named and duplicate ones', () => {
    expect(
      normalizeClaudeSubscriptions(
        [
          { id: 'lh', label: ' Lev Haolam ', configDir: '~/.claude-lh' },
          { id: 'lh', label: 'again', configDir: '~/.claude-other' },
          { id: 'copy', label: 'same dir', configDir: '/Users/me/.claude-lh/' },
          { id: 'base', label: 'base', configDir: '~/.claude-base' },
          { id: 'bad id!', label: 'x', configDir: '~/.claude-x' },
          { id: 'nolabel', label: ' ', configDir: '~/.claude-y' },
          'junk',
          null
        ],
        home
      )
    ).toEqual([{ id: 'lh', label: 'Lev Haolam', configDir: '/Users/me/.claude-lh' }])
  })

  it('treats a non-array as no subscriptions', () => {
    expect(normalizeClaudeSubscriptions({ id: 'lh' }, home)).toEqual([])
  })
})

describe('normalizeDefaultClaudeSubscriptionId', () => {
  const subscriptions = [{ id: 'lh', label: 'LH', configDir: '/Users/me/.claude-lh' }]

  it('keeps a known id and turns anything else into the base sign-in', () => {
    expect(normalizeDefaultClaudeSubscriptionId('lh', subscriptions)).toBe('lh')
    expect(normalizeDefaultClaudeSubscriptionId('gone', subscriptions)).toBeNull()
    expect(normalizeDefaultClaudeSubscriptionId(null, subscriptions)).toBeNull()
  })
})
