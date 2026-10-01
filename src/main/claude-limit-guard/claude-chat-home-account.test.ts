import { describe, expect, it } from 'vitest'
import { claudeAccountIdOfHome } from './claude-chat-home-account'

describe('claudeAccountIdOfHome', () => {
  it("reads a managed account from its profile folder, the base sign-in from the user's folder", () => {
    const base = '/Users/me/.claude'
    expect(
      claudeAccountIdOfHome('/Users/me/Library/orca-plus/claude-profiles/76381cc3-1ca8/home', base)
    ).toBe('76381cc3-1ca8')
    expect(claudeAccountIdOfHome('C:\\data\\claude-profiles\\acc_1\\home\\', base)).toBe('acc_1')
    expect(claudeAccountIdOfHome('/Users/me/.claude/', base)).toBeNull()
    expect(claudeAccountIdOfHome('/Users/me/.claude-lh', base)).toBeUndefined()
    expect(claudeAccountIdOfHome('/Users/me/.claude', null)).toBeUndefined()
  })
})
