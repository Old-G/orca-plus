import { describe, expect, it } from 'vitest'
import { claudeHandoffOffersShown, type ClaudeHandoffOffer } from './claude-handoff-file'
import { handoffBellItem } from './pulse-bell'

const offer = (over: Partial<ClaudeHandoffOffer> = {}): ClaudeHandoffOffer => ({
  id: 'claude_a',
  worktreeId: 'r::/w',
  worktreeTitle: 'Acme / main',
  sessionId: 'claude_a',
  created: '2026-11-27T10:00:00Z',
  branch: null,
  head: null,
  pushed: null,
  ...over
})

// Custom build (hq-handoff-once, owner 27.11): no «New session» card for a chat that opens by itself.
describe('claudeHandoffOffersShown', () => {
  it('hides offers auto-start is taking care of, and shows one it could not start, with why', () => {
    const waiting = offer()
    const failed = offer({ id: 'claude_b', autoStartError: 'no host' })
    expect(claudeHandoffOffersShown([waiting, failed], true)).toEqual([failed])
    expect(claudeHandoffOffersShown([waiting, failed], false)).toEqual([waiting, failed])
    const item = handoffBellItem(failed)
    expect(item.title).toContain('did not start')
    expect(item.body).toContain('no host')
  })
})
