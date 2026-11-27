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
    // The old chat stays open; its next handoff is its own again.
    clock += 6 * 60_000
    expect(claims.claimForAgent('claude_a')).toEqual({ taken: false })

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

// Custom build (hq-handoff-once, owner 27.11): what the journal knows outlives the in-memory claims.
describe('one handoff, one new chat (hq-handoff-once)', () => {
  it('turns Orca+ away once the chat’s own start is in the journal, after its claim lapsed', () => {
    let clock = 0
    const continued = new Map<string, { to: string; at: number }>()
    const claims = createClaudeHandoffClaims(
      () => clock,
      () => (from, since) => {
        const hit = continued.get(from)
        return hit && hit.at >= since ? hit.to : null
      }
    )
    expect(claims.claimForAgent('claude_a')).toEqual({ taken: false })
    continued.set('claude_a', { to: 'claude_b', at: clock })
    // 27.11 00:07 → 00:09: the 2-minute claim lapsed and Orca+ started a second chat.
    clock += 3 * 60_000
    expect(claims.claimForOrca('claude_a')).toBe(false)
    expect(claims.claimForAgent('claude_a')).toEqual({
      taken: true,
      successorSessionId: 'claude_b'
    })
    // Long after, the owner typing on in the old chat may hand off again.
    clock += 31 * 60_000
    expect(claims.claimForOrca('claude_a')).toBe(true)
  })
})
