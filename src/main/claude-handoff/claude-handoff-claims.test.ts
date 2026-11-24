import { describe, expect, it } from 'vitest'
import { createClaudeHandoffClaims } from './claude-handoff-claims'

describe('createClaudeHandoffClaims', () => {
  it('lets one side start a handoff’s new chat, whichever comes first', () => {
    let clock = 0
    const claims = createClaudeHandoffClaims(() => clock)
    expect(claims.claimForOrca('claude_a')).toBe(true)
    claims.started('claude_a', 'claude_b')
    expect(claims.claimForAgent('claude_a')).toEqual({
      taken: true,
      successorSessionId: 'claude_b'
    })
    expect(claims.claimForOrca('claude_a')).toBe(false)

    expect(claims.claimForAgent('claude_c')).toEqual({ taken: false })
    expect(claims.claimForOrca('claude_c')).toBe(false)
    // The chat's own launch failed: after its claim lapses Orca+ starts it.
    clock += 3 * 60_000
    expect(claims.claimForOrca('claude_c')).toBe(true)
  })

  it('frees a handoff whose start by Orca+ failed', () => {
    const claims = createClaudeHandoffClaims(() => 0)
    expect(claims.claimForOrca('claude_a')).toBe(true)
    claims.release('claude_a')
    expect(claims.claimForAgent('claude_a')).toEqual({ taken: false })
  })
})
